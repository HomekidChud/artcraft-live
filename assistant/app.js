import {respond} from "./engine.js";
import {readAttachment, attachmentReply, formatSize, MAX_FILES} from "./files.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const embedded = params.get("embed") === "1";
if (embedded) {
  document.body.classList.add("embedded");
  document.querySelector(".context-bar").append($("reset"));
  $("message").rows=1;
  $("message").addEventListener("keydown",event=>{
    if(event.key==="Escape")parent.postMessage({type:"artcraft-chat-minimize"},location.origin);
  });
}
let catalog, model, previousCraft, urls = [], pending = [], importing = false, generation = 0;
const welcome = $("welcome");
function updateControls() {
  $("attach").disabled=!model||importing;
  $("send").disabled=!model||importing||(!$("message").value.trim()&&!pending.length);
}
function renderPending() {
  $("attachments").replaceChildren();
  pending.forEach((file,index)=>{
    const chip=document.createElement("div");chip.className="attachment-chip";
    const name=document.createElement("span");name.textContent=`${file.name} · ${formatSize(file.size)}`;name.title=file.name;
    const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.setAttribute("aria-label",`Remove ${file.name}`);
    remove.addEventListener("click",()=>{pending.splice(index,1);renderPending();$("attachment-status").textContent=pending.length?`${pending.length} file(s) ready to send.`:"Attachment removed.";updateControls();});
    chip.append(name,remove);$("attachments").append(chip);
  });
  updateControls();
}
async function addFiles(files) {
  if(!model||importing)return;
  const current=++generation;importing=true;updateControls();
  $("attachment-status").textContent="Reading files locally…";
  const notices=[];
  for(const file of files){
    if(current!==generation)return;
    if(pending.length>=MAX_FILES){notices.push("Only three files can be attached at once.");break;}
    try{
      const attachment=await readAttachment(file);
      if(current!==generation)return;
      pending.push(attachment);
    }catch(error){notices.push(`${file.name.slice(0,80)}: ${error.message}`);}
  }
  if(current!==generation)return;
  importing=false;$("file-input").value="";renderPending();
  $("attachment-status").textContent=[pending.length?`${pending.length} file(s) ready. Send to see local checks.`:"No files attached.",...notices].join(" ");
}
function renderFile(file,container) {
  const box=document.createElement("div");box.className="file-card";
  const name=document.createElement("div");name.className="file-name";name.textContent=`${file.name} · ${formatSize(file.size)}`;
  box.append(name);
  if(file.previewBlob){
    const url=URL.createObjectURL(file.previewBlob);urls.push(url);
    const preview=document.createElement(file.kind==="image"?"img":"audio");
    preview.src=url;
    if(file.kind==="image")preview.alt=`Local preview of ${file.name}`;
    else{preview.controls=true;preview.preload="none";preview.setAttribute("aria-label",`Play ${file.name}`);}
    box.append(preview);
  }
  if(file.preview!==undefined){
    const details=document.createElement("details"),summary=document.createElement("summary"),pre=document.createElement("pre");
    summary.textContent="View text preview";pre.textContent=file.preview;details.append(summary,pre);box.append(details);
  }
  container.append(box);
}
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
  if ((!text&&!pending.length) || !model || importing) return;
  welcome.remove();
  const files=pending;pending=[];
  const user=append("You",text||"Check these attached files.");
  files.forEach(file=>renderFile(file,user));
  if(files.length)append("ArtCraft · Local file checks",attachmentReply(files));
  const result = text ? respond(catalog,model,text,$("craft").value,previousCraft) : null;
  if(!result||(files.length&&!result.intent)){
    $("message").value="";$("attachment-status").textContent="Files checked locally. They were not imported into the editor.";
    renderPending();
    if(embedded)$("messages").scrollTop=$("messages").scrollHeight;
    else $("messages").lastElementChild.scrollIntoView({block:"nearest"});
    $("message").focus({preventScroll:true});return;
  }
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
  $("attachment-status").textContent=files.length?"Files checked locally. They were not imported into the editor.":"";
  renderPending();
  if(embedded)$("messages").scrollTop=$("messages").scrollHeight;
  else article.scrollIntoView({block:"nearest"});
  $("message").focus({preventScroll:true});
}
$("composer").addEventListener("submit",event=>{event.preventDefault();submit($("message").value);});
$("message").addEventListener("keydown",event=>{
  if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){event.preventDefault();submit($("message").value);}
});
$("message").addEventListener("input",updateControls);
$("attach").addEventListener("click",()=>$("file-input").click());
$("file-input").addEventListener("change",()=>addFiles([...$("file-input").files]));
let dragDepth=0;
document.addEventListener("dragenter",event=>{
  if([...event.dataTransfer.types].includes("Files")){event.preventDefault();dragDepth++;document.body.classList.add("file-drag");}
});
document.addEventListener("dragover",event=>{
  if([...event.dataTransfer.types].includes("Files")){event.preventDefault();event.dataTransfer.dropEffect="copy";}
});
document.addEventListener("dragleave",()=>{
  if(--dragDepth<=0){dragDepth=0;document.body.classList.remove("file-drag");}
});
document.addEventListener("drop",event=>{
  if(![...event.dataTransfer.types].includes("Files"))return;
  event.preventDefault();dragDepth=0;document.body.classList.remove("file-drag");
  if(event.dataTransfer.files.length)addFiles([...event.dataTransfer.files]);
});
document.querySelectorAll("[data-prompt]").forEach(button=>button.addEventListener("click",()=>submit(button.dataset.prompt)));
$("craft").addEventListener("change",()=>{previousCraft=null;syncCraft();});
$("reset").addEventListener("click",()=>{
  $("messages").querySelectorAll("audio").forEach(audio=>audio.pause());
  urls.forEach(URL.revokeObjectURL);urls=[];previousCraft=null;
  generation++;pending=[];importing=false;$("file-input").value="";$("attachment-status").textContent="";renderPending();
  $("messages").replaceChildren(welcome);$("message").value="";updateControls();$("message").focus();
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
  $("message").disabled=false;updateControls();
  $("metrics").textContent=`Trained from scratch: ${model.epochs} epochs per network. Craft routing: ${model.metrics.craft.correct}/${model.metrics.craft.total}; request routing: ${model.metrics.intent.correct}/${model.metrics.intent.total}. These are small curated smoke tests, not proof of general chat ability. Checkpoint: ${model.trained_at}.`;
}catch(error){
  model=null;$("message").disabled=true;updateControls();
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
