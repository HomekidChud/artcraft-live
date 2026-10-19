import {findRelevantMemory} from "./memory.js";

export function classify(net, text) {
  const counts = new Map();
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) || []) counts.set(word, (counts.get(word) || 0) + 1);
  const x = net.vocab.map(w => counts.get(w) || 0);
  const norm = Math.hypot(...x);
  if (!norm) return {label: null, confidence: 0, coverage: 0};
  const h = net.b1.map((b, j) => Math.tanh(b + x.reduce((s, v, i) => s + v / norm * net.w1[i][j], 0)));
  const z = net.b2.map((b, j) => b + h.reduce((s, v, i) => s + v * net.w2[i][j], 0));
  const ex = z.map(v => Math.exp(v - Math.max(...z))), total = ex.reduce((a, b) => a + b, 0);
  const best = z.indexOf(Math.max(...z));
  const words = [...counts.keys()];
  return {label: net.labels[best], confidence: ex[best] / total,
    coverage: words.filter(w => net.vocab.includes(w)).length / words.length};
}

const escapeXML = text => text.replace(/[<>&"']/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[c]));
const palette = [
  ["teal", "#178f8a"], ["cream", "#efe5cc"], ["navy", "#243b64"], ["blue", "#3478c8"],
  ["red", "#c94747"], ["orange", "#d97832"], ["green", "#37805a"], ["purple", "#8057a8"],
  ["pink", "#cf6e91"], ["gold", "#c69527"], ["yellow", "#d8af35"]
];

export function makeStarter(craft, brief, memoryEntries = []) {
  const title = brief.slice(0, 100).replace(/[\r\n]/g, " ");
  const memoryNotes = memoryEntries.map(item => typeof item === "string" ? item : item?.text).filter(Boolean).slice(0, 3);
  const notes = memoryNotes.map(note => note.replace(/[\r\n]+/g, " ").slice(0, 400));
  const memoryText = notes.join("; ");
  const rememberedColor = palette.find(([name]) => new RegExp(`\\b${name}\\b`, "i").test(memoryText));
  let text, mime = "text/plain", ext = craft.starter;
  let memoryApplied = false;
  if (ext === "svg") {
    const label = escapeXML(title.slice(0, 45));
    const accent = rememberedColor?.[1] || "#f2b544";
    const description = notes.length ? `<desc>Saved local preferences: ${escapeXML(memoryText.slice(0, 800))}</desc>` : "";
    const body = craft.id === "figcraft"
      ? `<rect x="40" y="40" width="320" height="560" rx="24" fill="#fff" stroke="#292a30"/><rect x="64" y="136" width="272" height="180" rx="8" fill="#e7e0d4"/><rect x="64" y="348" width="180" height="16" fill="#292a30"/><rect x="64" y="388" width="272" height="12" fill="#c4c4c4"/><rect x="64" y="488" width="272" height="48" rx="8" fill="${accent}"/>`
      : `<circle cx="200" cy="235" r="112" fill="${accent}"/><path d="M140 265 L200 150 L260 265Z" fill="#171a22"/>`;
    text = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="640" viewBox="0 0 800 640">${description}<rect width="800" height="640" fill="#f6f2eb"/>${body}<text x="${craft.id === "figcraft" ? 420 : 64}" y="440" fill="#171a22" font-size="24" font-family="sans-serif">${label}</text><text x="64" y="608" font-size="16" fill="#454851">ArtCraft starter asset - customise before use</text></svg>`;
    mime = "image/svg+xml";
    memoryApplied = notes.length > 0;
  } else if (ext === "csv") {
    text = "Category,Planned,Actual,Difference\nMaterials,100,90,10\nTools,50,45,5\nOther,25,20,5\nTotal,175,155,20\n";
    mime = "text/csv";
  } else if (ext === "srt") {
    text = `1\n00:00:00,000 --> 00:00:03,000\n${title}\n\n2\n00:00:03,000 --> 00:00:06,000\nReplace this text and adjust the timing to your footage.\n`;
  } else if (ext === "dxf") {
    text = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
    if (notes.length) {
      text = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
      for (const note of notes) text += `999\nArtCraft saved preference: ${note}\n`;
      memoryApplied = true;
    }
    for (const [x1,y1,x2,y2] of [[0,0,100,0],[100,0,100,60],[100,60,0,60],[0,60,0,0]]) {
      text += `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;
    }
    text += "0\nENDSEC\n0\nEOF\n";
  } else if (ext === "wav") {
    const rate = 22050, count = rate, buffer = new ArrayBuffer(44 + count * 2), v = new DataView(buffer);
    const str = (offset, s) => [...s].forEach((c,i) => v.setUint8(offset+i,c.charCodeAt(0)));
    str(0,"RIFF"); v.setUint32(4,36+count*2,true); str(8,"WAVE"); str(12,"fmt ");
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,rate,true);
    v.setUint32(28,rate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); str(36,"data"); v.setUint32(40,count*2,true);
    for (let i=0;i<count;i++) v.setInt16(44+i*2, Math.sin(2*Math.PI*440*i/rate)*1600*Math.min(1,i/300,(count-i)/300),true);
    return {blob:new Blob([buffer],{type:"audio/wav"}),filename:"soundcraft-quiet-test-tone.wav",note:"One-second, low-level 440 Hz mono test tone. Start playback at a low volume.",memoryApplied:false};
  } else {
    const content = craft.id === "deckcraft"
      ? ["# "+title,"## Slide 1: The idea","State the purpose in one sentence.","## Slide 2: The problem","Describe who needs this and why.","## Slide 3: The approach","Add three concrete actions.","## Slide 4: Evidence","Add verified examples, not invented statistics.","## Slide 5: Next steps","Name an owner and the next decision."]
      : ["# "+title,"## Goal","Describe the intended result and audience.","## Working checklist",...craft.guide.split(". ").map(s=>"- [ ] "+s),"## Delivery",craft.export,"## Notes","Add your own content and verify the result."];
    if (notes.length) {
      content.push("## Saved local preferences", ...notes.map(note => `- ${note}`));
      memoryApplied = true;
    }
    text = content.join("\n\n")+"\n";
    mime = "text/markdown";
  }
  const note = ext === "md" ? "An editable outline or checklist, not a finished native project." : "A fixed starter template, not a neural-generated finished project. Review before importing; import support varies by browser build.";
  return {blob:new Blob([text],{type:mime}),filename:`${craft.id}-starter.${ext}`,
    note: memoryApplied ? `${note} Relevant saved local preferences were included where supported by this format.` : note,
    memoryApplied};
}

function resolveCraft(catalog, text, selected, detected, previousCraft) {
  const explicit = catalog.crafts.find(c => text.toLowerCase().includes(c.id));
  const craftId = selected !== "auto" ? selected : explicit?.id ||
    (detected.confidence > .75 && detected.coverage > .15 ? detected.label : previousCraft);
  return catalog.crafts.find(c => c.id === craftId);
}

function attachMemory(text, entries) {
  if (!entries.length) return text;
  return `${text}\n\nSaved local context considered: ${entries.map(item => item.text).join("; ")}`;
}

export function respond(catalog, model, text, selected, previousCraft, memoryEntries = []) {
  const actions = [];
  const intentResult = classify(model.networks.intent, text);
  actions.push({command:"classify(model.networks.intent, text)", summary:`Request intent: ${intentResult.label || "uncertain"} (${Math.round(intentResult.confidence * 100)}% model score).`});
  const detected = classify(model.networks.craft, text);
  actions.push({command:"classify(model.networks.craft, text)", summary:`Craft candidate: ${detected.label || "uncertain"} (${Math.round(detected.confidence * 100)}% model score).`});
  const craft = resolveCraft(catalog, text, selected, detected, previousCraft);
  const intent = intentResult.confidence > .65 && intentResult.coverage > .15 ? intentResult.label : null;
  const base = {craft, intent, confidence:intentResult.confidence, actions};
  const relevant = craft ? findRelevantMemory(memoryEntries, craft.id, text) : [];
  if (relevant.length) actions.push({command:"findRelevantMemory(memoryEntries, craft.id, text)", summary:`Found ${relevant.length} relevant note(s) stored on this device; none were uploaded.`});
  if (intent === "greeting") return {...base, text:"Hi! Choose a Craft, then ask for a quick guide or a starter file. I’m an offline routing assistant with curated answers, not a general-purpose chatbot."};
  if (intent === "training") return {...base, text:"Two small neural networks route 13 Crafts and six request types using reviewed examples. Replies are curated and starter files are fixed templates; chat is not saved or used for training. I cannot see or control your editor."};
  if (intent === "troubleshoot") {
    if (craft?.id === "effectcraft") {
      return {...base, text:attachMemory("EffectCraft startup check: let the WebAssembly download finish. If the canvas stays blank, try WebGL; if that fails, try CPU mode (slower). On a self-hosted copy, effectcraft_web_bg.wasm should return HTTP 200 with application/wasm. I cannot inspect your browser console from chat.",relevant), recoveryOptions:[{label:"Try WebGL",mode:"webgl"},{label:"Try CPU · slower",mode:"cpu"}]};
    }
    return {...base, text:attachMemory(`${craft?.name || "Craft"} quick check:\n1. Refresh once and wait for app files to finish loading.\n2. If it is still blank, try a recent browser and check the first console error.\n3. Send the maintainer the app name and exact error. I cannot inspect or change the editor from this chat.`,relevant)};
  }
  if (!craft) return {...base, text:"Choose a Craft, or name it in your message. I can help with starting, exporting, loading problems and starter downloads."};
  if (intent === "create") {
    const artifact = makeStarter(craft, text, relevant);
    actions.push({command:"makeStarter(craft, text, relevant)", summary:`Prepared ${artifact.filename} as a local download; it was not imported into or executed by the editor.`});
    const memoryMessage = relevant.length
      ? (artifact.memoryApplied ? " Relevant saved local preferences were included where this template supports them." : " Relevant saved context is shown here but this fixed template cannot apply it directly.")
      : "";
    return {...base, text:`${craft.name} starter ready to review. ${craft.guide}\n\nThis is a fixed starter asset or outline outside the editor; it does not modify your open project.${memoryMessage}`, artifact};
  }
  if (intent === "export") return {...base, text:attachMemory(craft.export,relevant), docs:true};
  if (intent === "help") return {...base, text:attachMemory(craft.guide,relevant), docs:true};
  return {...base, text:`I’m not confident this is supported. For ${craft.name}, try “help me get started”, “how do I export”, or “make a starter file”. I cannot answer arbitrary questions or operate the editor.`, docs:true};
}
