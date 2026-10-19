const STORAGE_KEY = "artcraft-assistant-memory-v1";
export const MAX_MEMORY_ITEMS = 40;
export const MAX_MEMORY_CHARS = 400;

function storageOrDefault(storage) {
  return storage ?? globalThis.localStorage;
}

function cleanEntry(entry) {
  if (!entry || typeof entry.text !== "string") return null;
  const text = entry.text.trim().slice(0, MAX_MEMORY_CHARS);
  if (!text) return null;
  return {
    id: typeof entry.id === "string" ? entry.id.slice(0, 80) : "",
    text,
    craftId: typeof entry.craftId === "string" ? entry.craftId.slice(0, 40) : null,
    createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0
  };
}

export function loadMemory(storage) {
  try {
    const raw = storageOrDefault(storage).getItem(STORAGE_KEY);
    if (!raw) return {available: true, enabled: false, lastCraft: null, entries: []};
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.entries))
      return {available: true, enabled: false, lastCraft: null, entries: []};
    return {
      available: true,
      enabled: saved.enabled === true,
      lastCraft: typeof saved.lastCraft === "string" ? saved.lastCraft.slice(0, 40) : null,
      entries: saved.entries.map(cleanEntry).filter(Boolean).slice(-MAX_MEMORY_ITEMS)
    };
  } catch {
    return {available: false, enabled: false, lastCraft: null, entries: []};
  }
}

export function saveMemory(state, storage) {
  try {
    const safe = {
      version: 1,
      enabled: state.enabled === true,
      lastCraft: typeof state.lastCraft === "string" ? state.lastCraft.slice(0, 40) : null,
      entries: (Array.isArray(state.entries) ? state.entries : [])
        .map(cleanEntry).filter(Boolean).slice(-MAX_MEMORY_ITEMS)
    };
    storageOrDefault(storage).setItem(STORAGE_KEY, JSON.stringify(safe));
    state.available = true;
    return true;
  } catch {
    state.available = false;
    return false;
  }
}

export function setMemoryEnabled(state, enabled, storage) {
  state.enabled = enabled === true;
  return saveMemory(state, storage);
}

export function addMemoryItem(state, text, craftId = null, storage) {
  const cleaned = typeof text === "string" ? text.trim().replace(/\s+/g, " ").slice(0, MAX_MEMORY_CHARS) : "";
  if (!cleaned) return {ok: false, reason: "empty"};
  if (!state.enabled) return {ok: false, reason: "disabled"};
  const key = cleaned.toLocaleLowerCase();
  const existing = state.entries.findIndex(item => item.text.toLocaleLowerCase() === key && item.craftId === craftId);
  const item = {id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: cleaned,
    craftId: typeof craftId === "string" ? craftId : null, createdAt: Date.now()};
  if (existing >= 0) state.entries.splice(existing, 1);
  state.entries.push(item);
  state.entries = state.entries.slice(-MAX_MEMORY_ITEMS);
  return saveMemory(state, storage) ? {ok: true, item} : {ok: false, reason: "storage"};
}

export function clearMemory(state, storage) {
  state.entries = [];
  state.lastCraft = null;
  return saveMemory(state, storage);
}

export function forgetMemory(state, query, storage) {
  const needle = String(query || "").trim().toLocaleLowerCase();
  if (!needle) return {removed: 0, remaining: state.entries.length};
  const before = state.entries.length;
  state.entries = state.entries.filter(item => !item.text.toLocaleLowerCase().includes(needle));
  const removed = before - state.entries.length;
  return saveMemory(state, storage) ? {removed, remaining: state.entries.length} : {removed: 0, remaining: before, storageError: true};
}

export function setLastCraft(state, craftId, storage) {
  if (!state.enabled || typeof craftId !== "string") return false;
  state.lastCraft = craftId;
  return saveMemory(state, storage);
}

const words = text => new Set((String(text).toLowerCase().match(/[a-z0-9#-]+/g) || []).filter(word => word.length > 2));

export function findRelevantMemory(entries, craftId, prompt, limit = 3) {
  const queryWords = words(prompt);
  const query = String(prompt || "").toLowerCase();
  return (Array.isArray(entries) ? entries : []).map((entry, index) => {
    const item = cleanEntry(entry);
    if (!item) return null;
    const craftMatch = item.craftId && item.craftId === craftId;
    if (item.craftId && !craftMatch) return null;
    const noteWords = words(item.text);
    const overlap = [...noteWords].filter(word => queryWords.has(word)).length;
    const noteText = item.text.toLowerCase();
    const brandMemory = /\b(brand|logo|colou?r|palette)\b/.test(noteText)
      && /\b(brand|logo|colou?r|palette|vector|design|poster|cover|graphic)\b/.test(query);
    const writingMemory = /\b(tone|voice|writing|wording|style)\b/.test(noteText)
      && /\b(write|writing|document|report|letter|story|script|copy)\b/.test(query);
    const score = (craftMatch ? 4 : 0) + (brandMemory ? 2 : 0) + (writingMemory ? 2 : 0)
      + overlap / Math.max(1, noteWords.size);
    return {item, score, index};
  }).filter(row => row && row.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, Math.max(0, limit)).map(row => row.item);
}

export function parseMemoryCommand(text) {
  const value = String(text || "").trim();
  if (/^(?:what do you remember|what have you remembered|show(?: me)? (?:my )?memory|list (?:my )?memories)\??$/i.test(value))
    return {type: "recall"};
  if (/^(?:forget (?:everything|all(?: my memory)?|my memory)|clear (?:my )?memory|delete (?:my )?memory)$/i.test(value))
    return {type: "forget-all"};
  const forget = value.match(/^(?:forget|delete|remove)\s+(?:about\s+|that\s+)?(.+?)\s*[.!?]*$/i);
  if (forget && !/^(?:everything|all|my memory)$/i.test(forget[1])) return {type: "forget-one", query: forget[1].trim()};
  const remember = value.match(/^(?:please\s+)?remember\s+(?:(?:that|this)\s+(.+)|((?:my|our)\s+.+)|((?:to always|for future(?: chats)?|in future)\s+.+))$/i);
  if (remember) {
    const note = (remember[1] || remember[2] || remember[3] || "").trim().replace(/[.!?]+$/, "").slice(0, MAX_MEMORY_CHARS);
    if (note) return {type: "remember", text: note};
  }
  return null;
}
