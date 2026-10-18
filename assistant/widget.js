// Isolated DOM overlay. Does not alter WASM bindings, canvas or editor project data.
(()=>{
  if(document.getElementById("artcraft-chat-widget"))return;
  const script=document.currentScript;
  const base=new URL("./",script.src);
  const craft=script.dataset.craft||"auto";
  const host=document.createElement("div");
  host.id="artcraft-chat-widget";
  host.style.cssText="position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:2147483646";
  const root=host.attachShadow({mode:"open"});
  const style=document.createElement("style");
  style.textContent=`
    *{box-sizing:border-box}
    :host{font-family:Inter,system-ui,sans-serif;color-scheme:dark}
    button{min-height:44px;font:600 14px Inter,system-ui,sans-serif;cursor:pointer;border-radius:8px}
    .tab{display:grid;place-items:center;width:44px;height:44px;padding:0;border-radius:50%;background:#f2b544;color:#171a22;border:1px solid #d9a13a;box-shadow:0 4px 20px #0004}
    .tab svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .panel{position:absolute;right:0;bottom:54px;width:min(360px,calc(100vw - 24px));height:min(560px,calc(100dvh - 90px));border:1px solid #454f60;border-radius:12px;overflow:hidden;background:#11141b;box-shadow:0 16px 64px #0008;display:flex;flex-direction:column}
    .panel.expanded{width:min(520px,calc(100vw - 24px));height:min(760px,calc(100dvh - 90px))}
    .panel[hidden]{display:none}.bar{display:flex;align-items:center;gap:4px;padding:0 4px 0 12px;flex-shrink:0;background:#191d26;color:#eef0f5;font-size:13px;border-bottom:1px solid #333b49}
    .bar span{margin-right:auto;font-weight:600}.bar button{width:44px;background:transparent;color:#eef0f5;border:0;padding:0;font-size:20px}.bar a{display:grid;place-items:center;width:44px;min-height:44px;color:#f2b544;font-size:18px;text-decoration:none}.bar button:hover,.bar a:hover{background:#2b3340}
    iframe{width:100%;flex:1;border:0;min-height:0}button:focus-visible,a:focus-visible{outline:2px solid #fff;outline-offset:2px}`;
  const tab=document.createElement("button");tab.className="tab";
  tab.setAttribute("aria-label","Open ArtCraft chat");tab.title="ArtCraft chat";
  const icon=document.createElementNS("http://www.w3.org/2000/svg","svg");
  icon.setAttribute("viewBox","0 0 24 24");icon.setAttribute("aria-hidden","true");
  const path=document.createElementNS("http://www.w3.org/2000/svg","path");
  path.setAttribute("d","M20 11.5a8 8 0 0 1-8 8H5l-4 3 1.4-6A8 8 0 1 1 20 11.5ZM7 9h8M7 13h5");
  icon.append(path);tab.append(icon);
  tab.setAttribute("aria-expanded","false");tab.setAttribute("aria-controls","craft-chat-panel");
  const panel=document.createElement("section");panel.className="panel";panel.id="craft-chat-panel";panel.hidden=true;
  panel.setAttribute("aria-label","ArtCraft chat");
  const bar=document.createElement("div");bar.className="bar";
  const label=document.createElement("span");label.textContent="ArtCraft";
  const full=document.createElement("a");full.textContent="↗";full.title="Open chat in a full tab";full.setAttribute("aria-label","Open chat in a full tab");full.href=new URL(`index.html?craft=${encodeURIComponent(craft)}`,base);full.target="_blank";full.rel="noopener";
  const expand=document.createElement("button");expand.textContent="⤢";expand.title="Expand chat";expand.setAttribute("aria-label","Expand chat");expand.setAttribute("aria-pressed","false");
  const minimize=document.createElement("button");minimize.textContent="−";minimize.title="Minimize chat";minimize.setAttribute("aria-label","Minimize ArtCraft chat");
  bar.append(label,full,expand,minimize);panel.append(bar);
  let frame;
  function toggle(open){
    if(open&&!frame){frame=document.createElement("iframe");frame.title="Offline ArtCraft assistant";frame.src=new URL(`index.html?embed=1&craft=${encodeURIComponent(craft)}`,base);panel.append(frame);}
    panel.hidden=!open;tab.setAttribute("aria-expanded",String(open));
    tab.setAttribute("aria-label",open?"Minimize ArtCraft chat":"Open ArtCraft chat");
    if(!open)tab.focus();else minimize.focus();
  }
  tab.addEventListener("click",()=>toggle(panel.hidden));minimize.addEventListener("click",()=>toggle(false));
  expand.addEventListener("click",()=>{
    const expanded=panel.classList.toggle("expanded");
    expand.setAttribute("aria-pressed",String(expanded));expand.setAttribute("aria-label",expanded?"Restore compact chat":"Expand chat");expand.title=expanded?"Restore compact chat":"Expand chat";
  });
  root.addEventListener("keydown",event=>{if(event.key==="Escape")toggle(false);});
  window.addEventListener("message",event=>{
    if(event.origin===base.origin&&event.source===frame?.contentWindow&&event.data?.type==="artcraft-chat-minimize")toggle(false);
  });
  root.append(style,panel,tab);document.body.append(host);
})();
