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
 *  - tap x y / swipe: dispatched as real gestures (dispatchGesture), and we
 *    wait for the gesture's completion callback before reporting success
 *  - text: ACTION_SET_TEXT on the focused editable
 *  - back / home: performGlobalAction
 *  - open: launch an app by package or open a URL
 *  Every command is answered with POST /api/phone/result (ok, detail, state).
 *
 *  This uses an AccessibilityService — the no-root approach the research
 *  landed on (the phone-control products we reviewed use it too). iOS does
 *  not offer this to third-party apps, which is why there is no iOS build.
 *  Honesty notes: gestures are dispatched and awaited, but some apps ignore
 *  injected input; "enter" appends a newline (per-app IME actions vary) and
 *  is reported as best-effort in the result detail. */
public class PhoneBridgeService extends AccessibilityService {

    private Thread poller;
    private volatile boolean running;

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

    // ---------- poll loop ----------

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
        // 0 = running, 1 = ok, -1 = failed (never conflate "running" with "failed")
        final int[] outcome = new int[]{0};
        final String[] detail = new String[]{""};
        final CountDownLatch done = new CountDownLatch(1);
        final Handler main = new Handler(Looper.getMainLooper());
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    detail[0] = perform(action, params);
                    outcome[0] = detail[0] != null ? 1 : -1;
                } catch (Exception e) {
                    outcome[0] = -1;
                    detail[0] = e.getClass().getSimpleName() + ": " + e.getMessage();
                }
                done.countDown();
            }
        });
        try { done.await(20, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
        boolean ok = outcome[0] == 1;
        if (outcome[0] == 0) { // never resolved on the main thread
            ok = false;
            detail[0] = "action did not complete in time";
        }
        String state = readState(main); // fresh screen state after the action
        try {
            JSONObject body = new JSONObject();
            body.put("device_id", did);
            body.put("secret", secret);
            body.put("cmd_id", id);
            body.put("ok", ok);
            body.put("detail", ok ? detail[0] : (action + " failed: " + detail[0]));
            if (state != null) body.put("state", state);
            MainActivity.post(base + "/api/phone/result",
                    body.toString().getBytes(StandardCharsets.UTF_8),
                    prefs().getString("access_code", ""));
        } catch (Exception ignored) {
        }
    }

    /** Runs on the main thread. Returns a detail string on success, null on failure. */
    private String perform(String action, JSONObject params) {
        switch (action) {
            case "state":
                return "screen read";
            case "tap": {
                int x = params.optInt("x"), y = params.optInt("y");
                return gesture(x, y, x, y, 60) ? "tapped " + x + "," + y : null;
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
                return gesture(cx, cy, cx + dx, cy + dy, 300)
                        ? "swiped " + dir : null;
            }
            case "text": {
                String t = params.optString("text");
                AccessibilityNodeInfo node = focusedEditable();
                if (node == null) return null;
                Bundle args = new Bundle();
                args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, t);
                boolean ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                return ok ? "typed" : null;
            }
            case "enter": {
                // Best effort: append a newline to the focused editable. Real
                // IME actions (Send/Search/Done) vary per app and are not
                // exposed to accessibility services, so this is reported
                // honestly as a newline, not a guaranteed submit.
                AccessibilityNodeInfo node = focusedEditable();
                if (node != null) {
                    CharSequence cur = node.getText();
                    Bundle args = new Bundle();
                    args.putCharSequence(
                            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                            (cur == null ? "" : cur.toString()) + "\n");
                    if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args))
                        return "enter (newline; IME submit varies by app)";
                }
                return null;
            }
            case "back":
                return performGlobalAction(GLOBAL_ACTION_BACK) ? "back" : null;
            case "home":
                return performGlobalAction(GLOBAL_ACTION_HOME) ? "home" : null;
            case "open": {
                String target = params.optString("target",
                        params.optString("text", ""));
                Intent i;
                if (target.startsWith("http://") || target.startsWith("https://")) {
                    i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(target));
                } else {
                    i = getPackageManager().getLaunchIntentForPackage(target);
                    if (i == null) return null;
                }
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return "opened " + target;
            }
            default:
                return null;
        }
    }

    /** Dispatch a gesture and WAIT for its completion/cancellation callback —
     *  dispatchGesture() returning true only means it was accepted. */
    private boolean gesture(int x1, int y1, int x2, int y2, long ms) {
        Path p = new Path();
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(p, 0, ms));
        final CountDownLatch done = new CountDownLatch(1);
        final boolean[] ok = new boolean[]{false};
        boolean accepted = dispatchGesture(b.build(), new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription gesture) {
                ok[0] = true;
                done.countDown();
            }

            @Override public void onCancelled(GestureDescription gesture) {
                ok[0] = false;
                done.countDown();
            }
        }, null);
        if (!accepted) return false;
        try { done.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
        return ok[0];
    }

    /** The FOCUSED editable, not just the first editable on screen. */
    private AccessibilityNodeInfo focusedEditable() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        AccessibilityNodeInfo focus = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        if (focus != null && focus.isEditable()) return focus;
        if (focus != null && !focus.isEditable()) {
            // the focus target itself isn't editable: search its subtree
            AccessibilityNodeInfo in = findEditable(focus);
            if (in != null) return in;
        }
        return findEditable(root);
    }

    private AccessibilityNodeInfo findEditable(AccessibilityNodeInfo n) {
        if (n.isEditable()) return n;
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo c = n.getChild(i);
            if (c == null) continue;
            AccessibilityNodeInfo r = findEditable(c);
            if (r != null) return r;
        }
        return null;
    }

    /** Numbered screen dump: "[n] text (x,y)" lines, like the browser agent's
     *  element list. Bounded at 40 elements. */
    private String readState(Handler main) {
        final String[] result = new String[]{null};
        final CountDownLatch done = new CountDownLatch(1);
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    AccessibilityNodeInfo root = getRootInActiveWindow();
                    if (root == null) { result[0] = ""; }
                    else {
                        StringBuilder sb = new StringBuilder();
                        count = 0;
                        dump(root, sb);
                        result[0] = sb.toString();
                    }
                } catch (Exception e) {
                    result[0] = "";
                }
                done.countDown();
            }
        });
        try { done.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
        return result[0];
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
}
