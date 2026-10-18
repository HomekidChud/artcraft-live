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
export function makeStarter(craft, brief) {
  const title = brief.slice(0, 100).replace(/[\r\n]/g, " ");
  let text, mime = "text/plain", ext = craft.starter;
  if (ext === "svg") {
    const label = escapeXML(title.slice(0, 45));
    const body = craft.id === "figcraft"
      ? '<rect x="40" y="40" width="320" height="560" rx="24" fill="#fff" stroke="#292a30"/><rect x="64" y="136" width="272" height="180" rx="8" fill="#e7e0d4"/><rect x="64" y="348" width="180" height="16" fill="#292a30"/><rect x="64" y="388" width="272" height="12" fill="#c4c4c4"/><rect x="64" y="488" width="272" height="48" rx="8" fill="#f2b544"/>'
      : '<circle cx="200" cy="235" r="112" fill="#f2b544"/><path d="M140 265 L200 150 L260 265Z" fill="#171a22"/>';
    text = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="640" viewBox="0 0 800 640"><rect width="800" height="640" fill="#f6f2eb"/>${body}<text x="${craft.id === "figcraft" ? 420 : 64}" y="440" fill="#171a22" font-size="24" font-family="sans-serif">${label}</text><text x="64" y="608" font-size="16" fill="#454851">ArtCraft starter asset - customise before use</text></svg>`;
    mime = "image/svg+xml";
  } else if (ext === "csv") {
    text = "Category,Planned,Actual,Difference\nMaterials,100,90,10\nTools,50,45,5\nOther,25,20,5\nTotal,175,155,20\n";
    mime = "text/csv";
  } else if (ext === "srt") {
    text = `1\n00:00:00,000 --> 00:00:03,000\n${title}\n\n2\n00:00:03,000 --> 00:00:06,000\nReplace this text and adjust the timing to your footage.\n`;
  } else if (ext === "dxf") {
    text = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
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
    return {blob:new Blob([buffer],{type:"audio/wav"}),filename:"soundcraft-quiet-test-tone.wav",note:"One-second, low-level 440 Hz test tone. Start playback at a low volume."};
  } else {
    const content = craft.id === "deckcraft"
      ? ["# "+title,"## Slide 1: The idea","State the purpose in one sentence.","## Slide 2: The problem","Describe who needs this and why.","## Slide 3: The approach","Add three concrete actions.","## Slide 4: Evidence","Add verified examples, not invented statistics.","## Slide 5: Next steps","Name an owner and the next decision."]
      : ["# "+title,"## Goal","Describe the intended result and audience.","## Working checklist",...craft.guide.split(". ").map(s=>"- [ ] "+s),"## Delivery",craft.export,"## Notes","Add your own content and verify the result."];
    text = content.join("\n\n")+"\n";
    mime = "text/markdown";
  }
  return {blob:new Blob([text],{type:mime}),filename:`${craft.id}-starter.${ext}`,
    note: ext === "md" ? "An editable outline or checklist, not a finished native project." : "A fixed starter template, not a neural-generated finished project. Review before importing; import support varies by browser build."};
}

export function respond(catalog, model, text, selected, previousCraft) {
  const intentResult = classify(model.networks.intent, text);
  const detected = classify(model.networks.craft, text);
  const explicit = catalog.crafts.find(c => text.toLowerCase().includes(c.id));
  const craftId = selected !== "auto" ? selected : explicit?.id ||
    (detected.confidence > .75 && detected.coverage > .15 ? detected.label : previousCraft);
  const craft = catalog.crafts.find(c=>c.id===craftId);
  const intent = intentResult.confidence > .65 && intentResult.coverage > .15 ? intentResult.label : null;
  const base = {craft, intent, confidence:intentResult.confidence};
  if (intent === "greeting") return {...base, text:"Hello! I can help you get started with each Craft, explain export workflows, troubleshoot loading and make starter files. Choose a Craft and tell me what you want to make. I’m a small offline routing network with curated answers, not a general-purpose chatbot."};
  if (intent === "training") return {...base, text:"Two small neural classifiers were trained from random weights using manual backpropagation: one selects a Craft, the other selects a supported request type. Replies and starter files use curated guidance and fixed templates, not a generative language model. Chats are kept only in this tab’s memory and are never used for training automatically. The separate Python worker trains only when approved data changes, and needs an always-on computer. I cannot see or control your editor."};
  if (intent === "troubleshoot") return {...base, text:`${craft?.name || "Craft"} loading checklist:\n1. Save any work you can before refreshing.\n2. Check that the app’s JavaScript and WebAssembly downloads finished.\n3. Try a recent desktop browser with WebAssembly enabled.\n4. Check the browser console for the first error and note the app name.\n5. Try a small supported file before a large project.\nTell the maintainer the exact error. I cannot inspect the editor or fix files from this chat.`};
  if (!craft) return {...base, text:"Which Craft are you working in? Choose one above, or name it in your message. I support getting-started guidance, export help, loading problems and starter templates for all 13 apps."};
  if (intent === "create") return {...base, text:`I can make a ${craft.name} starter for you to review and download. ${craft.guide}\n\nThis creates a fixed starter asset or outline outside the editor; it does not modify your current project.`, artifact:makeStarter(craft,text)};
  if (intent === "export") return {...base, text:craft.export, docs:true};
  if (intent === "help") return {...base, text:craft.guide, docs:true};
  return {...base, text:`I’m not confident that this is a supported request. For ${craft.name}, try “help me get started”, “how do I export”, or “make a starter file”. I cannot reliably answer arbitrary questions or operate the editor.`, docs:true};
}
