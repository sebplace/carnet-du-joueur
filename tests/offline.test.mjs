import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
test('offline cache contains every boot and worker dependency, including icons and guide',()=>{
  const sw=read('sw.js');
  for(const file of ['index.html','style.css','css/board.css','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','icon-maskable.png','guide.html','data/catalogue.json','js/app.js','js/state.js','js/catalogue.js','js/inference.js','js/inference-worker.js','js/evidence.js','js/probability.js','js/roster.js','js/investigation.js','js/rules-coverage.js','js/board.js','js/mynotes.js','js/print.js','js/history.js','js/estimator-client.js']){
    assert.ok(existsSync(new URL(`../${file}`,import.meta.url)),file);
    assert.ok(sw.includes(`'./${file}'`),`cache missing ${file}`);
  }
  const assets=[...read('index.html').matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(m=>m[1]);
  for(const file of assets)assert.ok(sw.includes(`'./${file}'`),file);
  assert.ok(sw.includes("k.startsWith('botc-player-shell-')"));
  // Updates must never be forced on their own: skipWaiting may only run when the page explicitly asks for it.
  const handlers=sw.split(/self\.addEventListener\(/).slice(1).map(block=>({name:block.slice(1,block.indexOf(block[0],1)),body:block}));
  for(const handler of handlers){
    if(handler.name==='message')continue;
    assert.ok(!handler.body.includes('skipWaiting'),`${handler.name} must not force an update`);
  }
  assert.ok(handlers.some(h=>h.name==='message'&&h.body.includes('skipWaiting')),'an explicit update request must be supported');
});
test('separate application never reads Storyteller storage or endpoints',()=>{
  for(const f of ['js/state.js','js/app.js','sw.js']){
    const src=read(f);assert.ok(!src.includes('botc-mj-state'));assert.ok(!src.includes('blood-clocktower-mj/'));
  }
});
