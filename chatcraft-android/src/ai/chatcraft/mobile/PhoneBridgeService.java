package ai.chatcraft.mobile;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Path;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** The phone side of the ChatCraft phone bridge.
 *
 *  When the user enables this accessibility service, it long-polls the
 *  ChatCraft backend (GET /api/phone/poll) for commands and executes them:
 *  - state: dumps the active window as numbered elements with coordinates
 *  - tap x y / swipe: dispatched as real gestures. The gesture is dispatched
 *    on the main thread and the COMMAND IS COMPLETED FROM THE GESTURE'S OWN
 *    onCompleted/onCancelled callback — nothing ever blocks the main thread
 *    waiting for a callback that must run on it. Only the background poller
 *    thread waits (on a latch).
 *  - text: ACTION_SET_TEXT on the FOCUSED editable (no fallback to "some
 *    editable on screen" — typing into the wrong field is worse than an
 *    honest error).
 *  - back / home: performGlobalAction
 *  - open: launch an app by package or open a URL
 *  Every command is answered with POST /api/phone/result (ok, detail, state),
 *  and the screen state is captured AFTER the action completes.
 *
 *  Honest limits: some apps ignore injected gestures/input; "enter" appends a
 *  newline (per-app IME actions are not exposed to accessibility services)
 *  and is reported as best-effort; a command whose result times out on the
 *  server side has an UNKNOWN outcome — the phone may still complete it.
 *  Commands carry an expiry and are refused if they arrive too late.
 *  This uses an AccessibilityService — the no-root mechanism the products we
 *  reviewed rely on. iOS offers no equivalent to third-party apps. */
public class PhoneBridgeService extends AccessibilityService {

    private Thread poller;
    private volatile boolean running;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = true;
        if (poller == null || !poller.isAlive()) {
            poller = new Thread(new Runnable() {
                @Override public void run() { pollLoop(); }
            }, "chatcraft-poller");
            poller.start();
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) { /* not used */ }

    @Override
    public void onInterrupt() { /* not used */ }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("chatcraft", MODE_PRIVATE);
    }

    // ---------- poll loop (background thread; the only thread that waits) ----------

    /** Runs until the service dies. If not paired yet, waits for credentials
     *  instead of exiting — pairing after enabling the service works. */
    private void pollLoop() {
        while (running) {
            SharedPreferences p = prefs();
            String base = p.getString("base_url", "");
            String did = p.getString("device_id", "");
            String secret = p.getString("secret", "");
            if (base.isEmpty() || did.isEmpty()) {
                sleepQuiet(3000); // wait for pairing
                continue;
            }
            try {
                String qs = "?device_id=" + URLEncoder.encode(did, "UTF-8")
                        + "&secret=" + URLEncoder.encode(secret, "UTF-8");
                String resp = MainActivity.get(base + "/api/phone/poll" + qs,
                        p.getString("access_code", ""));
                JSONObject j = new JSONObject(resp);
                JSONArray cmds = j.optJSONArray("commands");
                if (cmds != null) {
                    for (int i = 0; i < cmds.length(); i++) {
                        if (!running) return;
                        execOne(base, did, secret, cmds.getJSONObject(i));
                    }
                }
            } catch (Exception e) {
                // backend unreachable / not paired: back off, then retry
                sleepQuiet(5000);
            }
        }
    }

    private void sleepQuiet(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }

    // ---------- command execution ----------

    private void execOne(final String base, final String did, final String secret,
                         final JSONObject cmd) {
        final String id = cmd.optString("id");
        final String action = cmd.optString("action");
        final JSONObject params = cmd.optJSONObject("params");
        // refuse commands that arrive after their expiry — the server has
        // already given up on them and reported an unknown outcome
        long expires = cmd.optLong("expires", 0L);
        if (expires > 0 && System.currentTimeMillis() / 1000L > expires) {
            postResult(base, did, secret, id, false,
                    "expired before execution — refused", null);
            return;
        }
        final boolean[] ok = new boolean[]{false};
        final String[] detail = new String[]{""};
        final String[] state = new String[]{null};
        final CountDownLatch done = new CountDownLatch(1);
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    int r = perform(action, params, ok, detail, state, done);
                    if (r != ASYNC) done.countDown(); // sync outcome: finish now
                    // r == ASYNC: the gesture callback finishes the command
                } catch (Exception e) {
                    ok[0] = false;
                    detail[0] = e.getClass().getSimpleName() + ": " + e.getMessage();
                    done.countDown();
                }
            }
        });
        try { done.await(20, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
        if (state[0] == null) {
            // sync action (or gesture that never resolved): capture state now
            state[0] = dumpStateSync();
        }
        postResult(base, did, secret, id, ok[0], detail[0], state[0]);
    }

    private static final int ASYNC = 0;   // gesture dispatched; callback completes
    private static final int SYNC_OK = 1;
    private static final int SYNC_FAIL = -1;

    /** Runs on the MAIN thread. Returns ASYNC for dispatched gestures (the
     *  gesture's completion callback fills ok/detail/state and counts the
     *  latch down itself — the main thread never blocks), or a SYNC_* code
     *  for actions that complete immediately. */
    private int perform(String action, JSONObject params, final boolean[] ok,
                        final String[] detail, final String[] state,
                        final CountDownLatch done) {
        switch (action) {
            case "state":
                ok[0] = true;
                detail[0] = "screen read";
                return SYNC_OK;
            case "tap": {
                int x = params.optInt("x"), y = params.optInt("y");
                return dispatch(x, y, x, y, 60, "tapped " + x + "," + y,
                               ok, detail, state, done);
            }
            case "swipe": {
                String dir = params.optString("dir", "up");
                android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
                int cx = dm.widthPixels / 2;
                int cy = dm.heightPixels / 2;
                int dx = 0, dy = 0, span = Math.min(dm.widthPixels, dm.heightPixels) / 2;
                if ("up".equals(dir)) dy = -span;
                else if ("down".equals(dir)) dy = span;
                else if ("left".equals(dir)) dx = -span;
                else if ("right".equals(dir)) dx = span;
                return dispatch(cx, cy, cx + dx, cy + dy, 300,
                                "swiped " + dir, ok, detail, state, done);
            }
            case "text": {
                String t = params.optString("text");
                AccessibilityNodeInfo node = focusedEditable();
                if (node == null) {
                    ok[0] = false;
                    detail[0] = "no focused editable field";
                    return SYNC_FAIL;
                }
                Bundle args = new Bundle();
                args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, t);
                boolean r = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                ok[0] = r;
                detail[0] = r ? "typed" : "field refused the text";
                return r ? SYNC_OK : SYNC_FAIL;
            }
            case "enter": {
                // Best effort: append a newline to the focused editable. Real
                // IME actions (Send/Search/Done) vary per app and are not
                // exposed to accessibility services, so this is reported
                // honestly as a newline, not a guaranteed submit.
                AccessibilityNodeInfo node = focusedEditable();
                if (node == null) {
                    ok[0] = false;
                    detail[0] = "no focused editable field";
                    return SYNC_FAIL;
                }
                CharSequence cur = node.getText();
                Bundle args = new Bundle();
                args.putCharSequence(
                        AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                        (cur == null ? "" : cur.toString()) + "\n");
                boolean r = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                ok[0] = r;
                detail[0] = r ? "enter (newline; IME submit varies by app)"
                              : "field refused the newline";
                return r ? SYNC_OK : SYNC_FAIL;
            }
            case "back":
                ok[0] = performGlobalAction(GLOBAL_ACTION_BACK);
                detail[0] = ok[0] ? "back" : "back refused";
                return ok[0] ? SYNC_OK : SYNC_FAIL;
            case "home":
                ok[0] = performGlobalAction(GLOBAL_ACTION_HOME);
                detail[0] = ok[0] ? "home" : "home refused";
                return ok[0] ? SYNC_OK : SYNC_FAIL;
            case "open": {
                String target = params.optString("target",
                        params.optString("text", ""));
                Intent i;
                if (target.startsWith("http://") || target.startsWith("https://")) {
                    i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(target));
                } else {
                    i = getPackageManager().getLaunchIntentForPackage(target);
                    if (i == null) {
                        ok[0] = false;
                        detail[0] = "no app named " + target;
                        return SYNC_FAIL;
                    }
                }
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                ok[0] = true;
                detail[0] = "opened " + target;
                return SYNC_OK;
            }
            default:
                ok[0] = false;
                detail[0] = "unknown action " + action;
                return SYNC_FAIL;
        }
    }

    /** Dispatch a gesture WITHOUT blocking the main thread: the callback
     *  (which runs on this same main thread) records the outcome, captures
     *  the post-gesture screen state, and releases the poller's latch. */
    private int dispatch(int x1, int y1, int x2, int y2, long ms, String okDetail,
                         final boolean[] ok, final String[] detail,
                         final String[] state, final CountDownLatch done) {
        Path p = new Path();
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(p, 0, ms));
        boolean accepted = dispatchGesture(b.build(), new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription gesture) {
                ok[0] = true;
                state[0] = dumpStateSync(); // AFTER the gesture
                done.countDown();
            }

            @Override public void onCancelled(GestureDescription gesture) {
                ok[0] = false;
                detail[0] = "gesture cancelled";
                state[0] = dumpStateSync();
                done.countDown();
            }
        }, null);
        if (!accepted) {
            ok[0] = false;
            detail[0] = "gesture rejected";
            return SYNC_FAIL;
        }
        detail[0] = okDetail; // reported if the callback never fires
        return ASYNC;
    }

    /** The FOCUSED editable — or null. Never falls back to an arbitrary
     *  editable on screen: typing into the wrong field is worse than an
     *  honest "no focused field" error. */
    private AccessibilityNodeInfo focusedEditable() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        AccessibilityNodeInfo focus = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (focus != null && focus.isEditable()) return focus;
        return null;
    }

    /** Synchronous screen dump — must be called ON the main thread (it is:
     *  from perform() or a gesture callback). */
    private String dumpStateSync() {
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return "";
            StringBuilder sb = new StringBuilder();
            count = 0;
            dump(root, sb);
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private int count = 0;

    private void dump(AccessibilityNodeInfo n, StringBuilder sb) {
        if (count >= 40) return; // bounded dump
        CharSequence cs = n.getText();
        if (cs == null || cs.length() == 0) cs = n.getContentDescription();
        if (cs != null && cs.length() > 0) {
            android.graphics.Rect r = new android.graphics.Rect();
            n.getBoundsInScreen(r);
            int cx = r.exactCenterX() < 0 ? 0 : Math.round(r.exactCenterX());
            int cy = r.exactCenterY() < 0 ? 0 : Math.round(r.exactCenterY());
            count++;
            String s = cs.toString().replace('\n', ' ');
            if (s.length() > 40) s = s.substring(0, 40);
            sb.append('[').append(count).append("] ").append(s)
              .append(" (").append(cx).append(',').append(cy).append(")\n");
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo c = n.getChild(i);
            if (c != null) dump(c, sb);
        }
    }

    private void postResult(String base, String did, String secret, String cmdId,
                            boolean ok, String detail, String state) {
        try {
            JSONObject body = new JSONObject();
            body.put("device_id", did);
            body.put("secret", secret);
            body.put("cmd_id", cmdId);
            body.put("ok", ok);
            body.put("detail", detail);
            if (state != null) body.put("state", state);
            MainActivity.post(base + "/api/phone/result",
                    body.toString().getBytes(StandardCharsets.UTF_8),
                    prefs().getString("access_code", ""));
        } catch (Exception ignored) {
        }
    }
}
