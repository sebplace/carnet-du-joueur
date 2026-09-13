import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,validateGame,createStorage,STORAGE_KEY,BACKUP_KEY,BACKUP_KEYS,normalCounts,parseSave,LIMITS,SCHEMA_VERSION} from '../js/state.js';
const script={name:'Example',roleIds:['chef','imp','monk','empath','poisoner'],customRoles:[],warnings:[]};
const make=()=>newGame(script,['A','B','C','D','E']);
class Storage {
  values=new Map();fail=false;
  getItem(k){return this.values.get(k)??null;}
  setItem(k,v){if(this.fail)throw new Error('quota');this.values.set(k,v);}
}
test('new game round trip is canonical and independent of script input',()=>{
  const g=make();assert.deepEqual(validateGame(g),g);g.script.roleIds.push('soldier');assert.equal(script.roleIds.length,5);
  assert.deepEqual(normalCounts(7),{townsfolk:5,outsider:0,minion:1,demon:1});
});
test('20 seats means 15 ordinary and 5 travellers',()=>{
  const g=newGame(script,Array.from({length:20},(_,i)=>String(i)));assert.equal(g.players.filter(p=>p.traveller).length,5);
  assert.throws(()=>newGame(script,['A']));
});
test('strict validation rejects bad player references and prototype IDs',()=>{
  const g=make();g.players[0].id='__proto__';assert.throws(()=>validateGame(g));
  const h=make();h.scenarios[0].domains.unknown=['chef'];assert.throws(()=>validateGame(h));
  const j=make();j.scenarios[0].domains[j.players[0].id]=['notonscript'];assert.throws(()=>validateGame(j));
});
test('custom fields are safely allowlisted, unknown role retained',()=>{
  const g=make();g.privateToken='bad';g.script.remoteImage='https://example.com/x';g.players[0].image='bad';
  const clean=validateGame(g);assert.equal(clean.privateToken,undefined);assert.equal(clean.script.remoteImage,undefined);assert.equal(clean.players[0].image,undefined);
});
test('duplicates and malformed states rejected',()=>{
  const g=make();g.players[1].id=g.players[0].id;assert.throws(()=>validateGame(g));
  const h=make();h.players[0].alive='true';assert.throws(()=>validateGame(h));
  const j=make();j.scenarios[0].counts.demon=1.5;assert.throws(()=>validateGame(j));
  assert.throws(()=>parseSave('{"version":99}'));assert.throws(()=>parseSave(' '.repeat(LIMITS.save+1)));
});
test('storage rollback and cross-tab compare-and-swap',()=>{
  const raw=new Storage(),a=createStorage(raw),b=createStorage(raw);
  assert.equal(a.load(),null);a.save(make());const first=raw.getItem(STORAGE_KEY);
  const gb=b.load();gb.title='Other';b.save(gb);assert.throws(()=>a.save(make()),/another|autre/i);
  assert.notEqual(raw.getItem(STORAGE_KEY),first);
  const current=raw.getItem(STORAGE_KEY);raw.fail=true;assert.throws(()=>b.save(make()),/quota/);assert.equal(raw.getItem(STORAGE_KEY),current);
});
test('explicit replacement preserves previous saved game as backup',()=>{
  const raw=new Storage(),s=createStorage(raw);s.load();const g=make();s.save(g);const h=make();s.save(h,{backup:true});
  assert.equal(s.backup().id,g.id);assert.equal(JSON.parse(raw.getItem(BACKUP_KEY)).id,g.id);
});
test('malformed save survives load error and can be backed up explicitly',()=>{
  const raw=new Storage();raw.setItem(STORAGE_KEY,'broken');const s=createStorage(raw);assert.throws(()=>s.load());
  assert.equal(raw.getItem(STORAGE_KEY),'broken');s.save(make(),{backup:true});assert.equal(raw.getItem(BACKUP_KEY),'broken');
});
test('bounded notes and evidence are not assumptions',()=>{
  const g=make();const p=g.players[0].id;
  g.claims.push({id:'claim1',playerId:p,roleIds:['chef'],sourceId:p,visibility:'private',note:'Claim only',day:1,phase:'day'});
  const clean=validateGame(g);assert.deepEqual(clean.scenarios[0].domains,{});assert.deepEqual(clean.scenarios[0].constraints,[]);
  g.claims[0].note='x'.repeat(2001);assert.throws(()=>validateGame(g));
});
test('constraints require valid references and bounds',()=>{
  const g=make();g.scenarios[0].constraints=[{id:'c',players:[g.players[0].id],roleIds:['imp'],min:1,max:2,note:'test',enabled:true}];assert.throws(()=>validateGame(g));
  g.scenarios[0].constraints[0].max=1;assert.equal(validateGame(g).scenarios[0].constraints.length,1);
});
const bigEvent=i=>({id:'e'+i,type:'note',text:'x'.repeat(4000),playerIds:[],sourceId:'',roleId:'',value:'',day:1,phase:'day',aliveSnapshot:[],ballot:[],outcome:'unknown',complete:false,influence:{roleIds:[],multiplier:1,demonOnly:false,stable:false}});
test('D1: save refuses a notebook too large to be reloaded and keeps the previous value intact',()=>{
  const raw=new Storage(),s=createStorage(raw);s.load();const small=make();s.save(small);const kept=raw.getItem(STORAGE_KEY);
  const big=make();big.events=Array.from({length:LIMITS.events},(_,i)=>bigEvent(i));
  assert.ok(JSON.stringify(validateGame(big)).length>LIMITS.save);
  assert.throws(()=>s.save(big),/trop volumineuse|too large/i);
  assert.equal(raw.getItem(STORAGE_KEY),kept);
  assert.deepEqual(parseSave(raw.getItem(STORAGE_KEY)),small);
});
class MainFail{values=new Map();block=false;getItem(k){return this.values.get(k)??null;}setItem(k,v){if(this.block&&k===STORAGE_KEY)throw new Error('quota');this.values.set(k,v);}removeItem(k){this.values.delete(k);}}
class BackupFail{values=new Map();block=false;getItem(k){return this.values.get(k)??null;}setItem(k,v){if(this.block&&k!==STORAGE_KEY)throw new Error('quota');this.values.set(k,v);}removeItem(k){this.values.delete(k);}}
test('D3: a failed main write never rotates the backups',()=>{
  const raw=new MainFail(),s=createStorage(raw);s.load();const a=make();s.save(a);const b=make();s.save(b,{backup:true});
  const before=BACKUP_KEYS.map(k=>raw.getItem(k));raw.block=true;
  assert.throws(()=>s.save(make(),{backup:true}),/quota/);raw.block=false;
  assert.deepEqual(BACKUP_KEYS.map(k=>raw.getItem(k)),before);
  assert.equal(raw.getItem(STORAGE_KEY),JSON.stringify(validateGame(b)));
});
test('D3: a backup that would only duplicate the current notebook is skipped',()=>{
  const raw=new Storage(),s=createStorage(raw);s.load();const a=make();s.save(a);s.save(a,{backup:true});
  const before=BACKUP_KEYS.map(k=>raw.getItem(k));s.save(a,{backup:true});
  assert.deepEqual(BACKUP_KEYS.map(k=>raw.getItem(k)),before);
});
test('D3: if only the backup rotation fails the prior backups are restored',()=>{
  const raw=new BackupFail(),s=createStorage(raw);s.load();const a=make();s.save(a);const b=make();s.save(b,{backup:true});
  const before=BACKUP_KEYS.map(k=>raw.getItem(k));const c=make();raw.block=true;
  assert.throws(()=>s.save(c,{backup:true}),/quota/);raw.block=false;
  assert.equal(raw.getItem(STORAGE_KEY),JSON.stringify(validateGame(c)));
  assert.deepEqual(BACKUP_KEYS.map(k=>raw.getItem(k)),before);
});
test('D5: names are measured by NFC length, so a decomposed name is not falsely rejected',()=>{
  const g=make();const nfd='é'.normalize('NFD').repeat(40);
  assert.equal(nfd.length,80);assert.equal(nfd.normalize('NFC').length,40);
  g.players[0].name=nfd;const clean=validateGame(g);
  assert.equal(clean.players[0].name,nfd);
});
test('settings gain claimRoleEnrichment (default true) and unlocked (default false), preserved on round trip',()=>{
  const fresh=make();assert.equal(fresh.settings.claimRoleEnrichment,true);assert.equal(fresh.settings.unlocked,false);
  const legacy=make();delete legacy.settings.claimRoleEnrichment;delete legacy.settings.unlocked;legacy.version=1;
  const migrated=validateGame(legacy);assert.equal(migrated.settings.claimRoleEnrichment,true);assert.equal(migrated.settings.unlocked,false);
  const g=make();g.settings.claimRoleEnrichment=false;g.settings.unlocked=true;
  const round=parseSave(JSON.stringify(validateGame(g)));
  assert.equal(round.settings.claimRoleEnrichment,false);assert.equal(round.settings.unlocked,true);
  const h=make();h.settings.claimRoleEnrichment='yes';assert.throws(()=>validateGame(h));
});
