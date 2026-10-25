import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runClaudeTurn,runAgentTeam,parseAgentCount,browserReadUrl,htmlToText,
  ANTHROPIC_MESSAGES_URL,ANTHROPIC_VERSION,CLAUDE_DEFAULT_MODEL,MAX_AGENTS} from "../claude.js";

const root=new URL("../",import.meta.url);
const catalog=JSON.parse(await readFile(new URL("catalog.json",root)));
const fakeAnswer=text=>({content:[{type:"text",text}],stop_reason:"end_turn"});

test("agent counts are parsed from natural phrasings",()=>{
  assert.equal(parseAgentCount("use 4 agents to summarise this"),4);
  assert.equal(parseAgentCount("spawn three agents"),3);
  assert.equal(parseAgentCount("with a couple of agents please"),2);
  assert.equal(parseAgentCount("run 12 agents"),12);
  assert.equal(parseAgentCount("just answer normally"),null);
  assert.equal(parseAgentCount(""),null);
  assert.equal(parseAgentCount(42),null);
});

test("html is reduced to readable plain text",()=>{
  const text=htmlToText("<html><head><style>a{}</style><script>alert(1)</script></head><body><h1>Hello</h1><p>World & more</p></body></html>");
  assert.match(text,/Hello/);
  assert.match(text,/World & more/);
  assert.doesNotMatch(text,/alert/);
  assert.doesNotMatch(text,/<[a-z]/);
});

test("browser reads report CORS and non-text failures honestly",async()=>{
  const blocked=await browserReadUrl("https://example.com/page",async()=>{throw new TypeError("Failed to fetch");});
  assert.equal(blocked.ok,false);
  assert.match(blocked.error,/cannot be fetched|block/i);
  const pdf=await browserReadUrl("https://example.com/doc.pdf",async()=>({ok:true,status:200,headers:{get:()=> "application/pdf"},text:async() => "PDF"}));
  assert.equal(pdf.ok,false);
  const invalid=await browserReadUrl("file:///etc/passwd");
  assert.equal(invalid.ok,false);
  assert.equal((await browserReadUrl("https://example.com",async()=>({ok:false,status:404,headers:{get:()=> "text/html"},text:async()=>""}))).ok,false);
});

test("browser reading succeeds when a site allows it and text is bounded",async()=>{
  const page=await browserReadUrl("https://example.com/article",async()=>{
    return {ok:true,status:200,headers:{get:()=> "text/html; charset=utf-8"},
      text:async()=> `<article>${"<p>Repeat. </p>".repeat(3000)}</article>`};
  });
  assert.equal(page.ok,true);
  assert.ok(page.text.length<=8100);
  assert.match(page.url,/example\.com\/article/);
});

test("Claude requests use the browser-access header and never trace the key",async()=>{
  let captured;
  const fetchImpl=async(url,options)=>{
    captured={url,options};
    return {ok:true,status:200,json:async()=>fakeAnswer("Hello from Claude.")};
  };
  const actions=[];
  const result=await runClaudeTurn({apiKey:"sk-ant-unit-secret",model:"claude-sonnet-5-5",text:"hello",
    catalog,fetchImpl,onAction:action=>actions.push(action)});
  assert.equal(captured.url,ANTHROPIC_MESSAGES_URL);
  assert.equal(captured.options.method,"POST");
  assert.equal(captured.options.headers["anthropic-version"],ANTHROPIC_VERSION);
  assert.equal(captured.options.headers["anthropic-dangerous-direct-browser-access"],"true");
  assert.equal(captured.options.headers["x-api-key"],"sk-ant-unit-secret");
  const body=JSON.parse(captured.options.body);
  assert.equal(body.model,"claude-sonnet-5-5");
  assert.ok(body.max_tokens>0);
  assert.equal(body.system.includes("ArtCraft"),true);
  assert.deepEqual(body.messages.slice(-1),[{role:"user",content:"hello"}]);
  assert.equal(JSON.stringify(result.actions).includes("sk-ant-unit-secret"),false);
  assert.equal(result.text,"Hello from Claude.");
  assert.equal(result.webSearched,false);
  assert.ok(result.actions.some(action=>action.command==="Claude response"));
});

test("local skills run through the Claude tool loop with the same allowlist",async()=>{
  const responses=[
    {content:[{type:"tool_use",id:"toolu_1",name:"get_craft_guidance",input:{craft_id:"editcraft",topic:"start"}}],stop_reason:"tool_use"},
    {content:[{type:"tool_use",id:"toolu_2",name:"make_starter",input:{craft_id:"gridcraft",brief:"Monthly budget"}}],stop_reason:"tool_use"},
    fakeAnswer("Done with both skills.")
  ];
  const requests=[];
  const fetchImpl=async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>responses.shift()};};
  const result=await runClaudeTurn({apiKey:"test-key",text:"Guide me and make a starter",catalog,fetchImpl});
  const guidanceResult=requests[1].messages.find(message=>message.role==="user"&&Array.isArray(message.content))
    ?.content.find(block=>block.type==="tool_result");
  assert.match(guidanceResult.content,/browser editing app/);
  assert.equal(result.artifacts.length,1);
  assert.equal(result.artifacts[0].filename,"gridcraft-starter.csv");
  assert.ok(result.actions.some(action=>action.command==="get_craft_guidance(editcraft, start)"));
  assert.ok(result.actions.some(action=>action.command==="makeStarter(gridcraft, brief)"));
  assert.equal(result.text,"Done with both skills.");
});

test("the read_webpage tool passes fetched text or an honest failure to the model",async()=>{
  const responses=[
    {content:[{type:"tool_use",id:"toolu_1",name:"read_webpage",input:{url:"https://example.com/ok"}}],stop_reason:"tool_use"},
    {content:[{type:"tool_use",id:"toolu_2",name:"read_webpage",input:{url:"https://blocked.example/x"}}],stop_reason:"tool_use"},
    fakeAnswer("Summarised what I could read.")
  ];
  const requests=[];
  const fetchImpl=async(url,options)=>{
    if(String(url).startsWith("https://api.anthropic.com")){
      requests.push(JSON.parse(options.body));
      return {ok:true,status:200,json:async()=>responses.shift()};
    }
    if(String(url)==="https://example.com/ok") return {ok:true,status:200,headers:{get:()=> "text/html"},text:async() => "<main><p>Readable page text.</p></main>"};
    throw new TypeError("Failed to fetch");
  };
  const result=await runClaudeTurn({apiKey:"test-key",text:"Read these two pages",catalog,fetchImpl});
  const toolBlocks=requests.slice(1).flatMap(request=>request.messages.map(message=>message.content)).flat()
    .filter(block=>block&&block.type==="tool_result");
  const okResult=toolBlocks.find(block=>block.tool_use_id==="toolu_1");
  const badResult=toolBlocks.find(block=>block.tool_use_id==="toolu_2");
  assert.match(okResult.content,/Readable page text/);
  assert.equal(badResult.is_error,true);
  assert.match(badResult.content,/cannot be fetched|block/i);
  assert.ok(result.actions.some(action=>action.command.startsWith("read_webpage(")));
  assert.ok(result.actions.some(action=>/reported honestly/i.test(action.summary)));
  assert.equal(result.text,"Summarised what I could read.");
});

test("Claude failures and invalid input are reported before or without leaking the key",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return {ok:true,status:200,json:async()=>fakeAnswer("ok")};};
  await assert.rejects(runClaudeTurn({apiKey:"",text:"hi",catalog,fetchImpl}),/Claude API key/);
  await assert.rejects(runClaudeTurn({apiKey:"key",model:"https://evil.test",text:"hi",catalog,fetchImpl}),/valid Claude model/);
  await assert.rejects(runClaudeTurn({apiKey:"key",text:" ",catalog,fetchImpl}),/Enter a message/);
  assert.equal(calls,0);
  await assert.rejects(runClaudeTurn({apiKey:"k",text:"hi",catalog,
    fetchImpl:async()=>({ok:false,status:401,json:async()=>({type:"error",error:{message:"invalid x-api-key"}})})}),
    /HTTP 401/);
  const actions=[];
  await assert.rejects(runClaudeTurn({apiKey:"k",text:"hi",catalog,onAction:a=>actions.push(a),
    fetchImpl:async()=>{throw new TypeError("network unavailable");}}),/network unavailable/);
  assert.equal(actions[0].command,`POST ${ANTHROPIC_MESSAGES_URL}`);
});

test("agent teams run one parallel call per requested agent plus a synthesis call",async()=>{
  const calls=[];
  const fetchImpl=async(_url,options)=>{
    const body=JSON.parse(options.body);
    calls.push(body);
    if(body.messages.length===1&&body.system.startsWith("You are agent")) return {ok:true,status:200,json:async()=>fakeAnswer(`contribution ${calls.length}`)};
    return {ok:true,status:200,json:async()=>fakeAnswer("Merged answer.")};
  };
  const result=await runAgentTeam({apiKey:"team-key",count:3,task:"Plan a launch",catalog,fetchImpl});
  assert.equal(result.agents.length,3);
  assert.deepEqual(result.agents.map(agent=>agent.status),["done","done","done"]);
  const agentCalls=calls.filter(body=>String(body.system).startsWith("You are agent"));
  const synthesisCalls=calls.filter(body=>String(body.system).startsWith("You are the lead"));
  assert.equal(agentCalls.length,3);
  assert.equal(synthesisCalls.length,1);
  assert.equal(result.text,"Merged answer.");
  assert.ok(result.actions.some(action=>action.command==="synthesis"));
  assert.equal(JSON.stringify(result.actions).includes("team-key"),false);
});

test("agent teams honor the user's count but reject unsupported counts",async()=>{
  await assert.rejects(runAgentTeam({apiKey:"k",count:0,task:"x",catalog,fetchImpl:async()=>{}}),/at least one agent/);
  await assert.rejects(runAgentTeam({apiKey:"k",count:MAX_AGENTS+1,task:"x",catalog,fetchImpl:async()=>{}}),
    new RegExp(`up to ${MAX_AGENTS} agents`));
  await assert.rejects(runAgentTeam({apiKey:"k",count:3,task:" ",catalog,fetchImpl:async()=>{}}),/Describe the task/);
});

test("a team where some agents fail still synthesizes the successful ones",async()=>{
  let call=0;
  const fetchImpl=async(_url,options)=>{
    call+=1;
    const body=JSON.parse(options.body);
    if(String(body.system).startsWith("You are agent 2")) return {ok:false,status:500,json:async()=>({})};
    if(String(body.system).startsWith("You are agent")) return {ok:true,status:200,json:async()=>fakeAnswer("part")};
    return {ok:true,status:200,json:async()=>fakeAnswer("Merged.")};
  };
  const result=await runAgentTeam({apiKey:"k",count:2,task:"T",catalog,fetchImpl});
  assert.equal(result.agents[0].status,"done");
  assert.equal(result.agents[1].status,"failed");
  assert.equal(result.text,"Merged.");
});

test("the default Claude model is current and the agent cap is sane",()=>{
  assert.equal(CLAUDE_DEFAULT_MODEL,"claude-sonnet-5-5");
  assert.ok(MAX_AGENTS>=2&&MAX_AGENTS<=10);
});
