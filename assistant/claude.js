import {executeLocalSkill} from "./skills.js";
import {instructionsFor} from "./online.js";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
export const CLAUDE_DEFAULT_MODEL = "claude-sonnet-5-5";
export const MAX_AGENTS = 8;
export const MAX_BROWSER_TEXT_CHARS = 8000;
const MAX_PRIOR_MESSAGES = 24;
const MAX_TOOL_ROUNDS = 4;
const REQUEST_TIMEOUT_MS = 45000;
const MAX_OUTPUT_TOKENS = 1200;

const WORD_NUMBERS = {one:1,a:1,an:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,couple:2,few:3,several:4};

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Parse a user-requested agent count from a message such as
 *  "use 4 agents to summarise this" or "spawn three agents". Returns the
 *  integer count, or null when the user did not ask for agents. */
export function parseAgentCount(text) {
  if(typeof text !== "string") return null;
  const value = String(text).slice(0,400);
  const patterns = [
    /(?:use|using|with|spawn|create|make|run|launch|start)\s+(?:a\s+|an\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several)\s+(?:of\s+)?agents?/i,
    /agents?\s*[:=]?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i,
    /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+agents?/i
  ];
  for(const pattern of patterns) {
    const match = value.match(pattern);
    if(!match) continue;
    const raw = match[1].toLowerCase();
    const count = /^\d+$/.test(raw) ? Number.parseInt(raw,10) : WORD_NUMBERS[raw];
    if(Number.isInteger(count) && count > 0) return count;
  }
  return null;
}

/** Minimal, dependency-free HTML → plain-text conversion. Works in browsers
 *  and Node (tests) alike. Not a full renderer: it strips markup so page text
 *  can be handed to the model. */
export function htmlToText(html) {
  let text = String(html);
  text = text.replace(/<script\b[\s\S]*?<\/script>/gi," ");
  text = text.replace(/<style\b[\s\S]*?<\/style>/gi," ");
  text = text.replace(/<noscript\b[\s\S]*?<\/noscript>/gi," ");
  text = text.replace(/<!--[\s\S]*?-->/g," ");
  text = text.replace(/<(?:br|p|div|li|tr|h[1-6]|section|article|header|footer)\b[^>]*>/gi,"\n");
  text = text.replace(/<[^>]+>/g," ");
  text = text.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'");
  text = text.replace(/[ \t]+/g," ");
  text = text.replace(/\n\s*\n\s*\n+/g,"\n\n");
  return text.trim().slice(0,MAX_BROWSER_TEXT_CHARS);
}

/** The Claude "browser": a single client-side page fetch. This is a
 *  read-only text fetch from the user's browser — not a controllable
 *  browser. Many sites block cross-origin browser fetches (CORS); the
 *  result reports that honestly instead of guessing page contents. */
export async function browserReadUrl(url, fetchImpl = globalThis.fetch) {
  const target = safeUrl(url);
  if(!target) return {ok:false,error:"Only public http(s) URLs can be read."};
  if(typeof fetchImpl !== "function") return {ok:false,error:"This browser cannot make online requests."};
  try {
    const response = await fetchImpl(target,{redirect:"follow"});
    if(!response.ok) return {ok:false,error:`The site answered HTTP ${response.status}, so its text could not be read.`};
    const contentType = String(response.headers?.get?.("content-type") || "");
    if(!/text\/|xml|json/i.test(contentType) && contentType) {
      return {ok:false,error:`The page is ${contentType.split(";")[0]}, not readable text.`};
    }
    const html = await response.text();
    const text = htmlToText(html);
    if(!text) return {ok:false,error:"The page returned no readable text."};
    return {ok:true,url:target,text};
  } catch {
    return {ok:false,error:"The page could not be fetched from this browser. Many sites block browser fetches (CORS), and this tool cannot click, scroll, log in or control a real browser — it only reads text when a site allows it."};
  }
}

function claudeTools(catalog) {
  const craftIds = catalog.crafts.map(craft => craft.id);
  return [
    {
      name:"get_craft_guidance",
      description:"Read the local ArtCraft catalog's curated start or export guidance for one Craft.",
      input_schema:{type:"object",properties:{
        craft_id:{type:"string",enum:craftIds},
        topic:{type:"string",enum:["start","export"]}
      },required:["craft_id","topic"],additionalProperties:false}
    },
    {
      name:"make_starter",
      description:"Create one safe fixed starter template locally for a named Craft. This does not open, import into, or modify the editor.",
      input_schema:{type:"object",properties:{
        craft_id:{type:"string",enum:craftIds},
        brief:{type:"string"}
      },required:["craft_id","brief"],additionalProperties:false}
    },
    {
      name:"read_webpage",
      description:"Fetch one public web page's text from the user's browser. Many sites block browser fetches (CORS); if the tool reports a failure, tell the user plainly instead of describing the page. This reads text only — it cannot click, scroll, log in, fill forms or otherwise control a browser.",
      input_schema:{type:"object",properties:{
        url:{type:"string",description:"Full public http(s) URL to read"}
      },required:["url"],additionalProperties:false}
    }
  ];
}

function systemFor(catalog,selectedCraft,extra = "") {
  return [
    instructionsFor(catalog,selectedCraft),
    "You may call read_webpage to fetch a public page's text from the user's browser when the user shares a URL or asks you to read a page. If the tool fails, say so plainly; never invent the page's contents and never claim you opened or controlled a real browser.",
    extra
  ].filter(Boolean).join("\n\n");
}

async function postMessages({apiKey,model,system,messages,tools,maxTokens = MAX_OUTPUT_TOKENS,fetchImpl,signal}) {
  const controller = signal ? null : new AbortController();
  const timer = signal ? null : setTimeout(() => controller.abort(),REQUEST_TIMEOUT_MS);
  const body = {model,max_tokens:maxTokens,system,messages};
  if(tools?.length) body.tools = tools;
  try {
    const response = await fetchImpl(ANTHROPIC_MESSAGES_URL,{
      method:"POST",
      headers:{
        "content-type":"application/json",
        "x-api-key":apiKey,
        "anthropic-version":ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access":"true"
      },
      body:JSON.stringify(body),
      signal:signal || controller.signal
    });
    if(!response.ok) {
      let detail = "";
      try {
        const error = await response.json();
        detail = error?.error?.message ? ` ${error.error.message}` : "";
      } catch {}
      throw new Error(`Claude request failed (HTTP ${response.status}).${detail} Check the API key, model, quota, and connection.`);
    }
    const result = await response.json();
    if(result?.type === "error") throw new Error(`Claude returned an API error: ${result?.error?.message || "check the key, model, and account quota."}`);
    return result;
  } finally {
    if(timer) clearTimeout(timer);
  }
}

function responseText(response) {
  return (response?.content || []).filter(block => block.type === "text").map(block => block.text).join("").trim();
}

/** Low-level single-call helper for apps that bring their own system prompt
 *  (for example EditCraft). Returns the assistant text; throws friendly errors. */
export async function callClaude({apiKey,model = CLAUDE_DEFAULT_MODEL,system,messages,fetchImpl = globalThis.fetch,signal,maxTokens}) {
  if(typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Connect a Claude API key first.");
  const chosenModel = String(model || CLAUDE_DEFAULT_MODEL).trim();
  if(!/^[A-Za-z0-9._-]{1,100}$/.test(chosenModel)) throw new Error("Enter a valid Claude model name.");
  if(typeof fetchImpl !== "function") throw new Error("This browser cannot make online requests.");
  if(!Array.isArray(messages) || !messages.length) throw new Error("Nothing to send.");
  const response = await postMessages({apiKey:apiKey.trim(),model:chosenModel,system:String(system || "").slice(0,8000),
    messages:messages.slice(-40).map(message => ({role:message.role === "assistant" ? "assistant" : "user",
      content:String(message.content || "").slice(0,20000)})),fetchImpl,signal,maxTokens});
  const text = responseText(response);
  if(!text) throw new Error("Claude returned an empty answer. Try again.");
  return text;
}

function responseToolUses(response) {
  return (response?.content || []).filter(block => block.type === "tool_use");
}

/** One online assistant turn backed by the Anthropic Messages API.
 *  Mirrors runOnlineTurn's contract: {text,citations,sources,actions,artifacts,webSearched,model}. */
export async function runClaudeTurn({apiKey,model = CLAUDE_DEFAULT_MODEL,history = [],text,catalog,selectedCraft = "auto",fetchImpl = globalThis.fetch,onStatus = () => {},onAction = () => {}}) {
  if(typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Connect a Claude API key to use online chat.");
  const chosenModel = String(model || CLAUDE_DEFAULT_MODEL).trim();
  if(!/^[A-Za-z0-9._-]{1,100}$/.test(chosenModel)) throw new Error("Enter a valid Claude model name.");
  if(typeof text !== "string" || !text.trim()) throw new Error("Enter a message before sending it online.");
  if(typeof fetchImpl !== "function") throw new Error("This browser cannot make online requests.");

  const system = systemFor(catalog,selectedCraft);
  const messages = history.slice(-MAX_PRIOR_MESSAGES).filter(item => ["user","assistant"].includes(item.role) && typeof item.content === "string" && item.content.trim())
    .map(item => ({role:item.role,content:item.content.slice(0,4000)}));
  messages.push({role:"user",content:text.slice(0,2000)});
  const tools = claudeTools(catalog);
  const actions = [];
  const artifacts = [];
  const logAction = action => {actions.push(action);onAction(action);};
  let response;

  for(let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    onStatus(round === 0 ? "Thinking…" : "Using an ArtCraft skill…");
    logAction({command:`POST ${ANTHROPIC_MESSAGES_URL}`,summary:"Prepared a Claude request with this message, the selected Craft and up to 12 recent turns. No attachments, saved local memory or editor data were included."});
    response = await postMessages({apiKey:apiKey.trim(),model:chosenModel,system,messages,tools,fetchImpl});
    logAction({command:"Claude response",summary:"Received a response from the Anthropic Messages API."});

    const uses = responseToolUses(response);
    if(!uses.length) {
      const answer = responseText(response);
      if(!answer) throw new Error("The model returned no answer. Try again with a shorter message.");
      return {text:answer,citations:[],sources:[],actions,artifacts,webSearched:false,model:chosenModel};
    }
    messages.push({role:"assistant",content:response.content});
    const toolResults = [];
    for(const use of uses) {
      const args = use.input && typeof use.input === "object" ? use.input : {};
      if(use.name === "read_webpage") {
        const url = safeUrl(args.url);
        if(!url) {
          toolResults.push({type:"tool_result",tool_use_id:use.id,is_error:true,content:"Invalid or non-http(s) URL."});
          logAction({command:"read_webpage(url)",summary:"Rejected the URL locally; only public http(s) pages can be read."});
          continue;
        }
        logAction({command:`read_webpage(${url})`,summary:"Fetched the page's text from this browser. This reads text only — it is not a controllable browser and cannot click, scroll or log in."});
        const page = await browserReadUrl(url,fetchImpl);
        if(!page.ok) {
          toolResults.push({type:"tool_result",tool_use_id:use.id,is_error:true,content:page.error});
          logAction({command:"read_webpage result",summary:"The page could not be read (blocked or unsupported). Reported honestly instead of guessing its contents."});
        } else {
          toolResults.push({type:"tool_result",tool_use_id:use.id,content:`URL: ${page.url}\n\n${page.text}`});
          logAction({command:"read_webpage result",summary:`Read ${page.text.length} characters of page text and passed them to the model.`});
        }
        continue;
      }
      const result = executeLocalSkill(use.name,args,{catalog});
      if(result.action) logAction(result.action);
      else logAction({command:String(use.name || "unknown skill").slice(0,80),summary:"The skill call was rejected or is not on the local allowlist; no editor or shell action was performed."});
      if(result.artifact && artifacts.length < 1) artifacts.push(result.artifact);
      toolResults.push({type:"tool_result",tool_use_id:use.id,content:result.output});
    }
    messages.push({role:"user",content:toolResults});
  }
  throw new Error("The assistant reached its local skill limit before finishing. Please try a shorter request.");
}

const AGENT_ROLES = [
  {name:"Planner",brief:"break the task into clear steps and outline the approach"},
  {name:"Researcher",brief:"gather the key facts, constraints and examples the task needs"},
  {name:"Writer",brief:"produce the main draft or answer for the task"},
  {name:"Reviewer",brief:"critique the draft for errors, gaps and risks"},
  {name:"Fact checker",brief:"verify claims and flag anything uncertain or unsupported"},
  {name:"Editor",brief:"polish tone, structure and clarity"},
  {name:"Optimizer",brief:"suggest the most efficient path or a simpler alternative"},
  {name:"Critic",brief:"argue the strongest case against the current approach"}
];

/** Run a user-requested team of N Claude agents. Each agent is one real
 *  Anthropic Messages API call with a distinct role; a final synthesizer
 *  call merges their contributions. Agents run in parallel. */
export async function runAgentTeam({apiKey,model = CLAUDE_DEFAULT_MODEL,count,task,history = [],catalog,selectedCraft = "auto",fetchImpl = globalThis.fetch,onStatus = () => {},onAction = () => {}}) {
  if(typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Connect a Claude API key to use agent teams.");
  const requested = Number(count);
  if(!Number.isInteger(requested) || requested < 1) throw new Error("Ask for at least one agent (for example, \"use 3 agents\").");
  if(requested > MAX_AGENTS) throw new Error(`Agent teams support up to ${MAX_AGENTS} agents; you asked for ${requested}. Please ask for ${MAX_AGENTS} or fewer. Each agent is a separate API call on your key.`);
  if(typeof task !== "string" || !task.trim()) throw new Error("Describe the task for the agent team.");
  if(typeof fetchImpl !== "function") throw new Error("This browser cannot make online requests.");

  const chosenModel = String(model || CLAUDE_DEFAULT_MODEL).trim();
  if(!/^[A-Za-z0-9._-]{1,100}$/.test(chosenModel)) throw new Error("Enter a valid Claude model name.");
  const cleanTask = task.trim().slice(0,2000);
  const actions = [];
  const logAction = action => {actions.push(action);onAction(action);};
  const agents = AGENT_ROLES.slice(0,requested).map((role,index) => ({...role,index:index + 1,status:"running",text:"",error:null}));

  logAction({command:`agent team × ${requested}`,summary:`Preparing ${requested} parallel Claude agent call(s) plus one synthesis call, all on your API key. Each agent has a distinct role; nothing else is sent.`});
  onStatus(`Running ${requested} agents…`);

  const prior = history.slice(-MAX_PRIOR_MESSAGES).filter(item => ["user","assistant"].includes(item.role) && typeof item.content === "string" && item.content.trim())
    .map(item => `${item.role === "user" ? "User" : "Assistant"}: ${item.content.slice(0,1000)}`).join("\n");

  const runAgent = async agent => {
    const others = agents.filter(other => other !== agent).map(other => other.name).join(", ") || "none";
    const system = [
      `You are agent ${agent.index} of ${requested} (${agent.name}) in a Claude agent team working on one task. Your job: ${agent.brief}.`,
      `The other agents handle: ${others}. Do not repeat their work — contribute your part only.`,
      `Task: ${cleanTask}`,
      prior ? `Recent conversation for context (do not re-answer it):\n${prior}` : "",
      "Be concise: at most 150 words. Output only your contribution, no preamble."
    ].filter(Boolean).join("\n\n");
    try {
      const response = await postMessages({apiKey:apiKey.trim(),model:chosenModel,system,messages:[{role:"user",content:cleanTask}],fetchImpl});
      agent.text = responseText(response) || "(no output)";
      agent.status = "done";
      logAction({command:`agent ${agent.index}/${requested} (${agent.name})`,summary:"Received this agent's contribution."});
    } catch(error) {
      agent.status = "failed";
      agent.error = error?.message || "The agent call failed.";
      logAction({command:`agent ${agent.index}/${requested} (${agent.name})`,summary:`This agent failed: ${agent.error}`});
    }
  };

  await Promise.all(agents.map(runAgent));
  const successful = agents.filter(agent => agent.status === "done");
  if(!successful.length) throw new Error("All agents failed. Check the API key, model, quota, and connection, then try again.");

  onStatus("Merging the agents' work…");
  const contributions = successful.map(agent => `### ${agent.name} (agent ${agent.index})\n${agent.text}`).join("\n\n");
  const synthesisSystem = [
    "You are the lead of a Claude agent team. Merge the agents' contributions below into one coherent, useful answer for the user.",
    "Keep what is correct and useful, resolve disagreements in favour of the stronger argument, and drop redundancy. Do not mention the agents or the team structure in the final answer unless the user asked how the work was split.",
    `Task: ${cleanTask}`
  ].join("\n\n");
  const synthesisResponse = await postMessages({apiKey:apiKey.trim(),model:chosenModel,system:synthesisSystem,
    messages:[{role:"user",content:`Task:\n${cleanTask}\n\nAgent contributions:\n${contributions}`}],fetchImpl});
  const synthesis = responseText(synthesisResponse);
  if(!synthesis) throw new Error("The agents finished but the merged answer was empty. Try again.");
  logAction({command:"synthesis",summary:`Merged ${successful.length} agent contribution(s) into the final answer with one more Claude call.`});
  return {text:synthesis,agents,actions,model:chosenModel};
}
