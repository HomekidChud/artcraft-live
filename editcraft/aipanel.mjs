/* Shared mountable Claude AI panel for EditCraft media tools.
 * Uses the same BYOK engine as the document editor (assistant/claude.js).
 * The key stays in this tab's memory only and is sent directly to Anthropic.
 * Quick actions ask Claude for a strict JSON patch, which the host page
 * validates against its own allowlist before applying. No code is executed. */
import { callClaude, CLAUDE_DEFAULT_MODEL } from "../assistant/claude.js";

export function mountAIPanel({ container, toolLabel, systemPrompt, quickActions = [], onPatch }) {
  container.innerHTML = `
  <div class="ai-box">
    <div class="ai-head">Claude in ${toolLabel}</div>
    <form class="ai-key" data-testid="ai-key-form">
      <input class="ai-key-input" type="password" placeholder="Anthropic API key — kept in this tab only" autocomplete="off" aria-label="Anthropic API key">
      <select class="ai-model" aria-label="Claude model">
        <option value="claude-sonnet-5-5">claude-sonnet-5-5 (balanced)</option>
        <option value="claude-haiku-5-5">claude-haiku-5-5 (fast)</option>
        <option value="claude-opus-5-5">claude-opus-5-5 (strongest)</option>
      </select>
      <button class="ai-connect" type="submit">Connect</button>
      <button class="ai-disconnect" type="button" hidden>Disconnect</button>
    </form>
    <details class="ai-note"><summary>How your key and costs work</summary>
      <p>This is a public static site: the key stays in this tab's memory only, is never saved to storage, and is sent directly to Anthropic with the browser-access header. Use a restricted, low-limit key you can revoke. <strong>API use costs money on your key</strong>.</p></details>
    <div class="ai-quick" data-testid="ai-quick"></div>
    <div class="ai-log" data-testid="ai-log" aria-live="polite"></div>
    <div class="ai-status" data-testid="ai-status" role="status"></div>
    <form class="ai-compose" data-testid="ai-compose">
      <textarea class="ai-input" rows="2" placeholder="Ask Claude… e.g. 'make it moody' or 'suggest a title'"></textarea>
      <button class="ai-send" type="submit">Send</button>
    </form>
  </div>`;
  const $ = s => container.querySelector(s);
  const keyForm = $("[data-testid=ai-key-form]");
  const quickBox = $("[data-testid=ai-quick]");
  const log = $("[data-testid=ai-log]");
  const status = $("[data-testid=ai-status]");
  const compose = $("[data-testid=ai-compose]");
  const model = $(".ai-model");
  let apiKey = null;
  let busy = false;
  const history = [];

  const bubble = (role, text) => {
    const div = document.createElement("div");
    div.className = "ai-msg " + role;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  };
  const setStatus = t => { status.textContent = t || ""; };

  for (const action of quickActions) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = action.label;
    b.dataset.testid = "ai-quick-" + action.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    b.addEventListener("click", () => runQuick(action));
    quickBox.appendChild(b);
  }

  keyForm.addEventListener("submit", e => {
    e.preventDefault();
    const input = $(".ai-key-input");
    const v = input.value.trim();
    if (!v) { setStatus("Enter a key first."); return; }
    apiKey = v;
    input.value = "";
    input.disabled = true;
    $(".ai-connect").hidden = true;
    $(".ai-disconnect").hidden = false;
    setStatus("Key accepted — stored in this tab only.");
  });
  $(".ai-disconnect").addEventListener("click", () => {
    apiKey = null;
    $(".ai-key-input").disabled = false;
    $(".ai-connect").hidden = false;
    $(".ai-disconnect").hidden = true;
    setStatus("Key cleared.");
  });

  async function askClaude(extraText, systemOverride) {
    if (!apiKey) throw new Error("Connect a Claude API key first (BYOK — your key, direct to Anthropic).");
    // chat turns already live in history; quick-action prompts are passed in
    // explicitly so they are always part of the request
    const messages = history.slice(-8);
    if (extraText) messages.push({ role: "user", content: extraText });
    const answer = await callClaude({
      apiKey, model: model.value || CLAUDE_DEFAULT_MODEL,
      system: systemOverride || systemPrompt,
      messages,
      maxTokens: 800
    });
    return answer;
  }

  async function runQuick(action) {
    if (busy) return;
    if (!apiKey) { bubble("err", "Connect your Anthropic API key first."); return; }
    busy = true;
    setStatus("Asking Claude…");
    bubble("user", action.label);
    try {
      const answer = await askClaude(action.prompt, action.system || systemPrompt);
      let patch = null;
      const m = answer.match(/\{[\s\S]*\}/);
      if (m) {
        try { patch = JSON.parse(m[0]); } catch (e) { /* not JSON — treat as chat */ }
      }
      if (patch && typeof onPatch === "function") {
        const applied = onPatch(patch);
        bubble("bot", "Applied: " + (applied || "changes updated. Hit undo if you dislike them."));
      } else {
        bubble("bot", answer);
      }
      setStatus("");
    } catch (err) {
      bubble("err", String(err.message || err));
      setStatus("");
    }
    busy = false;
  }

  compose.addEventListener("submit", async e => {
    e.preventDefault();
    const input = $(".ai-input");
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    input.value = "";
    bubble("user", text);
    history.push({ role: "user", content: text });
    setStatus("Thinking…");
    try {
      const answer = await askClaude(null); // the user's turn is already in history
      history.push({ role: "assistant", content: answer });
      bubble("bot", answer);
    } catch (err) {
      bubble("err", String(err.message || err));
    }
    setStatus("");
    busy = false;
  });
}
