import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,validateGame,uid,parseSave,SCHEMA_VERSION} from '../js/state.js';
import {applyRoster,rosterImpact} from '../js/roster.js';
import {buildEvidenceModel} from '../js/evidence.js';
const cat={roles:[{id:'chef',team:'townsfolk'},{id:'monk',team:'townsfolk'},{id:'empath',team:'townsfolk'},{id:'soldier',team:'townsfolk'},{id:'saint',team:'outsider'},{id:'poisoner',team:'minion'},{id:'imp',team:'demon'}]};
function make(){
  const g=newGame({name:'Fixture',roleIds:cat.roles.map(r=>r.id),customRoles:[],warnings:[]},['A','B','C','D','E','F','G']);
  g.claims=[{id:uid(),playerId:g.players[0].id,roleIds:['chef'],sourceId:g.players[1].id,visibility:'private',note:'do not lose',day:1,phase:'day',weight:5}];
  g.events=[{id:uid(),type:'execution',text:'history',playerIds:[g.players[0].id],sourceId:g.players[1].id,roleId:'',value:'1',day:1,phase:'day',aliveSnapshot:g.players.map(p=>p.id),ballot:[{playerId:g.players[0].id,choice:'yes',weight:1}],outcome:'unknown'}];
  g.scenarios[0].constraints=[{id:uid(),players:[g.players[0].id,g.players[1].id],roleIds:['chef'],min:1,max:1,note:'if true',enabled:true}];
  g.estimateConsent=true;return validateGame(g);
}
const rows=g=>g.players.map(({id,name,traveller})=>({id,name,traveller}));
test('rename and reorder preserve stable IDs, records and model settings',()=>{
  const g=make(),r=rows(g);r[0].name='Alice';[r[0],r[2]]=[r[2],r[0]];
  const next=applyRoster(g,r);assert.equal(next.players[2].id,g.players[0].id);assert.equal(next.players[2].name,'Alice');assert.deepEqual(next.claims,g.claims);assert.deepEqual(next.events,g.events);assert.deepEqual(next.scenarios,g.scenarios);assert.equal(next.rosterReviewRequired,false);assert.equal(next.estimateConsent,true);
});
test('removal archives participant and all references, suspends calculations',()=>{
  const g=make(),r=rows(g).slice(1),impact=rosterImpact(g,r),next=applyRoster(g,r);
  assert.equal(impact.affected,1);assert.equal(next.players.length,6);assert.equal(next.archivedPlayers[0].id,g.players[0].id);assert.deepEqual(next.claims,g.claims);assert.deepEqual(next.events,g.events);assert.equal(next.scenarios[0].constraints[0].enabled,false);assert.equal(next.estimateConsent,false);assert.equal(next.rosterReviewRequired,true);assert.throws(()=>buildEvidenceModel(next,cat),/Roster changed/);assert.deepEqual(parseSave(JSON.stringify(next)),next);
});
test('restoring archived seat restores original ID, state and references',()=>{
  const g=make();g.players[0].alive=false;
  const removed=applyRoster(g,rows(g).slice(1)),next=applyRoster(removed,[...rows(removed),removed.archivedPlayers[0]]);
  assert.equal(next.archivedPlayers.length,0);assert.equal(next.players.at(-1).id,g.players[0].id);assert.equal(next.players.at(-1).alive,false);assert.deepEqual(next.events,g.events);
});
test('new player gets distinct fresh identity, not a removed identity',()=>{
  const g=make(),id=uid(),next=applyRoster(g,[...rows(g).slice(1),{id,name:'New person',traveller:false}]);
  assert.equal(next.players.at(-1).id,id);assert.equal(next.archivedPlayers[0].id,g.players[0].id);assert.equal(next.claims[0].playerId,g.players[0].id);assert.equal(next.players.at(-1).alive,true);
});
test('type correction disables incompatible constraints without deleting their rationale',()=>{
  const g=make(),r=rows(g);r[0].traveller=true;const next=applyRoster(g,r);
  assert.equal(next.rosterReviewRequired,true);assert.equal(next.scenarios[0].constraints.length,1);assert.equal(next.scenarios[0].constraints[0].note,'if true');assert.equal(next.scenarios[0].constraints[0].enabled,false);
});
test('limits and invalid roster edits leave source untouched',()=>{
  const g=make(),before=structuredClone(g);assert.throws(()=>applyRoster(g,rows(g).slice(0,4)));assert.throws(()=>applyRoster(g,[...rows(g),rows(g)[0]]));const r=rows(g);r[0].name=' ';assert.throws(()=>applyRoster(g,r));assert.deepEqual(g,before);
});
test('legacy schema2 adds archive storage without fabricating participants',()=>{
  const g=make();g.version=2;delete g.archivedPlayers;delete g.rosterReviewRequired;
  const n=validateGame(g);assert.equal(n.version,SCHEMA_VERSION);assert.deepEqual(n.archivedPlayers,[]);assert.equal(n.rosterReviewRequired,false);assert.deepEqual(n.events,g.events);
});
test('unchanged clean roster remains eligible for evidence calculation',()=>{
  const g=make(),next=applyRoster(g,rows(g));
  assert.equal(next.rosterReviewRequired,false);
  assert.equal(buildEvidenceModel(next,cat).input.players.length,7);
});
test('D2: archiving then restoring my own seat preserves my identity and secret role',()=>{
  const g=make();const me=g.players[0].id;g.myId=me;g.myRole='chef';const g2=validateGame(g);
  assert.equal(g2.myId,me);assert.equal(g2.myRole,'chef');
  const removed=applyRoster(g2,rows(g2).slice(1));
  assert.equal(removed.myId,'');assert.equal(removed.myRole,'');
  assert.equal(removed.archivedSelf.playerId,me);assert.equal(removed.archivedSelf.myRole,'chef');
  assert.deepEqual(parseSave(JSON.stringify(removed)),removed);
  const restored=applyRoster(removed,[...rows(removed),removed.archivedPlayers.find(p=>p.id===me)]);
  assert.equal(restored.myId,me);assert.equal(restored.myRole,'chef');
  assert.equal(restored.archivedSelf,undefined);
});
