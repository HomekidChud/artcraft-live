import test from "node:test";
import assert from "node:assert/strict";
import {
  addMemoryItem, clearMemory, findRelevantMemory, forgetMemory, loadMemory,
  parseMemoryCommand, saveMemory, setLastCraft, setMemoryEnabled, MAX_MEMORY_ITEMS
} from "../memory.js";

class MemoryStorage {
  values=new Map();
  getItem(key){return this.values.get(key)??null;}
  setItem(key,value){this.values.set(key,String(value));}
  removeItem(key){this.values.delete(key);}
}

 test("memory starts disabled and stores only explicit user notes after opt-in",()=>{
  const storage=new MemoryStorage(),state=loadMemory(storage);
  assert.equal(state.enabled,false);assert.equal(state.entries.length,0);
  assert.deepEqual(addMemoryItem(state,"My brand is teal",null,storage),{ok:false,reason:"disabled"});
  assert.equal(setMemoryEnabled(state,true,storage),true);
  assert.equal(addMemoryItem(state,"My brand colors are teal and cream","vectorcraft",storage).ok,true);
  const loaded=loadMemory(storage);
  assert.equal(loaded.enabled,true);assert.equal(loaded.entries.length,1);
  assert.equal(loaded.entries[0].text,"My brand colors are teal and cream");
  assert.equal(loaded.entries[0].craftId,"vectorcraft");
});

test("last Craft is saved only while memory is enabled",()=>{
  const storage=new MemoryStorage(),state=loadMemory(storage);
  assert.equal(setLastCraft(state,"gridcraft",storage),false);
  setMemoryEnabled(state,true,storage);
  assert.equal(setLastCraft(state,"gridcraft",storage),true);
  assert.equal(loadMemory(storage).lastCraft,"gridcraft");
});

test("explicit forget commands erase one or all saved notes",()=>{
  const storage=new MemoryStorage(),state=loadMemory(storage);setMemoryEnabled(state,true,storage);
  addMemoryItem(state,"Use teal for logos","vectorcraft",storage);
  addMemoryItem(state,"Use a calm tone for reports","wordcraft",storage);
  assert.deepEqual(forgetMemory(state,"teal",storage),{removed:1,remaining:1});
  assert.equal(state.entries[0].text,"Use a calm tone for reports");
  assert.equal(clearMemory(state,storage),true);
  assert.equal(loadMemory(storage).entries.length,0);
  assert.equal(loadMemory(storage).lastCraft,null);
});

test("memory is bounded and duplicate explicit notes are replaced",()=>{
  const storage=new MemoryStorage(),state=loadMemory(storage);setMemoryEnabled(state,true,storage);
  const note="x".repeat(700);
  assert.equal(addMemoryItem(state,note,null,storage).item.text.length,400);
  addMemoryItem(state,"same note",null,storage);addMemoryItem(state,"same note",null,storage);
  assert.equal(state.entries.length,2);
  for(let i=0;i<MAX_MEMORY_ITEMS+5;i++)addMemoryItem(state,`note ${i}`,null,storage);
  assert.equal(state.entries.length,MAX_MEMORY_ITEMS);
});

test("relevance prefers Craft-specific notes and never crosses another Craft boundary",()=>{
  const entries=[
    {text:"Use teal brand colors",craftId:"vectorcraft"},
    {text:"Keep reports concise",craftId:"wordcraft"},
    {text:"Prefer simple layouts",craftId:null}
  ];
  const relevant=findRelevantMemory(entries,"vectorcraft","make a simple logo",3);
  assert.deepEqual(relevant.map(item=>item.text),["Use teal brand colors","Prefer simple layouts"]);
  assert.equal(findRelevantMemory([{text:"My brand colors are teal and cream",craftId:null}],"vectorcraft","Make a starter logo",1)[0].text,"My brand colors are teal and cream");
  assert.equal(findRelevantMemory([{text:"My cat is named Miso",craftId:null}],"vectorcraft","Make a starter logo",1).length,0);
});

test("remember, recall, and forget phrases are recognized explicitly",()=>{
  assert.deepEqual(parseMemoryCommand("Remember that my brand is teal"),{type:"remember",text:"my brand is teal"});
  assert.deepEqual(parseMemoryCommand("what do you remember?"),{type:"recall"});
  assert.deepEqual(parseMemoryCommand("forget about teal"),{type:"forget-one",query:"teal"});
  assert.deepEqual(parseMemoryCommand("forget everything"),{type:"forget-all"});
  assert.equal(parseMemoryCommand("remember a starter file"),null);
  assert.equal(parseMemoryCommand("tell me what memory is"),null);
});

test("blocked browser storage fails closed without throwing",()=>{
  const state=loadMemory({getItem(){throw new Error("blocked");}});
  assert.equal(state.available,false);assert.equal(state.enabled,false);
  assert.equal(saveMemory(state,{setItem(){throw new Error("blocked");}}),false);
  assert.equal(state.available,false);
});
