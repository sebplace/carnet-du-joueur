import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,validateGame,uid} from '../js/state.js';
import {toEngineConstraint,constraintPeople,buildEvidenceModel} from '../js/evidence.js';
import {describeRelation} from '../js/investigation.js';
import {estimate} from '../js/probability.js';

const cat={roles:[
  {id:'washerwoman',team:'townsfolk'},{id:'chef',team:'townsfolk'},{id:'empath',team:'townsfolk'},
  {id:'monk',team:'townsfolk'},{id:'soldier',team:'townsfolk'},
  {id:'poisoner',team:'minion'},{id:'imp',team:'demon'}
]};
const script={name:'Test',roleIds:cat.roles.map(r=>r.id),customRoles:[],warnings:[]};
const make=()=>newGame(script,['Alice','Bruno','Chloé','David','Emma']);

function neighbourConstraint(anchor,extra={}) {
  return {id:uid(),kind:'neighbours',players:[],anchor,roleIds:['poisoner'],min:1,max:1,note:'Empathe 1',enabled:true,provenance:'ability',fragile:false,...extra};
}

test('a neighbourhood idea is stored without freezing who the neighbours are', () => {
  const g=make();
  g.scenarios[0].constraints=[neighbourConstraint(g.players[0].id)];
  const saved=validateGame(g);
  const c=saved.scenarios[0].constraints[0];
  assert.equal(c.kind,'neighbours');
  assert.equal(c.anchor,g.players[0].id);
  assert.deepEqual(c.players,[]);
  assert.deepEqual(constraintPeople(c),[g.players[0].id]);
});

test('a neighbourhood idea refuses an impossible bound or a missing anchor', () => {
  const g=make();
  g.scenarios[0].constraints=[neighbourConstraint(g.players[0].id,{max:3,min:3})];
  assert.throws(()=>validateGame(g),/Voisinage|neighbourhood/);
  const h=make();
  h.scenarios[0].constraints=[neighbourConstraint('',{anchor:''})];
  assert.throws(()=>validateGame(h),/Voisinage|neighbourhood|invalide|Invalid/);
});

test('an ordinary group idea keeps working exactly as before', () => {
  const g=make();
  g.scenarios[0].constraints=[{id:uid(),players:[g.players[0].id,g.players[1].id],roleIds:['imp'],min:1,max:1,note:'n',enabled:true,provenance:'hunch',fragile:false}];
  const saved=validateGame(g);
  const c=saved.scenarios[0].constraints[0];
  assert.equal(c.kind,'group');
  assert.deepEqual(toEngineConstraint(c),{id:c.id,players:c.players,roleIds:['imp'],min:1,max:1});
});

test('the engine receives a live neighbourhood constraint that skips the dead', () => {
  const g=make();
  g.players[1].alive=false;
  g.scenarios[0].constraints=[neighbourConstraint(g.players[0].id)];
  const model=buildEvidenceModel(validateGame(g),cat);
  const c=model.input.constraints[0];
  assert.equal(c.type,'player-neighbours');
  assert.equal(c.playerId,g.players[0].id);
  assert.deepEqual(c.skipPlayers,[g.players[1].id]);
});

test('a neighbourhood idea actually restricts the computed worlds', () => {
  const g=validateGame(make());
  const base=buildEvidenceModel(g,cat).input;
  const free=estimate(base,{maxNodes:200000,timeMs:2000,maxWorlds:200000});
  const withIdea=structuredClone(g);
  withIdea.scenarios[0].constraints=[neighbourConstraint(g.players[0].id)];
  const bound=estimate(buildEvidenceModel(validateGame(withIdea),cat).input,{maxNodes:200000,timeMs:2000,maxWorlds:200000});
  assert.ok(free.complete&&bound.complete,'both searches must be complete to compare');
  assert.ok(bound.worlds<free.worlds,'the idea must remove worlds');
  const neighbours=[g.players[1].id,g.players[4].id];
  const poisonerNextDoor=neighbours.reduce((sum,id)=>sum+(bound.probabilities[id].poisoner||0),0);
  assert.ok(Math.abs(poisonerNextDoor-1)<1e-9,'exactly one neighbour must hold the character');
  assert.equal(bound.probabilities[g.players[2].id].poisoner||0,0);
});

test('the sentence names the anchor, not a frozen pair', () => {
  const g=make();
  const c=neighbourConstraint(g.players[0].id);
  const names={[g.players[0].id]:'Alice'};
  const fr=describeRelation(c,id=>names[id]||id,id=>id,'fr');
  const en=describeRelation(c,id=>names[id]||id,id=>id,'en');
  assert.match(fr,/voisins vivants de Alice/);
  assert.match(en,/Alice's two living neighbours/);
});
