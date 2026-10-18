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
  assert.equal(model.epochs,700);
  assert.equal(model.networks.craft.labels.length,13);
  assert.equal(model.networks.intent.labels.length,6);
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
    assert.equal(respond(catalog,model,"help me get started",craft.id).text,craft.guide);
    assert.equal(respond(catalog,model,"how do I export",craft.id).text,craft.export);
    assert.match(respond(catalog,model,"the editor is not loading",craft.id).text,/loading checklist/);
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
  assert.match(respond(catalog,model,"make a starter file","auto").text,/Which Craft/);
});
test("training and greeting explain the actual capability boundary",()=>{
  assert.match(respond(catalog,model,"hi","auto").text,/not a general-purpose chatbot/);
  assert.match(respond(catalog,model,"how was the model trained","auto").text,/cannot see or control/);
});
test("SVG starter escapes untrusted labels",async()=>{
  const artifact=makeStarter(catalog.crafts[0],'<script>alert("test")</script>&');
  const text=await artifact.blob.text();
  assert.ok(!text.includes("<script>"));
  assert.ok(text.includes("&lt;script&gt;"));
  assert.ok(text.includes("&amp;"));
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
