import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {classify, makeStarter, respond} from "../engine.js";

const root=new URL("../",import.meta.url);
const catalog=JSON.parse(await readFile(new URL("catalog.json",root)));
const model=JSON.parse(await readFile(new URL("model.json",root)));

test("real accepted checkpoint contains two independently initialised MLPs",()=>{
  assert.equal(model.accepted,true);
  assert.equal(model.epochs,1000);
  assert.equal(model.networks.craft.labels.length,13);
  assert.equal(model.networks.intent.labels.length,7);
  for(const net of Object.values(model.networks)){
    assert.equal(net.w1.length,net.vocab.length);
    assert.equal(net.w1[0].length,40);
    assert.equal(net.w2.length,40);
    assert.equal(net.w2[0].length,net.labels.length);
    assert.ok(net.w1.flat().some(n=>n!==0));
  }
});
test("checkpoint matches the reviewed catalog",async()=>{
  const digest=createHash("sha256").update(await readFile(new URL("catalog.json",root))).digest("hex");
  assert.equal(model.catalog_sha256,digest);
});

for(const craft of catalog.crafts){
  test(`${craft.name}: neural craft routing and all four supported workflows`,async()=>{
    assert.equal(classify(model.networks.craft,`Help with ${craft.name}`).label,craft.id);
    for(const phrase of craft.checks)assert.equal(classify(model.networks.craft,phrase).label,craft.id,phrase);
    assert.equal(respond(catalog,model,"help me get started",craft.id).text,craft.guide);
    assert.equal(respond(catalog,model,"how do I export",craft.id).text,craft.export);
    assert.match(respond(catalog,model,"the editor is not loading",craft.id).text,/quick check|startup check/);
    const result=respond(catalog,model,craft.example,craft.id);
    assert.equal(result.intent,"create");
    assert.ok(result.artifact?.blob.size>40);
    assert.ok(result.artifact.filename.endsWith("."+craft.starter));
    const html=await readFile(new URL(`../../${craft.id}/index.html`,import.meta.url),"utf8");
    assert.equal((html.match(/assistant\/widget\.js/g)||[]).length,1);
    assert.ok(html.includes(`data-craft="${craft.id}"`));
  });
}
for(const intent of catalog.intents){
  test(`${intent.id}: browser inference passes the Python regression checks`,()=>{
    for(const text of intent.checks)assert.equal(classify(model.networks.intent,text).label,intent.id,text);
  });
}
test("unknown words fail closed rather than inventing answers",()=>{
  assert.equal(classify(model.networks.intent,"zxqvvj zzyyz").label,null);
  assert.match(respond(catalog,model,"zxqvvj zzyyz","wordcraft").text,/not confident/);
});
test("auto routing remembers the craft and explicit craft names override history",()=>{
  const first=respond(catalog,model,"help me get started with GridCraft","auto");
  assert.equal(first.craft.id,"gridcraft");
  assert.equal(respond(catalog,model,"how do I export","auto",first.craft.id).text,catalog.crafts.find(c=>c.id==="gridcraft").export);
  assert.equal(respond(catalog,model,"help with WordCraft","auto","gridcraft").craft.id,"wordcraft");
  assert.equal(respond(catalog,model,"help with WordCraft","cadcraft","gridcraft").craft.id,"cadcraft");
});
test("no selected or identifiable craft asks instead of making up a project",()=>{
  assert.match(respond(catalog,model,"make a starter file","auto").text,/Choose a Craft/);
});
test("greetings and small talk receive friendly, honest replies",()=>{
  const greeting=respond(catalog,model,"hi","auto");
  assert.equal(greeting.intent,"greeting");
  assert.match(greeting.text,/I’m ArtCraft/);
  const smalltalk=respond(catalog,model,"how are you","auto");
  assert.equal(smalltalk.intent,"smalltalk");
  assert.match(smalltalk.text,/don’t have feelings/);
  assert.doesNotMatch(smalltalk.text,/Choose a Craft|not confident/);
  const training=respond(catalog,model,"how was the model trained","auto");
  assert.equal(training.intent,"training");
  assert.match(training.text,/cannot see or control/);
});
test("EffectCraft startup troubleshooting offers official renderer fallbacks",()=>{
  const result=respond(catalog,model,"EffectCraft is stuck on a blank loading screen","auto");
  assert.equal(result.intent,"troubleshoot");
  assert.equal(result.craft.id,"effectcraft");
  assert.deepEqual(result.recoveryOptions.map(option=>option.mode),["webgl","cpu"]);
  assert.match(result.text,/application\/wasm/);
});
test("SVG starter escapes untrusted labels",async()=>{
  const artifact=makeStarter(catalog.crafts[0],'<script>alert("test")</script>&');
  const text=await artifact.blob.text();
  assert.ok(!text.includes("<script>"));
  assert.ok(text.includes("&lt;script&gt;"));
  assert.ok(text.includes("&amp;"));
});
test("saved local preferences tailor supported starters and appear in the action trace",async()=>{
  const notes=[{text:"My brand colors are teal and cream",craftId:"vectorcraft"}];
  const result=respond(catalog,model,"Make a starter logo for my bakery","vectorcraft",null,notes);
  const svg=await result.artifact.blob.text();
  assert.ok(svg.includes("#178f8a"));
  assert.ok(svg.includes("Saved local preferences"));
  assert.match(result.text,/saved local preferences were included/);
  assert.ok(result.actions.some(action=>action.command==="findRelevantMemory(memoryEntries, craft.id, text)"));
  assert.ok(result.actions.some(action=>action.command==="makeStarter(craft, text, relevant)"));
  assert.ok(!JSON.stringify(result.actions).includes("My brand colors"));
});
test("Markdown starter receives saved notes without making unsupported native projects",async()=>{
  const notes=[{text:"Keep portrait edits natural",craftId:"photocraft"}];
  const result=respond(catalog,model,"Make an editing checklist for a portrait","photocraft",null,notes);
  const markdown=await result.artifact.blob.text();
  assert.match(markdown,/Saved local preferences/);
  assert.match(markdown,/Keep portrait edits natural/);
  assert.equal(result.artifact.memoryApplied,true);
  assert.match(result.text,/fixed starter asset or outline outside the editor/);
});
test("CSV sample has consistent literal totals without injected formulas",async()=>{
  const text=await makeStarter(catalog.crafts.find(c=>c.id==="gridcraft"),"=HYPERLINK(\"bad\")").blob.text();
  const rows=text.trim().split("\n").slice(1).map(r=>r.split(","));
  for(const row of rows)assert.equal(+row[1]- +row[2],+row[3]);
  for(let col=1;col<=3;col++)assert.equal(rows.slice(0,-1).reduce((n,row)=>n+ +row[col],0),+rows.at(-1)[col]);
  assert.ok(!text.includes("HYPERLINK"));
});
test("WAV is a valid mono PCM file with safe sample magnitude",async()=>{
  const blob=makeStarter(catalog.crafts.find(c=>c.id==="soundcraft"),"test").blob;
  const bytes=await blob.arrayBuffer(),view=new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0,4)),"RIFF");
  assert.equal(view.getUint32(24,true),22050);
  assert.equal(view.getUint16(22,true),1);
  assert.equal(view.getUint32(40,true),44100);
  for(let offset=44;offset<bytes.byteLength;offset+=2)assert.ok(Math.abs(view.getInt16(offset,true))<=1600);
});
test("DXF is a four-line closed rectangle",async()=>{
  const text=await makeStarter(catalog.crafts.find(c=>c.id==="cadcraft"),"test").blob.text();
  assert.equal((text.match(/\nLINE\n/g)||[]).length,4);
  assert.ok(text.endsWith("0\nEOF\n"));
});
