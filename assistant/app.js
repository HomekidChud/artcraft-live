import {respond} from "./engine.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.get("embed") === "1") document.body.classList.add("embedded");
let catalog, model, previousCraft, urls = [];
const welcome = $("welcome");
function append(speaker, text) {
  const article = document.createElement("article");
  article.className = `message ${speaker === "You" ? "user" : "assistant"}`;
  const label = document.createElement("div"); label.className = "speaker"; label.textContent = speaker;
  const body = document.createElement("div"); body.className = "body"; body.textContent = text;
  article.append(label,body); $("messages").append(article);
  return article;
}
function syncCraft() {
  const craft = catalog.crafts.find(c=>c.id===$("craft").value);
  $("open-craft").hidden = !craft;
  if (craft) $("open-craft").href = `../${craft.id}/index.html`;
  const buttons = welcome.querySelectorAll("[data-prompt]");
  const helpCraft = craft || catalog.crafts[0];
  const starterCraft = craft || catalog.crafts.find(c=>c.id==="gridcraft");
  buttons[0].dataset.prompt = `Help me get started with ${helpCraft.name}`;
  buttons[0].lastChild.textContent = `Help me get started with ${helpCraft.name} ↗`;
  buttons[1].dataset.prompt = `${starterCraft.example} in ${starterCraft.name}`;
  buttons[1].lastChild.textContent = `Create a ${starterCraft.name} starter ↗`;
}
function submit(text) {
  text = text.trim().slice(0,2000);
  if (!text || !model) return;
  welcome.remove();
  append("You",text);
  const result = respond(catalog,model,text,$("craft").value,previousCraft);
  if (result.craft) previousCraft = result.craft.id;
  const article = append(result.craft ? `ArtCraft · ${result.craft.name}` : "ArtCraft",result.text);
  if (result.artifact) {
    const a = document.createElement("a"); a.className = "download";
    a.href = URL.createObjectURL(result.artifact.blob); urls.push(a.href);
    a.download = result.artifact.filename; a.textContent = `Download ${result.artifact.filename}`;
    const note = document.createElement("p"); note.className = "note"; note.textContent = result.artifact.note;
    article.append(a,note);
  }
  if (result.docs && result.craft) {
    const a = document.createElement("a"); a.className = "docs";
    a.href = `https://github.com/HomekidChud/artcraft-live/blob/main/${result.craft.id}/README.md`;
    a.target = "_blank"; a.rel = "noopener"; a.textContent = `Read the bundled ${result.craft.name} documentation ↗`;
    article.append(a);
    const note = document.createElement("p"); note.className = "note";
    note.textContent = "Guidance is a curated workflow summary. Desktop documentation may describe features not available in this web build.";
    article.append(note);
  }
  $("message").value = "";
  article.scrollIntoView({block:"nearest"});
  $("message").focus({preventScroll:true});
}
$("composer").addEventListener("submit",event=>{event.preventDefault();submit($("message").value);});
$("message").addEventListener("keydown",event=>{
  if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){event.preventDefault();submit($("message").value);}
});
document.querySelectorAll("[data-prompt]").forEach(button=>button.addEventListener("click",()=>submit(button.dataset.prompt)));
$("craft").addEventListener("change",()=>{previousCraft=null;syncCraft();});
$("reset").addEventListener("click",()=>{
  urls.forEach(URL.revokeObjectURL);urls=[];previousCraft=null;
  $("messages").replaceChildren(welcome);$("message").value="";$("message").focus();
});
try {
  const responses = await Promise.all([fetch("./catalog.json"),fetch("./model.json")]);
  if (responses.some(r=>!r.ok)) throw new Error("Missing model or catalog.");
  [catalog,model] = await Promise.all(responses.map(r=>r.json()));
  if(model.schema!==1||!model.accepted) throw new Error("No approved model available.");
  for(const craft of catalog.crafts){
    const option = document.createElement("option");option.value=craft.id;option.textContent=craft.name;$("craft").append(option);
  }
  if(catalog.crafts.some(c=>c.id===params.get("craft"))) $("craft").value=params.get("craft");
  syncCraft();
  $("status").textContent="Local network ready · Runs on your device · No chat uploads";
  $("status").classList.add("ready");
  $("message").disabled=false;$("send").disabled=false;
  $("metrics").textContent=`Trained from scratch: ${model.epochs} epochs per network. Craft routing: ${model.metrics.craft.correct}/${model.metrics.craft.total}; request routing: ${model.metrics.intent.correct}/${model.metrics.intent.total}. These are small curated smoke tests, not proof of general chat ability. Checkpoint: ${model.trained_at}.`;
}catch(error){
  $("status").textContent="The local model could not load. Reload while connected, or serve this folder using a local web server.";
  $("metrics").textContent="No model loaded; chat is disabled rather than pretending the network is ready.";
}
if ("serviceWorker" in navigator) {
  try {
    await navigator.serviceWorker.register("./sw.js");
    const registration = await navigator.serviceWorker.ready;
    if (registration.active) $("offline-status").textContent="Offline chat cache is installed for this assistant URL. Reload once while connected, then this page can reopen offline. Editor downloads are not included.";
    navigator.serviceWorker.addEventListener("message",event=>{
      if(event.data?.type==="offline-ready") $("offline-status").textContent="Offline chat cache is ready. This assistant can reopen offline; editors are not included.";
    });
  } catch {
    $("offline-status").textContent="Offline caching is unavailable here. Chat still works in this open tab; reopening offline is not guaranteed.";
  }
} else $("offline-status").textContent="This browser does not support the offline cache. Chat works in this open tab only.";
