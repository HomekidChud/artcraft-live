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

/** The phone side of the ChatCraft phone bridge.
 *
 *  When the user enables this accessibility service, it long-polls the
 *  ChatCraft backend (GET /api/phone/poll) for commands and executes them:
 *  - state: dumps the active window as numbered elements with coordinates
 *  - tap x y / swipe: dispatched as real gestures (dispatchGesture)
 *  - text: ACTION_SET_TEXT on the focused editable
 *  - back / home: performGlobalAction
 *  - open: launch an app by package or open a URL
 *  Every command is answered with POST /api/phone/result (ok, detail, state).
 *
 *  This is the same no-root approach used by the research finding: an
 *  AccessibilityService is the only way a third-party app can read the
 *  screen and inject taps on Android. iOS does not allow it at all. */
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

    // ---------- poll loop ----------

    private void pollLoop() {
        SharedPreferences p = prefs();
        String base = p.getString("base_url", "");
        String did = p.getString("device_id", "");
        String secret = p.getString("secret", "");
        if (base.isEmpty() || did.isEmpty()) return; // not paired yet
        while (running) {
            try {
                String qs = "?device_id=" + URLEncoder.encode(did, "UTF-8")
                        + "&secret=" + URLEncoder.encode(secret, "UTF-8");
                String resp = MainActivity.get(base + "/api/phone/poll" + qs);
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
                sleep(5000);
            }
        }
    }

    private void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }

    // ---------- command execution (state read + result post on main thread) ----------

    private void execOne(final String base, final String did, final String secret,
                         final JSONObject cmd) {
        final String id = cmd.optString("id");
        final String action = cmd.optString("action");
        final JSONObject params = cmd.optJSONObject("params");
        final String[] out = new String[]{null}; // ok/detail written on main thread
        final Object done = new Object();
        main.post(new Runnable() {
            @Override public void run() {
                try {
                    out[0] = perform(action, params);
                } catch (Exception e) {
                    out[0] = null;
                }
                synchronized (done) { done.notifyAll(); }
            }
        });
        // wait for the main thread (max 20s)
        long deadline = System.currentTimeMillis() + 20000;
        synchronized (done) {
            while (out[0] == null && System.currentTimeMillis() < deadline) {
                try { done.wait(1000); } catch (InterruptedException ignored) {}
            }
        }
        boolean ok = out[0] != null;
        String detail = ok ? out[0] : (action + " failed");
        String state = readState(); // fresh screen state after the action
        try {
            JSONObject body = new JSONObject();
            body.put("device_id", did);
            body.put("secret", secret);
            body.put("cmd_id", id);
            body.put("ok", ok);
            body.put("detail", detail);
            if (state != null) body.put("state", state);
            MainActivity.post(base + "/api/phone/result",
                    body.toString().getBytes(StandardCharsets.UTF_8));
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
                int cx = 540, cy = 1200; // will be replaced by real metrics
                android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
                cx = dm.widthPixels / 2;
                cy = dm.heightPixels / 2;
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
                AccessibilityNodeInfo node = findFocusedEditable();
                if (node == null) return null;
                Bundle args = new Bundle();
                args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, t);
                boolean ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                return ok ? "typed" : null;
            }
            case "enter": {
                AccessibilityNodeInfo node = findFocusedEditable();
                if (node != null) {
                    CharSequence cur = node.getText();
                    Bundle args = new Bundle();
                    args.putCharSequence(
                            AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                            (cur == null ? "" : cur.toString()) + "\n");
                    if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args))
                        return "enter";
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

    private boolean gesture(int x1, int y1, int x2, int y2, long ms) {
        Path p = new Path();
        p.moveTo(x1, y1);
        p.lineTo(x2, y2);
        GestureDescription.Builder b = new GestureDescription.Builder();
        b.addStroke(new GestureDescription.StrokeDescription(p, 0, ms));
        return dispatchGesture(b.build(), null, null);
    }

    private AccessibilityNodeInfo findFocusedEditable() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
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
     *  element list. Called on the main thread. */
    private String readState() {
        final String[] result = new String[]{null};
        final Object done = new Object();
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
                synchronized (done) { done.notifyAll(); }
            }
        });
        long deadline = System.currentTimeMillis() + 5000;
        synchronized (done) {
            while (result[0] == null && System.currentTimeMillis() < deadline) {
                try { done.wait(500); } catch (InterruptedException ignored) {}
            }
        }
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
            sb.append('[').append(count).append("] ")
              .append(cs.toString().replace('\n', ' '), 0, Math.min(cs.length(), 40))
              .append(" (").append(cx).append(',').append(cy).append(")\n");
        }
        for (int i = 0; i < n.getChildCount(); i++) {
            AccessibilityNodeInfo c = n.getChild(i);
            if (c != null) dump(c, sb);
        }
    }
}
