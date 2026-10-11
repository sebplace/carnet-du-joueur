const CACHE='botc-player-shell-v21';
const ASSETS=['./','./index.html','./style.css','./icon.svg','./logo.svg','./icon-192.png','./icon-512.png','./icon-maskable.png','./assets/welcome-table.png','./assets/fonts/cormorant-garamond-latin-600-normal.woff2','./assets/fonts/cormorant-garamond-latin-700-normal.woff2','./manifest.webmanifest','./guide.html','./404.html','./data/catalogue.json','./js/state.js','./js/catalogue.js','./js/app.js','./js/inference.js','./js/inference-worker.js','./js/evidence.js','./js/probability.js','./js/roster.js','./js/investigation.js','./js/rules-coverage.js','./js/encode.js','./js/encode-ui.js','./js/script-builder.js','./js/mynotes.js','./js/print.js','./js/plan.js','./js/history.js','./js/estimator-client.js'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('botc-player-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{
  if(event.data==='SKIP_WAITING'||event.data?.type==='SKIP_WAITING')self.skipWaiting();
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const cached=await cache.match(event.request,{ignoreSearch:true});
    if(cached)return cached;
    try{return await fetch(event.request);}
    catch(error){
      if(event.request.mode==='navigate'){
        const shell=await cache.match('./index.html');
        if(shell)return shell;
      }
      throw error;
    }
  }));
});







