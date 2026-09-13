import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,validateGame,uid,SCHEMA_VERSION} from '../js/state.js';
import {buildEvidenceModel,lastClaim,ballotSummary,claimEnrichmentNotices,CLAIM_ROLE_ENRICHMENT_NOTICES,INCOMPATIBLE_ROLE_IDS,INCOMPATIBLE_ROLE_REASONS} from '../js/evidence.js';
import {estimate} from '../js/probability.js';
const cat={roles:[{id:'chef',team:'townsfolk'},{id:'monk',team:'townsfolk'},{id:'empath',team:'townsfolk'},{id:'poisoner',team:'minion'},...['imp','shabaloth','po','vortox','newdemon'].map(id=>({id,team:'demon'}))]};
function make(){return newGame({name:'Example',roleIds:cat.roles.map(r=>r.id),customRoles:[],warnings:[]},['A','B','C','D','E']);}
function claim(g,day,weight=5){return {id:uid(),playerId:g.players[0].id,roleIds:['chef','monk','empath'],sourceId:g.players[0].id,visibility:'private',note:'',day,phase:'day',weight};}
function night(g,day,ids,active=false,optIn=false){return {id:uid(),type:'night',day,phase:'night',playerIds:ids,sourceId:'',text:'Observed',value:String(ids.length),roleId:'',aliveSnapshot:[],ballot:[],outcome:'unknown',complete:false,demonCapacityOptIn:optIn,influence:{roleIds:[],multiplier:1,demonOnly:active,stable:active,demonCapacityOptIn:optIn}};}
test('legacy claims/events migrate neutral, with no inferred consent or voters',()=>{
  const g=make(),c=claim(g,1);g.version=1;delete c.weight;g.claims=[c];delete g.estimateConsent;
  g.events=[{id:uid(),type:'execution',text:'legacy',value:'',playerIds:[g.players[0].id],sourceId:'',roleId:'',day:1,phase:'day',aliveSnapshot:[]}];
  const clean=validateGame(g);assert.equal(clean.version,SCHEMA_VERSION);assert.equal(clean.claims[0].weight,1);assert.equal(clean.estimateConsent,false);assert.deepEqual(clean.events[0].ballot,[]);assert.equal(clean.events[0].outcome,'unknown');assert.equal(buildEvidenceModel(clean,cat).input.factors.length,0);
});
test('only chronologically latest claim weighted; outside roles remain in domain',()=>{
  const g=make();const newer=claim(g,3,5),older=claim(g,1,20);g.claims=[newer,older];
  assert.equal(lastClaim(g,g.players[0].id).id,newer.id);
  const m=buildEvidenceModel(validateGame(g),cat);assert.equal(m.input.factors.length,1);assert.equal(m.input.factors[0].match,5);assert.equal(m.input.factors[0].miss,1);assert.equal(m.input.factors[0].roleIds.length,3);assert.deepEqual(m.input.players[0].candidates,[]);
});
test('lastClaim keeps chronological tie-breaking with later array entry winning exact ties',()=>{
  const g=make(),nightClaim={...claim(g,2),id:'night',phase:'night'},dayClaim={...claim(g,2),id:'day',phase:'day'},sameTime={...claim(g,2),id:'same',phase:'day'};
  g.claims=[dayClaim,nightClaim,sameTime];
  assert.equal(lastClaim(g,g.players[0].id).id,'same');
});
test('night observations neutral unless both causal and stable assumptions explicit',()=>{
  const g=make(),e=night(g,2,g.players.slice(0,3).map(p=>p.id));g.events=[e];
  assert.equal(buildEvidenceModel(g,cat).input.constraints.length,0);
  e.influence.demonOnly=true;assert.equal(buildEvidenceModel(g,cat).input.constraints.length,0);
  e.influence.stable=true;assert.equal(buildEvidenceModel(g,cat).input.constraints.length,0);
  e.influence.demonCapacityOptIn=true;const m=buildEvidenceModel(g,cat);assert.deepEqual(m.input.constraints[0].roleIds,['imp','shabaloth','po','vortox']);assert.ok(!m.input.constraints[0].roleIds.includes('newdemon'));assert.ok(m.skipped.length>0);assert.equal(m.model.nightDemonCapacityOptInRequired,true);assert.equal(m.audit.find(a=>a.kind==='night').demonCapacityApplied,true);
});
test('night 1 excludes only supported ordinary attack profiles under explicit assumptions',()=>{
  const g=make();g.events=[night(g,1,[g.players[0].id],true,true)];assert.deepEqual(buildEvidenceModel(g,cat).input.constraints[0].roleIds,['imp','shabaloth','po','vortox']);
});
test('zero deaths imply no lower-bound exclusions and duplicate nights are rejected',()=>{
  const g=make();g.events=[night(g,3,[],true,true)];assert.equal(buildEvidenceModel(g,cat).input.constraints.length,0);
  g.events.push(night(g,3,[],true));assert.throws(()=>buildEvidenceModel(g,cat),/Duplicate/);
});
test('multiple demons disable single-Demon capacity inference',()=>{
  const g=make();g.scenarios[0].counts={townsfolk:2,outsider:0,minion:1,demon:2};g.events=[night(g,2,g.players.slice(0,3).map(p=>p.id),true,true)];const m=buildEvidenceModel(g,cat);assert.equal(m.input.constraints.length,0);assert.equal(m.skipped[0].reason,'one-demon');
});
test('manual event presence weight does not treat a ballot as automatic alignment evidence',()=>{
  const g=make(),e=night(g,2,[g.players[0].id]);e.type='execution';e.phase='day';e.ballot=[{playerId:g.players[1].id,choice:'yes',weight:1}];g.events=[e];
  assert.equal(buildEvidenceModel(g,cat).input.factors.length,0);e.influence.roleIds=['poisoner'];e.influence.multiplier=2;
  assert.deepEqual(buildEvidenceModel(g,cat).input.factors[0],{id:'event-'+e.id,scope:'presence',roleIds:['poisoner'],match:2,miss:1});
});
test('claim mirror influence is skipped as duplicate while normal event influence applies',()=>{
  const g=make(),mirror=night(g,1,[]),info=night(g,1,[]);
  mirror.type='claim';mirror.phase='day';mirror.influence={roleIds:['poisoner'],multiplier:5,demonOnly:false,stable:false};
  info.type='info';info.phase='day';info.id=uid();info.influence={roleIds:['poisoner'],multiplier:2,demonOnly:false,stable:false};
  g.events=[mirror,info];
  const m=buildEvidenceModel(g,cat);
  assert.deepEqual(m.input.factors,[{id:'event-'+info.id,scope:'presence',roleIds:['poisoner'],match:2,miss:1}]);
  assert.ok(m.skipped.some(s=>s.id===mirror.id&&s.reason==='duplicate-claim'));
});
test('ballot unknown is distinct from no and known weights retained',()=>{
  assert.deepEqual(ballotSummary([{choice:'yes',weight:3},{choice:'no',weight:0},{choice:'unknown',weight:null}]),{yes:1,no:1,unknown:1,knownWeight:3});
  assert.equal(ballotSummary([{choice:'yes',weight:-1},{choice:'yes',weight:3}]).knownWeight,2);
  const g=make(),e=night(g,2,[]);e.type='vote';e.phase='day';e.ballot=[{playerId:g.players[0].id,choice:'no',weight:2}];g.events=[e];assert.throws(()=>validateGame(g));
  e.ballot=[{playerId:g.players[0].id,choice:'yes',weight:1},{playerId:g.players[0].id,choice:'no',weight:0}];assert.throws(()=>validateGame(g));
});
test('unknown custom IDs disable analysis and subjectively weighted claims retain safe schema',()=>{
  const g=make();g.script.roleIds.push('mystery');assert.throws(()=>buildEvidenceModel(g,cat),/Unknown/);
  const h=make();h.claims=[claim(h,1,99)];assert.throws(()=>validateGame(h));
});
test('incompatible characters refuse by exact id and name with exported reasons',()=>{
  for(const id of INCOMPATIBLE_ROLE_IDS){
    const role={id,team:'townsfolk',name:{fr:`FR ${id}`,en:`EN ${id}`},ability:{fr:'',en:''}};
    const g=newGame({name:'Bad',roleIds:[id],customRoles:[role],warnings:[]},['A','B','C','D','E']);
    assert.throws(()=>buildEvidenceModel(g,{roles:[]}),err=>err.message.includes(`EN ${id}`)&&err.message.includes('Incompatible')&&INCOMPATIBLE_ROLE_REASONS[id].length>0);
  }
});
test('clean script still computes after incompatibility guard',()=>{
  const m=buildEvidenceModel(make(),cat);
  assert.equal(m.input.players.length,5);
});
test('drunk and lunatic claim layers are added only for matching scripts and claims',()=>{
  const roles=[{id:'chef',team:'townsfolk'},{id:'drunk',team:'outsider'},{id:'lunatic',team:'outsider'},{id:'poisoner',team:'minion'},{id:'imp',team:'demon'}];
  const g=newGame({name:'Layered',roleIds:roles.map(r=>r.id),customRoles:[],warnings:[]},['A','B','C','D','E']);
  g.claims=[{...claim(g,1),roleIds:['chef']}];
  let m=buildEvidenceModel(g,{roles});
  assert.deepEqual(m.input.factors[0].roleIds,['chef','drunk']);
  assert.equal(m.audit[0].includesDrunk,true);
  g.claims=[{...claim(g,1),roleIds:['imp']}];
  m=buildEvidenceModel(g,{roles});
  assert.deepEqual(m.input.factors[0].roleIds,['imp','lunatic']);
  assert.equal(m.audit[0].includesLunatic,true);
  const noDrunk=newGame({name:'No drunk',roleIds:['chef','poisoner','imp'],customRoles:[],warnings:[]},['A','B','C','D','E']);
  noDrunk.claims=[{...claim(noDrunk,1),roleIds:['chef']}];
  m=buildEvidenceModel(noDrunk,{roles});
  assert.deepEqual(m.input.factors[0].roleIds,['chef']);
  assert.equal(m.audit[0].includesDrunk,false);
});
test('claim enrichment is disclosed, accurately audited, and can be disabled',()=>{
  const roles=[{id:'chef',team:'townsfolk'},{id:'drunk',team:'outsider'},{id:'lunatic',team:'outsider'},{id:'poisoner',team:'minion'},{id:'imp',team:'demon'}];
  const g=newGame({name:'Layered',roleIds:roles.map(r=>r.id),customRoles:[],warnings:[]},['A','B','C','D','E']);
  g.claims=[{...claim(g,1),roleIds:['chef']}];
  let m=buildEvidenceModel(g,{roles});
  assert.deepEqual(claimEnrichmentNotices(m.audit,'fr'),[CLAIM_ROLE_ENRICHMENT_NOTICES.drunk.fr]);
  assert.deepEqual(claimEnrichmentNotices(m.audit,'en'),[CLAIM_ROLE_ENRICHMENT_NOTICES.drunk.en]);
  m=buildEvidenceModel(g,{roles},{claimRoleEnrichment:false});
  assert.deepEqual(m.input.factors[0].roleIds,['chef']);
  assert.equal(m.audit[0].includesDrunk,false);
  assert.deepEqual(claimEnrichmentNotices(m.audit),[]);
  assert.equal(m.model.claimRoleEnrichment,false);
  g.claims=[{...claim(g,1),roleIds:['chef','drunk']}];
  assert.equal(buildEvidenceModel(g,{roles}).audit[0].includesDrunk,false);
});
test('a day 1 death prevents a Zombuul-caused death on night 2 under the opted-in assumptions',()=>{
  const roles=[...cat.roles,{id:'zombuul',team:'demon'}],g=make();
  g.script.roleIds.push('zombuul');
  const death=night(g,1,[g.players[0].id]);death.type='execution';death.phase='day';death.outcome='died';
  g.events=[death,night(g,2,[g.players[1].id],true,true)];
  const m=buildEvidenceModel(g,{roles});
  assert.ok(m.input.constraints.find(c=>c.roleIds.includes('zombuul')));
  assert.ok(m.audit.find(a=>a.kind==='night').tightenings.some(t=>t.reason==='zombuul-previous-day-death'&&t.to===0));
});
test('temporal demon caps tighten Po and Zombuul only with recorded support',()=>{
  const po=make();po.events=[night(po,2,po.players.slice(0,2).map(p=>p.id),true,true)];
  let m=buildEvidenceModel(po,cat);
  assert.ok(m.input.constraints[0].roleIds.includes('po'));
  assert.ok(m.audit[0].tightenings.some(t=>t.reason==='po-night-2'&&t.to===1));
  const day4=make();day4.events=[night(day4,4,day4.players.slice(0,2).map(p=>p.id),true,true)];
  m=buildEvidenceModel(day4,cat);
  assert.ok(!m.input.constraints[0]?.roleIds.includes('po'));
  day4.events.unshift(night(day4,3,[],true,true));
  m=buildEvidenceModel(day4,cat);
  assert.ok(!m.input.constraints.find(c=>c.id.startsWith('night-')&&c.roleIds.includes('po')));
  day4.events[0]=night(day4,3,[day4.players[0].id],true,true);
  m=buildEvidenceModel(day4,cat);
  assert.ok(m.input.constraints.find(c=>c.id.startsWith('night-')&&c.roleIds.includes('po')));
  const zroles=[...cat.roles,{id:'zombuul',team:'demon'}],z=make();
  z.script.roleIds.push('zombuul');
  const death=night(z,2,[z.players[0].id]);death.type='execution';death.phase='day';death.outcome='died';
  z.events=[death,night(z,3,[z.players[1].id],true,true)];
  m=buildEvidenceModel(z,{roles:zroles});
  assert.ok(m.input.constraints.find(c=>c.roleIds.includes('zombuul')));
  assert.ok(m.audit.find(a=>a.kind==='night').tightenings.some(t=>t.reason==='zombuul-previous-day-death'&&t.to===0));
});
test('three night deaths change Demon presence probabilities only when explicitly attributed',()=>{
  const g=make();g.script.roleIds=g.script.roleIds.filter(id=>id!=='newdemon');
  const before=estimate(buildEvidenceModel(g,cat).input,{timeMs:2000});
  assert.ok(Math.abs(before.presence.po-.25)<1e-10);
  g.events=[night(g,3,g.players.slice(0,3).map(p=>p.id),true,true)];
  const after=estimate(buildEvidenceModel(g,cat).input,{timeMs:2000});
  assert.equal(after.complete,true);assert.equal(after.presence.po,1);assert.equal(after.presence.shabaloth,0);
});
test('manual event likelihood affects Minion presence quantitatively, independently of voters',()=>{
  const catalogue={roles:[...cat.roles,{id:'scarletwoman',team:'minion'}]},g=make();g.script.roleIds.push('scarletwoman');
  const e=night(g,2,[]);e.type='execution';e.phase='day';e.playerIds=[g.players[0].id];e.influence.roleIds=['poisoner'];e.influence.multiplier=5;g.events=[e];
  const result=estimate(buildEvidenceModel(validateGame(g),catalogue).input,{timeMs:2000});
  assert.ok(Math.abs(result.presence.poisoner-5/6)<1e-10);assert.ok(Math.abs(result.presence.scarletwoman-1/6)<1e-10);
});
