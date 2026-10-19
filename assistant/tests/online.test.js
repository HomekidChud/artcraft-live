import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {extractResponse,runOnlineTurn,OPENAI_RESPONSES_URL} from "../online.js";

const root=new URL("../",import.meta.url);
const catalog=JSON.parse(await readFile(new URL("catalog.json",root)));
const modelName="gpt-4.1-mini";
const fakeAnswer=text=>({output:[{type:"message",role:"assistant",content:[{type:"output_text",text}]}]});

test("Responses API citations and web-search sources are normalized",()=>{
  const parsed=extractResponse({output:[
    {type:"web_search_call",action:{type:"search",query:"current vector file formats",sources:[{title:"Source page",url:"https://example.com/source",excerpt:"A short result."}]}},
    {type:"message",role:"assistant",content:[{type:"output_text",text:"SVG remains useful [1].",annotations:[{type:"url_citation",start_index:18,end_index:21,url:"https://example.com/source",title:"Source page"}]}]}
  ]});
  assert.equal(parsed.text,"SVG remains useful [1].");
  assert.equal(parsed.searches[0],"current vector file formats");
  assert.equal(parsed.sources.length,1);
  assert.equal(parsed.citations[0].url,"https://example.com/source");
  assert.equal(parsed.citations[0].start,18);
});

test("citation offsets survive trimmed leading whitespace",()=>{
  const parsed=extractResponse({output:[{type:"message",role:"assistant",content:[{type:"output_text",text:"  [1] ",annotations:[{type:"url_citation",start_index:2,end_index:5,url:"https://example.com",title:"Example"}]}]}]});
  assert.equal(parsed.text,"[1]");
  assert.equal(parsed.citations[0].start,0);
  assert.equal(parsed.citations[0].end,3);
});

test("online request sends bounded text, not local files or memory, and never traces the API key",async()=>{
  let captured;
  const liveActions=[];
  const fetchImpl=async(url,options)=>{
    captured={url,options};
    return {ok:true,status:200,json:async()=>fakeAnswer("Hello, I can help with that.")};
  };
  const result=await runOnlineTurn({apiKey:"sk-unit-test-secret",model:modelName,webSearch:false,
    history:[{role:"user",content:"Earlier question"},{role:"assistant",content:"Earlier answer"}],
    text:"how are you",catalog,selectedCraft:"auto",fetchImpl,onAction:action=>liveActions.push(action)});
  assert.equal(captured.url,OPENAI_RESPONSES_URL);
  assert.equal(captured.options.method,"POST");
  assert.equal(captured.options.headers.Authorization,"Bearer sk-unit-test-secret");
  const body=JSON.parse(captured.options.body);
  assert.equal(body.store,false);
  assert.equal(body.model,modelName);
  assert.deepEqual(body.input.slice(-1),[{role:"user",content:"how are you"}]);
  assert.equal(body.tools.some(tool=>tool.type==="web_search"),false);
  assert.equal(JSON.stringify(body).includes("local secret note"),false);
  assert.equal(JSON.stringify(body).includes("private-file.pdf"),false);
  assert.equal(JSON.stringify(result.actions).includes("sk-unit-test-secret"),false);
  assert.match(result.actions[0].summary,/No attachments, saved local memory/);
  assert.ok(result.actions.some(action=>action.command==="OpenAI response"));
  assert.deepEqual(liveActions,result.actions);
  assert.equal(result.text,"Hello, I can help with that.");
});

test("web search is opt-in and cited sources are returned for the UI",async()=>{
  const response={output:[
    {type:"web_search_call",action:{type:"search",query:"latest design guidance",sources:[{title:"Design guide",url:"https://example.com/design"}]}},
    {type:"message",role:"assistant",content:[{type:"output_text",text:"See the current design guide [1].",annotations:[{type:"url_citation",start_index:27,end_index:30,url:"https://example.com/design",title:"Design guide"}]}]}
  ]};
  let body;
  const fetchImpl=async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,status:200,json:async()=>response};};
  const result=await runOnlineTurn({apiKey:"test-key",model:modelName,webSearch:true,text:"Find current design guidance",catalog,fetchImpl});
  assert.ok(body.tools.some(tool=>tool.type==="web_search"));
  assert.deepEqual(body.include,["web_search_call.action.sources"]);
  assert.equal(result.webSearched,true);
  assert.equal(result.sources[0].title,"Design guide");
  assert.ok(result.actions.some(action=>action.command==="web_search"));
});

test("Craft guidance skill returns only selected local catalog text",async()=>{
  const responses=[
    {output:[{id:"fc_1",call_id:"call_1",type:"function_call",name:"get_craft_guidance",arguments:JSON.stringify({craft_id:"vectorcraft",topic:"start"})}]},
    fakeAnswer("Start with an artboard and simple shapes.")
  ];
  const requests=[];
  const fetchImpl=async(_url,options)=>{
    requests.push(JSON.parse(options.body));
    return {ok:true,status:200,json:async()=>responses.shift()};
  };
  const result=await runOnlineTurn({apiKey:"test-key",model:modelName,webSearch:false,text:"How do I start in VectorCraft?",catalog,fetchImpl});
  const toolResult=requests[1].input.find(item=>item.type==="function_call_output");
  assert.match(toolResult.output,/Start with an artboard and simple shapes/);
  assert.ok(result.actions.some(action=>action.command==="get_craft_guidance(vectorcraft, start)"));
  assert.equal(result.text,"Start with an artboard and simple shapes.");
});

test("malformed skill arguments are rejected instead of falling back to a selected Craft",async()=>{
  const responses=[
    {output:[{id:"fc_bad",call_id:"call_bad",type:"function_call",name:"get_craft_guidance",arguments:"null"}]},
    fakeAnswer("I couldn't use that skill call, but I can still help.")
  ];
  const requests=[];
  const fetchImpl=async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>responses.shift()};};
  const result=await runOnlineTurn({apiKey:"test-key",model:modelName,webSearch:false,text:"How do I start?",catalog,selectedCraft:"vectorcraft",fetchImpl});
  const toolResult=requests[1].input.find(item=>item.type==="function_call_output");
  assert.match(toolResult.output,/Invalid skill arguments/);
  assert.ok(result.actions.some(action=>action.command==="get_craft_guidance"&&/rejected/.test(action.summary)));
});

test("a failed fetch is recorded as a prepared request, not a confirmed send",async()=>{
  const liveActions=[];
  await assert.rejects(runOnlineTurn({apiKey:"test-key",model:modelName,webSearch:false,text:"Hello",catalog,
    fetchImpl:async()=>{throw new TypeError("network unavailable");},onAction:action=>liveActions.push(action)}),/network unavailable/);
  assert.equal(liveActions[0].command,"POST https://api.openai.com/v1/responses");
  assert.match(liveActions[0].summary,/Prepared a request/);
  assert.doesNotMatch(liveActions[0].summary,/Sent this message/);
  assert.equal(liveActions.some(action=>action.command==="OpenAI response"),false);
});

test("starter-file skill creates a local fixed download and does not claim editor control",async()=>{
  const responses=[
    {output:[{id:"fc_2",call_id:"call_2",type:"function_call",name:"make_starter",arguments:JSON.stringify({craft_id:"gridcraft",brief:"Monthly travel budget"})}]},
    fakeAnswer("I created a GridCraft starter file for you to download.")
  ];
  const fetchImpl=async(_url,options)=>({ok:true,status:200,json:async()=>responses.shift()});
  const result=await runOnlineTurn({apiKey:"test-key",model:modelName,webSearch:false,text:"Make me a starter budget spreadsheet",catalog,fetchImpl});
  assert.equal(result.artifacts.length,1);
  assert.equal(result.artifacts[0].filename,"gridcraft-starter.csv");
  assert.match(await result.artifacts[0].blob.text(),/Category,Planned,Actual,Difference/);
  assert.ok(result.actions.some(action=>action.command==="makeStarter(gridcraft, brief)"));
  assert.match(result.artifacts[0].note,/fixed starter template/);
});

test("missing keys, blank questions, and invalid model strings fail before network access",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return {ok:true,status:200,json:async()=>fakeAnswer("ok")};};
  await assert.rejects(runOnlineTurn({apiKey:"",text:"hi",catalog,fetchImpl}),/Connect an OpenAI API key/);
  await assert.rejects(runOnlineTurn({apiKey:"key",model:"https://evil.test",text:"hi",catalog,fetchImpl}),/valid OpenAI model/);
  await assert.rejects(runOnlineTurn({apiKey:"key",text:" ",catalog,fetchImpl}),/Enter a message/);
  assert.equal(calls,0);
});
