package ai.chatcraft.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Scanner;

/** Entry screen: pair with a ChatCraft backend, then load it in a WebView.
 *  Pairing = POST /api/phone/pair, which returns a device_id + secret that
 *  PhoneBridgeService uses to poll for commands. */
public class MainActivity extends Activity {

    private WebView web;
    private Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        SharedPreferences prefs = prefs();
        String base = prefs.getString("base_url", "");
        if (base.isEmpty()) showPairing(null);
        else showWeb(base);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("chatcraft", MODE_PRIVATE);
    }

    private void showWeb(String base) {
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient());
        web.loadUrl(base);

        // small "change server" control: saved credentials never lock the
        // user out (also the re-pair path after a backend restart wipes
        // the paired-device list)
        Button rePair = new Button(this);
        rePair.setText("Change server");
        rePair.setTextSize(12);
        rePair.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                SharedPreferences p = prefs();
                showPairing(p.getString("base_url", ""));
            }
        });
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(0xCC14141F);
        bar.addView(rePair);

        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.addView(bar);
        wrap.addView(web, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
        setContentView(wrap);
    }

    /** Simple programmatic pairing form: server URL + device name. */
    private void showPairing(String prefill) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setPadding(64, 96, 64, 64);
        setBackgroundColor(box, 0xFF14141F);

        TextView title = text("Pair this phone", 0xFFFFFFFF, 22);
        TextView sub = text("Point ChatCraft at your server. The agent drives " +
                "this phone through the ChatCraft accessibility service — " +
                "enable it after pairing (no root needed).", 0xFFB8B8C8, 15);
        sub.setPadding(0, 8, 0, 24);

        final EditText url = edit(prefill == null ? "https://your-chatcraft-url" : prefill,
                "ChatCraft server URL");
        final EditText name = edit(android.os.Build.MODEL, "Device name");
        final EditText code = edit("", "Access code (optional)");
        url.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        name.setImeOptions(EditorInfo.IME_ACTION_NEXT);

        Button pair = new Button(this);
        pair.setText("Pair and open ChatCraft");
        pair.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pair(url.getText().toString().trim(),
                    name.getText().toString().trim(),
                    code.getText().toString().trim()); }
        });

        box.addView(title);
        box.addView(sub);
        box.addView(url);
        box.addView(name);
        box.addView(code);
        box.addView(pair);
        setContentView(box);
    }

    private void pair(String base, String name, String accessCode) {
        if (!base.startsWith("http")) {
            toast("The server URL must start with http:// or https://");
            return;
        }
        if (!base.contains("://") || base.endsWith("/")) { /* keep as typed */ }
        final String baseN = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        final String nameF = name.isEmpty() ? android.os.Build.MODEL : name;
        final String codeF = accessCode == null ? "" : accessCode.trim();
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String body = post(baseN + "/api/phone/pair",
                            ("{\"name\":" + jsonStr(nameF) + "}").getBytes(StandardCharsets.UTF_8),
                            codeF);
                    String id = jsonField(body, "device_id");
                    String secret = jsonField(body, "secret");
                    if (id == null || secret == null) throw new Exception("server sent no credentials");
                    final SharedPreferences.Editor ed = prefs().edit();
                    ed.putString("base_url", baseN).putString("device_id", id)
                      .putString("secret", secret).putString("access_code", codeF)
                      .apply();
                    ui.post(new Runnable() {
                        @Override public void run() {
                            toast("Paired. Now enable the ChatCraft accessibility service.");
                            startActivity(new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS));
                            showWeb(baseN);
                        }
                    });
                } catch (final Exception e) {
                    ui.post(new Runnable() {
                        @Override public void run() {
                            toast("Pairing failed: " + e.getMessage());
                        }
                    });
                }
            }
        }).start();
    }

    // ---------- tiny helpers (no external deps) ----------

    static String jsonStr(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 32) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    /** crude but dependency-free JSON string field reader */
    static String jsonField(String json, String key) {
        if (json == null) return null;
        String pat = "\"" + key + "\"";
        int i = json.indexOf(pat);
        if (i < 0) return null;
        i = json.indexOf(':', i + pat.length());
        if (i < 0) return null;
        i++;
        while (i < json.length() && Character.isWhitespace(json.charAt(i))) i++;
        if (i >= json.length()) return null;
        if (json.charAt(i) == '"') {
            int j = i + 1;
            StringBuilder sb = new StringBuilder();
            while (j < json.length()) {
                char c = json.charAt(j);
                if (c == '\\' && j + 1 < json.length()) {
                    char n = json.charAt(++j);
                    switch (n) {
                        case 'n': sb.append('\n'); break;
                        case 't': sb.append('\t'); break;
                        case 'r': sb.append('\r'); break;
                        default: sb.append(n);
                    }
                    j++;
                } else if (c == '"') break;
                else { sb.append(c); j++; }
            }
            return sb.toString();
        }
        int j = i;
        while (j < json.length() && ",}]".indexOf(json.charAt(j)) < 0) j++;
        return json.substring(i, j).trim();
    }

    static String post(String url, byte[] body, String accessCode) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setRequestProperty("Content-Type", "application/json");
        if (accessCode != null && !accessCode.isEmpty())
            c.setRequestProperty("X-Access-Code", accessCode);
        c.setDoOutput(true);
        c.setConnectTimeout(10000);
        c.setReadTimeout(10000);
        OutputStream os = c.getOutputStream();
        os.write(body);
        os.close();
        InputStream in = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
        Scanner sc = new Scanner(in).useDelimiter("\\A");
        String resp = sc.hasNext() ? sc.next() : "";
        sc.close();
        if (c.getResponseCode() >= 400)
            throw new Exception("HTTP " + c.getResponseCode() + " " + resp);
        return resp;
    }

    static String get(String url, String accessCode) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("GET");
        if (accessCode != null && !accessCode.isEmpty())
            c.setRequestProperty("X-Access-Code", accessCode);
        c.setConnectTimeout(15000);
        c.setReadTimeout(35000); // long-poll friendly
        InputStream in = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
        Scanner sc = new Scanner(in).useDelimiter("\\A");
        String resp = sc.hasNext() ? sc.next() : "";
        sc.close();
        if (c.getResponseCode() >= 400)
            throw new Exception("HTTP " + c.getResponseCode() + " " + resp);
        return resp;
    }

    private TextView text(String s, int color, float sp) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(color);
        t.setTextSize(sp);
        return t;
    }

    private EditText edit(String value, String hint) {
        EditText e = new EditText(this);
        e.setText(value);
        e.setHint(hint);
        e.setTextColor(0xFFFFFFFF);
        e.setHintTextColor(0xFF8888A0);
        e.setSingleLine(true);
        e.setPadding(0, 24, 0, 24);
        return e;
    }

    private void setBackgroundColor(View v, int color) {
        v.setBackgroundColor(color);
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show();
    }
}
