import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,uid,validateGame} from '../js/state.js';
import {buildInvestigation,selectRecords,describeRelation,buildRelations} from '../js/investigation.js';
function make(){
  const g=newGame({name:'X',roleIds:['chef','empath','monk','poisoner','imp'],customRoles:[],warnings:[]},['Alice','Bruno','Chloé','David','Emma']);
  g.claims=[{id:'c1',playerId:g.players[0].id,sourceId:g.players[1].id,roleIds:['chef','empath'],note:'deux rôles',day:1,phase:'day',visibility:'private',weight:5}];
  g.events=[{id:'log1',type:'claim',playerIds:[g.players[0].id],sourceId:g.players[1].id,roleId:'',text:'duplicate journal mirror',value:'c1',day:1,phase:'day',aliveSnapshot:[]},{id:'e1',type:'info',playerIds:[g.players[2].id],sourceId:g.players[0].id,roleId:'',text:'information sans supposition',value:'1',day:1,phase:'night',aliveSnapshot:[]}];
  return validateGame(g);
}
test('graph connects real sources and subjects, never duplicates mirrored claims',()=>{
  const g=make(),m=buildInvestigation(g);assert.equal(m.records.length,2);assert.ok(m.edges.some(e=>e.from==='player:'+g.players[1].id&&e.to==='claim:c1'&&e.kind==='source'));assert.ok(m.edges.some(e=>e.from==='player:'+g.players[0].id&&e.to==='claim:c1'&&e.kind==='subject'));assert.ok(m.edges.some(e=>e.from==='claim:c1'&&e.to==='model'));assert.ok(!m.edges.some(e=>e.from==='event:e1'&&e.to==='model'));
});
test('neutral, old and archived claims never receive model-influence edges',()=>{
  const g=make();g.claims.push({...g.claims[0],id:'c2',day:2,weight:1});let m=buildInvestigation(g);assert.ok(!m.edges.some(e=>e.to==='model'));
  g.archivedPlayers=[g.players[0]];g.players=g.players.slice(1);g.claims[1].weight=20;m=buildInvestigation(g);assert.ok(!m.edges.some(e=>e.to==='model'));assert.equal(m.people.find(p=>p.id===g.archivedPlayers[0].id).archived,true);
});
test('strict hypotheses produce chosen-assumption edges, not observed evidence',()=>{
  const g=make();g.scenarios[0].constraints=[{id:'r1',players:[g.players[0].id],roleIds:['chef'],min:1,max:1,note:'Si je le crois',enabled:true}];
  const m=buildInvestigation(g);assert.equal(m.records.find(r=>r.id==='relation:r1').type,'hypothesis');assert.ok(m.edges.some(e=>e.from==='relation:r1'&&e.kind==='strict'));assert.ok(describeRelation(g.scenarios[0].constraints[0],id=>g.players.find(p=>p.id===id).name,x=>x).includes('une seule personne'));
});
test('filtering keeps complete original graph and includes accents and role IDs',()=>{
  const g=make(),m=buildInvestigation(g);
  assert.equal(selectRecords(m,{person:g.players[2].id}).length,1);assert.equal(selectRecords(m,{phase:'night:1'}).length,1);assert.equal(selectRecords(m,{query:'deux roles'}).length,1);assert.equal(selectRecords(m,{query:'empath'}).length,1);assert.equal(m.records.length,2);
});
test('unknown voter is not invented as an observed voter link',()=>{
  const g=make();g.events[1].type='vote';g.events[1].ballot=[{playerId:g.players[3].id,choice:'unknown',weight:null},{playerId:g.players[4].id,choice:'no',weight:0}];
  const m=buildInvestigation(g);assert.ok(!m.edges.some(e=>e.from==='player:'+g.players[3].id));assert.ok(m.edges.some(e=>e.from==='player:'+g.players[4].id));
});
test('per-player candidate restrictions are present as distinct manual hypotheses',()=>{
  const g=make();g.scenarios[0].domains[g.players[0].id]=['chef','monk'];
  const m=buildInvestigation(g),r=m.records.find(r=>r.domain);
  assert.deepEqual(r.roleIds,['chef','monk']);assert.equal(r.type,'restriction');assert.equal(r.impact,'strict');assert.ok(m.edges.some(e=>e.from===r.id&&e.to==='model'));assert.ok(!m.edges.some(e=>e.from==='claim:c1'&&e.to===r.id));
});
test('player relations aggregate links without self-links or unknown ballots',()=>{
  const g=make();
  g.claims.push(
    {id:'c2',playerId:g.players[1].id,sourceId:g.players[0].id,roleIds:['chef'],note:'shared',day:2,phase:'day',visibility:'private',weight:1},
    {id:'c3',playerId:g.players[2].id,sourceId:g.players[2].id,roleIds:['monk'],note:'self source',day:2,phase:'day',visibility:'private',weight:1}
  );
  g.events.push({id:'v1',type:'execution',playerIds:[g.players[1].id],sourceId:g.players[0].id,roleId:'',text:'vote',value:'',day:2,phase:'day',aliveSnapshot:[],ballot:[
    {playerId:g.players[0].id,choice:'yes',weight:1},
    {playerId:g.players[2].id,choice:'unknown',weight:null},
    {playerId:g.players[3].id,choice:'yes',weight:1}
  ],outcome:'unknown',complete:false,influence:{roleIds:[],multiplier:1,demonOnly:false,stable:false}});
  g.events.push({...g.events.at(-1),id:'v2'});
  g.scenarios[0].constraints=[{id:'pair',players:[g.players[0].id,g.players[1].id,g.players[2].id],roleIds:['chef'],min:1,max:1,note:'pair note',enabled:true}];
  const graph=buildRelations(validateGame(g));
  assert.ok(graph.nodes.every(n=>typeof n.seat==='number'&&'archived' in n&&'trust' in n));
  assert.ok(!graph.links.some(l=>l.from===l.to));
  assert.ok(!graph.links.some(l=>l.kind==='voted'&&l.from===g.players[2].id));
  const vote=graph.links.find(l=>l.kind==='voted'&&l.from===g.players[3].id&&l.to===g.players[1].id);
  assert.equal(vote.weight,2);assert.deepEqual(vote.refs.sort(),['event:v1','event:v2']);
  const nominated=graph.links.find(l=>l.kind==='nominated'&&l.from===g.players[0].id&&l.to===g.players[1].id);
  assert.equal(nominated.weight,2);
  assert.ok(graph.links.some(l=>l.kind==='conflict'&&l.from===g.players[0].id&&l.to===g.players[1].id));
  assert.ok(graph.links.some(l=>l.kind==='paired'&&l.from===g.players[1].id&&l.to===g.players[2].id&&l.refs.includes('relation:pair')));
});
