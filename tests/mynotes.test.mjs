import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC_AUDIENCE,validateSelfLog,validateRetained,consistency,whoKnows,retainedSeries} from '../js/mynotes.js';

const playerIds = ['alice','bruno','chloe'];
const roleIds = ['empath','chef','towncrier','savant'];

test('self log validator normalises good data and drops unknown fields',()=>{
  const clean = validateSelfLog([{id:'s1',day:1,phase:'day',audience:['alice','bruno'],roleIds:['empath'],text:'I saw 0',status:'told',extra:'drop'}],{playerIds,roleIds});
  assert.deepEqual(clean,[{id:'s1',day:1,phase:'day',audience:['alice','bruno'],roleIds:['empath'],text:'I saw 0',status:'told'}]);
  assert.equal(validateSelfLog([],{playerIds:new Set(playerIds),roleIds:new Set(roleIds)}).length,0);
});

test('self log rejects bad ids, oversized text, enum values and unsafe keys',()=>{
  assert.throws(()=>validateSelfLog([{id:'bad id',day:1,phase:'day',audience:['alice'],roleIds:[],text:'',status:'kept'}],{playerIds,roleIds}),/Invalid ID/);
  assert.throws(()=>validateSelfLog([{id:'s1',day:1,phase:'dusk',audience:['alice'],roleIds:[],text:'',status:'kept'}],{playerIds,roleIds}),/Invalid value/);
  assert.throws(()=>validateSelfLog([{id:'s1',day:1,phase:'day',audience:['missing'],roleIds:[],text:'',status:'kept'}],{playerIds,roleIds}),/Missing player/);
  assert.throws(()=>validateSelfLog([{id:'s1',day:1,phase:'day',audience:['alice'],roleIds:[],text:'x'.repeat(2001),status:'kept'}],{playerIds,roleIds}),/Invalid text/);
  assert.throws(()=>validateSelfLog([JSON.parse('{"id":"s1","day":1,"phase":"day","audience":["alice"],"roleIds":[],"text":"","status":"kept","__proto__":{}}')],{playerIds,roleIds}),/Unsafe key/);
});

test('retained validator normalises good data and rejects invalid fields',()=>{
  const clean = validateRetained([{id:'r1',night:1,roleId:'empath',value:'0',text:'Neighbours',shared:false,extra:'drop'}],{roleIds});
  assert.deepEqual(clean,[{id:'r1',night:1,roleId:'empath',value:'0',text:'Neighbours',shared:false}]);
  assert.equal(validateRetained([],{roleIds:new Set(roleIds)}).length,0);
  assert.throws(()=>validateRetained([{id:'r1',night:1,roleId:'missing',value:'0',text:'',shared:false}],{roleIds}),/Role not on script/);
  assert.throws(()=>validateRetained([{id:'__proto__',night:1,roleId:'empath',value:'0',text:'',shared:false}],{roleIds}),/Invalid ID/);
  assert.throws(()=>validateRetained([{id:'r1',night:1,roleId:'empath',value:'x'.repeat(81),text:'',shared:false}],{roleIds}),/Invalid text/);
});

test('consistency reports own claims per audience without verdict wording',()=>{
  const log = validateSelfLog([
    {id:'a',day:1,phase:'day',audience:['alice'],roleIds:['empath'],text:'N1 zero',status:'told'},
    {id:'b',day:2,phase:'day',audience:[PUBLIC_AUDIENCE],roleIds:['chef'],text:'I am Chef',status:'public'}
  ],{playerIds,roleIds});
  const out = consistency(log,{roleName:id=>({empath:'Empath',chef:'Chef'}[id] ?? id)});
  assert.equal(out.claimsByAudience.length,2);
  assert.deepEqual(out.claimsByAudience.find(a=>a.type==='public').claims.map(c=>c.roleName),['Chef']);
  const words = JSON.stringify(out).toLowerCase();
  assert.ok(!/lie|contradiction|risk|risque|mensonge/.test(words));
});

test('whoKnows maps private audiences and never invents public listeners',()=>{
  const log = validateSelfLog([
    {id:'a',day:1,phase:'day',audience:['alice','bruno'],roleIds:['empath'],text:'N1 0',status:'told'},
    {id:'b',day:1,phase:'day',audience:[PUBLIC_AUDIENCE],roleIds:['chef'],text:'public',status:'public'}
  ],{playerIds,roleIds});
  const out = whoKnows(log);
  assert.deepEqual(Object.keys(out).sort(),['alice','bruno']);
  assert.deepEqual(out.alice[0].roleIds,['empath']);
});

test('retainedSeries formats compact series and handles gaps',()=>{
  const retained = validateRetained([
    {id:'r1',night:1,roleId:'empath',value:'0',text:'',shared:false},
    {id:'r3',night:3,roleId:'empath',value:'1',text:'',shared:true},
    {id:'s2',night:2,roleId:'savant',value:'A/B',text:'two statements',shared:false}
  ],{roleIds});
  const out = retainedSeries(retained,{roleName:id=>id.toUpperCase(),lang:'en'});
  assert.equal(out.find(r=>r.roleId==='empath').series,'N1 0, N3 1');
  assert.equal(out.find(r=>r.roleId==='savant').series,'N2 A/B');
});
