const CACHE = "artcraft-assistant-v8";
const FILES = ["./","./index.html","./style.css","./app.js","./engine.js","./memory.js","./files.js","./vision.js","./vendor/transformers.min.js","./vendor/ort/ort-wasm-simd-threaded.jsep.mjs","./vendor/ort/ort-wasm-simd-threaded.jsep.wasm","./catalog.json","./model.json","./README.md","./fonts/inter-regular.woff","./fonts/inter-semibold.woff"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    for(const name of await caches.keys()) if(name.startsWith("artcraft-assistant-")&&name!==CACHE) await caches.delete(name);
    await self.clients.claim();
    for(const client of await self.clients.matchAll()) client.postMessage({type:"offline-ready"});
  })());
});
self.addEventListener("fetch",event=>{
  const url = new URL(event.request.url);
  if(event.request.method!=="GET"||url.origin!==self.location.origin||!url.pathname.startsWith(new URL("./",self.location.href).pathname)) return;
  // Network-first preserves updated checkpoints. Ignore query strings for embedded offline chat.
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const canonical=new Request(url.origin+url.pathname);
    try{
      const response=await fetch(event.request);
      if(response.ok) await cache.put(canonical,response.clone());
      return response;
    }catch{
      const cached=await cache.match(canonical);
      if(cached) return cached;
      return new Response("This assistant resource is not cached. Reconnect once to install offline chat.",{status:503,headers:{"Content-Type":"text/plain"}});
    }
  })());
});
