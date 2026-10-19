import {respond} from "./engine.js";
import {readAttachment, attachmentReply, formatSize, MAX_FILES} from "./files.js";
import {recognizeImage, formatVision, MATCH_THRESHOLD} from "./vision.js";
import {loadMemory, setMemoryEnabled, addMemoryItem, clearMemory, forgetMemory, setLastCraft, parseMemoryCommand} from "./memory.js";

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
let catalog, model, urls = [], pending = [], importing = false, generation = 0;
let memory = loadMemory();
let previousCraft = memory.enabled ? memory.lastCraft : null;
const welcome = $("welcome");

function updateControls() {
  $("attach").disabled=!model||importing;
  $("send").disabled=!model||importing||(!$('message').value.trim()&&!pending.length);
}
function updateMemoryControls() {
  const toggle=$("memory-toggle");
  toggle.textContent=memory.enabled?`Memory on · ${memory.entries.length}`:"Memory off";
  toggle.setAttribute("aria-pressed",String(memory.enabled));
  toggle.disabled=!memory.available;
  $("memory-clear").hidden=memory.entries.length===0;
  $("memory-clear").disabled=!memory.available;
  $("memory-info").textContent=!memory.available
    ? "This browser blocked local storage, so persistent memory is unavailable. Chat still works without it."
    : memory.enabled
      ? `On this browser only: ${memory.entries.length} explicitly saved note(s)${memory.lastCraft?" and your last Craft" : ""}. Chats and files are not stored. Use “forget all” or the button below to erase notes.`
      : `Off. Chat and files are not stored. ${memory.entries.length?`${memory.entries.length} saved note(s) remain on this browser but are not used until memory is enabled.`:"Enable it to save only notes you explicitly ask it to remember."}`;
}
function renderTrace(article, actions) {
  if(!actions?.length)return;
  const details=document.createElement("details");details.className="action-trace";
  const summary=document.createElement("summary");summary.textContent=`Show task steps · ${actions.length}`;
  const note=document.createElement("p");note.className="trace-note";
  note.textContent="Local browser actions only. These are not terminal shell commands and do not control the editor.";
  const list=document.createElement("ol");
  for(const action of actions){
    const item=document.createElement("li"),code=document.createElement("code"),result=document.createElement("span");
    code.textContent=action.command;result.textContent=action.summary;
    item.append(code,result);list.append(item);
  }
  details.append(summary,note,list);article.append(details);
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
      attachment.actions=[{command:"readAttachment(file)",summary:"Checked the file locally; its contents were not uploaded or executed."}];
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
function handleMemoryCommand(text) {
  const command=parseMemoryCommand(text);
  if(!command)return false;
  const actions=[];
  let answer="";
  if(command.type==="remember"){
    if(!memory.available){
      answer="This browser blocks local storage, so I cannot save a persistent note here.";
      actions.push({command:"addMemoryItem(memory, command.text, craftId)",summary:"Not run because browser storage is unavailable."});
    }else if(!memory.enabled){
      answer="Local memory is off, so I did not save that. Turn on the Memory control above, then send the remember request again. No conversation is saved automatically.";
      actions.push({command:"addMemoryItem(memory, command.text, craftId)",summary:"Not run because you have not enabled local memory."});
    }else{
      const craftId=$("craft").value!=="auto"?$("craft").value:(previousCraft||memory.lastCraft||null);
      const result=addMemoryItem(memory,command.text,craftId);
      if(result.ok){
        answer=`Saved locally on this browser: “${result.item.text}”${craftId?` (${craftId})`:""}. It is not training data and is not synced to other devices.`;
        actions.push({command:"addMemoryItem(memory, command.text, craftId)",summary:"Saved one explicit note in this browser's local storage; no chat transcript was saved."});
      }else{
        answer="I could not save that note in browser storage. The chat still works without persistent memory.";
        actions.push({command:"addMemoryItem(memory, command.text, craftId)",summary:"Save failed; no note was persisted."});
      }
    }
  }else if(command.type==="recall"){
    memory=loadMemory();
    const visible=memory.entries.map((entry,index)=>`${index+1}. ${entry.text}${entry.craftId?` (${entry.craftId})`:""}`);
    answer=visible.length?`${memory.enabled?"Your local saved notes":"Saved notes on this browser (memory is currently off)"}:\n${visible.join("\n")}`:"There are no saved local notes on this browser.";
    actions.push({command:"loadMemory()",summary:`Read ${memory.entries.length} saved note(s) from this browser; nothing was sent anywhere.`});
  }else if(command.type==="forget-all"){
    const count=memory.entries.length;
    const ok=clearMemory(memory);
    previousCraft=null;
    answer=ok?`Forgot ${count} saved note(s) and the remembered last Craft on this browser.`:"Could not clear browser storage; some saved data may remain.";
    actions.push({command:"clearMemory(memory)",summary:ok?`Removed ${count} note(s) and the remembered last Craft from local storage.`:"Clear failed; storage may still contain the data."});
  }else if(command.type==="forget-one"){
    const result=forgetMemory(memory,command.query);
    answer=result.storageError?"Could not update browser storage; the requested note may remain.":result.removed?`Forgot ${result.removed} matching note(s). ${result.remaining} note(s) remain.`:"I did not find a saved note containing that phrase.";
    actions.push({command:"forgetMemory(memory, command.query)",summary:result.storageError?"Remove operation failed to persist.":`Removed ${result.removed} matching note(s) from local storage.`});
  }
  updateMemoryControls();
  renderTrace(append("ArtCraft · Local memory",answer),actions);
  return true;
}
async function submit(text) {
  text = text.trim().slice(0,2000);
  if ((!text&&!pending.length) || !model || importing) return;
  welcome.remove();
  const files=pending;pending=[];
  const user=append("You",text||"Check these attached files.");
  files.forEach(file=>renderFile(file,user));
  if(files.length){
    const fileArticle=append("ArtCraft · Local file checks",attachmentReply(files));
    renderTrace(fileArticle,files.flatMap(file=>file.actions||[]));
  }
  if(text&&handleMemoryCommand(text)){
    $("message").value="";$("attachment-status").textContent=files.length?"Files checked locally. They were not imported into the editor.":"";
    renderPending();
    if(embedded)$("messages").scrollTop=$("messages").scrollHeight;
    else $("messages").lastElementChild.scrollIntoView({block:"nearest"});
    $("message").focus({preventScroll:true});return;
  }
  const images = files.filter(file=>file.kind==="image");
  let recognizedCraft=null;
  if (images.length) {
    const article = append("ArtCraft · Image recognition","Preparing the local vision model…");
    const body = article.querySelector(".body");
    const actions=[];
    const say = message => { body.textContent = message; scroll(); };
    const scroll = () => embedded ? $("messages").scrollTop=$("messages").scrollHeight : article.scrollIntoView({block:"nearest"});
    try {
      const parts = [];
      for (const file of images) {
        const onStatus = status => say(`${file.name}: ${status}`);
        const ranked = await recognizeImage(file.previewBlob, onStatus);
        actions.push({command:"recognizeImage(file.previewBlob, onStatus)",summary:`Compared ${file.name} against the supported Craft categories on this device.`});
        if (ranked[0] && ranked[0].confidence >= MATCH_THRESHOLD) recognizedCraft = ranked[0].craft;
        parts.push(`${file.name} — ${formatVision(ranked)}`);
      }
      say(parts.join("\n\n"));
    } catch (error) {
      actions.push({command:"recognizeImage(file.previewBlob, status => say(...))",summary:"Attempted on-device image recognition; the local vision model was unavailable."});
      say("Image recognition is unavailable right now (" + (error?.message || "the vision model could not load") + "). "
        + "The first analysis downloads the vision model, which needs a connection; the browser caches it, though it may need downloading again if evicted. "
        + "The image stayed on this device either way.");
    }
    renderTrace(article,actions);
  }
  const namesCraft = text && catalog.crafts.some(craft => text.toLowerCase().includes(craft.id));
  const craftChoice = (images.length && recognizedCraft && $("craft").value === "auto" && !namesCraft) ? recognizedCraft : $("craft").value;
  const result = text ? respond(catalog,model,text,craftChoice,previousCraft,memory.enabled?memory.entries:[]) : null;
  if(!result||(files.length&&!result.intent)){
    $("message").value="";$("attachment-status").textContent="Files checked locally. They were not imported into the editor.";
    renderPending();
    if(embedded)$("messages").scrollTop=$("messages").scrollHeight;
    else $("messages").lastElementChild.scrollIntoView({block:"nearest"});
    $("message").focus({preventScroll:true});return;
  }
  if (result.craft) {
    previousCraft = result.craft.id;
    if(memory.enabled&&memory.lastCraft!==result.craft.id){
      if(setLastCraft(memory,result.craft.id)) result.actions.push({command:"setLastCraft(memory, result.craft.id)",summary:"Updated the remembered last Craft on this browser; no conversation content was saved."});
      else result.actions.push({command:"setLastCraft(memory, result.craft.id)",summary:"Could not persist the last Craft to browser storage."});
    }
  }
  const article = append(result.craft ? `ArtCraft · ${result.craft.name}` : "ArtCraft",result.text);
  renderTrace(article,result.actions);
  if(result.recoveryOptions?.length){
    const links=document.createElement("div");links.className="recovery-links";
    for(const option of result.recoveryOptions){
      const url=new URL("../effectcraft/",location.href);url.searchParams.set(option.mode,"");
      const link=document.createElement("a");link.className="recovery-link";link.href=url.href;
      link.target="_blank";link.rel="noopener";link.textContent=option.label;links.append(link);
    }
    article.append(links);
  }
  if (result.artifact) {
    const a = document.createElement("a"); a.className = "download";
    a.href = URL.createObjectURL(result.artifact.blob); urls.push(a.href);
    a.download = result.artifact.filename; a.textContent = `Download ${result.artifact.filename}`;
    const note = document.createElement("p"); note.className = "note"; note.textContent = result.artifact.note;
    article.append(a,note);
  }
  if (result.docs && result.craft) {
    const a = document.createElement("a");
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
$("memory-toggle").addEventListener("click",()=>{
  const enabled=!memory.enabled;
  const ok=setMemoryEnabled(memory,enabled);
  if(!ok)memory=loadMemory();
  if(!memory.enabled)previousCraft=null;
  else if(memory.lastCraft)previousCraft=memory.lastCraft;
  updateMemoryControls();
  $("attachment-status").textContent=ok?`Local memory ${enabled?"enabled":"disabled"}. ${enabled?"Only explicit notes and the last Craft are saved on this browser.":"Saved notes remain on this browser until you clear them."}`:"Could not change memory settings in this browser.";
});
$("memory-clear").addEventListener("click",()=>{
  const count=memory.entries.length;
  const ok=clearMemory(memory);previousCraft=null;updateMemoryControls();
  $("attachment-status").textContent=ok?`Cleared ${count} saved note(s) and the remembered last Craft from this browser.`:"Could not clear browser storage.";
});
$("craft").addEventListener("change",()=>{previousCraft=null;syncCraft();});
$("reset").addEventListener("click",()=>{
  $("messages").querySelectorAll("audio").forEach(audio=>audio.pause());
  urls.forEach(URL.revokeObjectURL);urls=[];previousCraft=memory.enabled?memory.lastCraft:null;
  generation++;pending=[];importing=false;$("file-input").value="";$("attachment-status").textContent="";renderPending();
  $("messages").replaceChildren(welcome);$("message").value="";updateControls();$("message").focus();
});
updateMemoryControls();
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
  $("status").textContent="Ready";
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
} else $("offline-status").textContent="This browser does not support the offline cache. Chat works in this tab only.";
