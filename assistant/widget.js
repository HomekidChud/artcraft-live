// Isolated DOM overlay. Does not alter WASM bindings, canvas or editor project data.
(()=>{
  const script=document.currentScript;
  const base=new URL("./",script.src);
  const craft=script.dataset.craft||"auto";
  const host=document.createElement("div");
  host.style.cssText="position:fixed;right:16px;bottom:16px;z-index:2147483646";
  const root=host.attachShadow({mode:"open"});
  const style=document.createElement("style");
  style.textContent=`
    :host{font-family:Inter,system-ui,sans-serif;color-scheme:dark}
    button{min-height:44px;font:600 14px Inter,system-ui,sans-serif;cursor:pointer;border-radius:8px}
    .tab{padding:12px 20px;background:#f2b544;color:#171a22;border:1px solid #d9a13a;box-shadow:0 4px 20px #0004}
    .panel{position:absolute;right:0;bottom:56px;width:min(440px,calc(100vw - 32px));height:min(720px,calc(100dvh - 100px));border:1px solid #454f60;border-radius:10px;overflow:hidden;background:#11141b;box-shadow:0 16px 64px #0008;display:flex;flex-direction:column}
    .panel[hidden]{display:none}.bar{display:flex;align-items:center;justify-content:space-between;padding:4px 8px 4px 16px;background:#191d26;color:#eef0f5;font-size:14px}
    .bar button{background:transparent;color:#eef0f5;border:0;padding:8px 12px}.bar a{color:#f2b544;font-size:12px}
    iframe{width:100%;flex:1;border:0;min-height:0}button:focus-visible,a:focus-visible{outline:2px solid #fff;outline-offset:2px}`;
  const tab=document.createElement("button");tab.className="tab";tab.textContent="Chat with ArtCraft";
  tab.setAttribute("aria-expanded","false");tab.setAttribute("aria-controls","craft-chat-panel");
  const panel=document.createElement("section");panel.className="panel";panel.id="craft-chat-panel";panel.hidden=true;
  panel.setAttribute("aria-label","ArtCraft chat");
  const bar=document.createElement("div");bar.className="bar";
  const label=document.createElement("span");label.textContent="ArtCraft Chat";
  const full=document.createElement("a");full.textContent="Full tab ↗";full.href=new URL(`index.html?craft=${encodeURIComponent(craft)}`,base);full.target="_blank";full.rel="noopener";
  const close=document.createElement("button");close.textContent="Close";close.setAttribute("aria-label","Close ArtCraft chat");
  bar.append(label,full,close);panel.append(bar);
  let frame;
  function toggle(open){
    if(open&&!frame){frame=document.createElement("iframe");frame.title="Offline ArtCraft assistant";frame.src=new URL(`index.html?embed=1&craft=${encodeURIComponent(craft)}`,base);panel.append(frame);}
    panel.hidden=!open;tab.setAttribute("aria-expanded",String(open));
    if(!open)tab.focus();else close.focus();
  }
  tab.addEventListener("click",()=>toggle(panel.hidden));close.addEventListener("click",()=>toggle(false));
  root.addEventListener("keydown",event=>{if(event.key==="Escape")toggle(false);});
  root.append(style,panel,tab);document.body.append(host);
})();
