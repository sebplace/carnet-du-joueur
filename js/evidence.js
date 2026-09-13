const NORMAL=new Set(['townsfolk','outsider','minion','demon']);
// Bounds on ordinary Demon-caused night deaths, not a full ability simulator.
export const DEMON_CAPACITY=Object.freeze({imp:1,fanggu:1,vigormortis:1,nodashii:1,vortox:1,zombuul:1,pukka:1,shabaloth:2,po:3});
export const CLAIM_ROLE_ENRICHMENT_NOTICES=Object.freeze({
  drunk:Object.freeze({
    fr:'L’Ivrogne est aussi renforcé avec le même multiplicateur, parce qu’un Ivrogne se croit villageois.',
    en:'The Drunk is also weighted with the same multiplier, because a Drunk believes they are a Townsfolk character.'
  }),
  lunatic:Object.freeze({
    fr:'Le Lunatique est aussi renforcé avec le même multiplicateur, parce qu’un Lunatique se croit Démon.',
    en:'The Lunatic is also weighted with the same multiplier, because a Lunatic believes they are the Demon.'
  })
});
const SHARED_TOKEN_REASON='This character breaks the calculator’s normal one-character-per-player setup/death assumptions.';
export const INCOMPATIBLE_ROLE_REASONS=Object.freeze({
  legion:'Legion means most players share one character.',
  lilmonsta:"Lil' Monsta means no player is the Demon.",
  lil_monsta:"Lil' Monsta means no player is the Demon.",
  marionette:'Marionette is a Minion holding a good token.',
  atheist:'Atheist means there are no evil players and the Storyteller may break rules.',
  villageidiot:'Village Idiot allows up to three copies of the same character.',
  village_idiot:'Village Idiot allows up to three copies of the same character.',
  riot:SHARED_TOKEN_REASON,
  leviathan:SHARED_TOKEN_REASON,
  alhadikhia:SHARED_TOKEN_REASON,
  al_hadikhia:SHARED_TOKEN_REASON,
  lleech:SHARED_TOKEN_REASON,
  boomdandy:SHARED_TOKEN_REASON,
  summoner:SHARED_TOKEN_REASON,
  kazali:SHARED_TOKEN_REASON,
  actor:SHARED_TOKEN_REASON,
  lordoftyphon:SHARED_TOKEN_REASON,
  ojo:SHARED_TOKEN_REASON,
  vizier:SHARED_TOKEN_REASON
});
export const INCOMPATIBLE_ROLE_IDS=Object.freeze(Object.keys(INCOMPATIBLE_ROLE_REASONS));
const INCOMPATIBLE=new Set(INCOMPATIBLE_ROLE_IDS);
function roleLabel(role) {
  const n=role?.name;
  if(n&&typeof n==='object')return n.en||n.fr||role.id;
  return typeof n==='string'?n:role?.id;
}
function compareClaims(a,b) {
  return a.c.day-b.c.day||(a.c.phase==='day'?1:0)-(b.c.phase==='day'?1:0)||a.index-b.index;
}
export function constraintPeople(c) {
  return c.kind==='neighbours' ? (c.anchor?[c.anchor]:[]) : (c.players||[]);
}
export function toEngineConstraint(c,{deadIds=[]}={}) {
  if(c.kind==='neighbours')return {id:c.id,type:'player-neighbours',playerId:c.anchor,roleIds:c.roleIds,min:c.min,max:c.max,skipPlayers:deadIds};
  return {id:c.id,players:c.players,roleIds:c.roleIds,min:c.min,max:c.max};
}
export function buildLastClaimIndex(game) {
  const latest=new Map();
  game.claims.forEach((c,index)=>{
    const prior=latest.get(c.playerId);
    if(!prior||compareClaims(prior,{c,index})<0)latest.set(c.playerId,{c,index});
  });
  return new Map([...latest].map(([id,{c}])=>[id,c]));
}
export function lastClaim(game,playerId) {
  return buildLastClaimIndex(game).get(playerId);
}
export function claimEnrichmentNotices(audit,language='fr') {
  const selectedLanguage=language==='en'?'en':'fr';
  return ['drunk','lunatic']
    .filter(roleId=>audit.some(entry=>entry.kind==='claim'&&entry[roleId==='drunk'?'includesDrunk':'includesLunatic']))
    .map(roleId=>CLAIM_ROLE_ENRICHMENT_NOTICES[roleId][selectedLanguage]);
}
export function buildEvidenceModel(game,catalogue,{claimRoleEnrichment=true}={}) {
  if(game.rosterReviewRequired)throw new Error('Liste modifiée : confirme la composition initiale avant de calculer / Roster changed: review starting composition before calculating');
  const known=new Map(catalogue.roles.map(r=>[r.id,r]));
  for(const r of game.script.customRoles)if(!known.has(r.id))known.set(r.id,r);
  const all=game.script.roleIds.map(id=>known.get(id)||{id,team:'unknown'});
  const bad=all.find(r=>INCOMPATIBLE.has(r.id));
  if(bad)throw new Error(`Modèle incompatible avec ${roleLabel(bad)} : calcul désactivé. / Incompatible model for ${roleLabel(bad)}: calculation disabled. ${INCOMPATIBLE_ROLE_REASONS[bad.id]}`);
  if(all.some(r=>r.team==='unknown'))throw new Error('Rôles inconnus : calcul désactivé / Unknown characters: calculation disabled');
  const roles=all.filter(r=>NORMAL.has(r.team)),rids=new Set(roles.map(r=>r.id));
  const byRole=new Map(roles.map(r=>[r.id,r]));
  const players=game.players.filter(p=>!p.traveller),pids=new Set(players.map(p=>p.id));
  const s=game.scenarios.find(s=>s.id===game.activeScenario);
  const factors=[],audit=[],skipped=[];
  const deadIds=game.players.filter(p=>!p.alive).map(p=>p.id);
  const constraints=s.constraints.filter(c=>c.enabled).map(c=>toEngineConstraint(c,{deadIds:deadIds.filter(id=>pids.has(id))}));
  const latestClaims=buildLastClaimIndex(game);
  const enrichClaimRoles=roleIds=>{
    const set=new Set(roleIds);
    const includesDrunk=claimRoleEnrichment&&!set.has('drunk')&&rids.has('drunk')&&roleIds.some(id=>byRole.get(id)?.team==='townsfolk');
    const includesLunatic=claimRoleEnrichment&&!set.has('lunatic')&&rids.has('lunatic')&&roleIds.some(id=>byRole.get(id)?.team==='demon');
    if(includesDrunk)set.add('drunk');
    if(includesLunatic)set.add('lunatic');
    return {roleIds:[...set],includesDrunk,includesLunatic};
  };
  for(const p of players){
    const c=latestClaims.get(p.id);
    if(!c||!(c.weight>1))continue;
    if(c.roleIds.some(id=>!rids.has(id))){skipped.push({kind:'claim',id:c.id,reason:'unsupported'});continue;}
    const enriched=enrichClaimRoles(c.roleIds);
    factors.push({id:'claim-'+c.id,scope:'player',playerId:p.id,roleIds:enriched.roleIds,match:c.weight,miss:1});
    audit.push({kind:'claim',id:c.id,playerId:p.id,roleIds:enriched.roleIds,multiplier:c.weight,includesDrunk:enriched.includesDrunk,includesLunatic:enriched.includesLunatic});
  }
  const nights=new Map();
  const dayDeaths=new Set();
  for(const e of game.events){
    const impact=e.influence;
    if(impact?.multiplier>1&&impact.roleIds.length){
      if(e.type==='claim'){skipped.push({kind:'event',id:e.id,reason:'duplicate-claim'});}
      else if(impact.roleIds.some(id=>!rids.has(id))){skipped.push({kind:'event',id:e.id,reason:'unsupported'});}
      else{
        factors.push({id:'event-'+e.id,scope:'presence',roleIds:impact.roleIds,match:impact.multiplier,miss:1});
        audit.push({kind:'event',id:e.id,roleIds:impact.roleIds,multiplier:impact.multiplier});
      }
    }
    if(e.phase==='day'&&(e.type==='death'||(e.type==='execution'&&e.outcome==='died')))dayDeaths.add(e.day);
    if(e.type==='night') {
      if(nights.has(e.day))throw new Error('Deux bilans pour la même nuit : corrige le carnet / Duplicate night summaries');
      nights.set(e.day,e);
    }
  }
  function capFor(roleId,day) {
    const base=day===1?0:DEMON_CAPACITY[roleId],tightenings=[];
    let cap=base;
    if(roleId==='po') {
      if(day===2){cap=1;tightenings.push({roleId,from:base,to:cap,reason:'po-night-2'});}
      else if(day>2&&nights.has(day-1)&&nights.get(day-1).playerIds.length>0){cap=1;tightenings.push({roleId,from:base,to:cap,reason:'po-prior-night-deaths'});}
    }
    if(roleId==='zombuul'&&day>1&&dayDeaths.has(day-1)){cap=0;tightenings.push({roleId,from:base,to:cap,reason:'zombuul-previous-day-death'});}
    return {cap,tightenings:tightenings.filter(t=>t.from!==t.to)};
  }
  for(const e of nights.values()){
    if(!e.influence?.demonOnly||!e.influence.stable){
      audit.push({kind:'night',id:e.id,day:e.day,count:e.playerIds.length,roleIds:[],tightenings:[],demonCapacityOptInRequired:true,demonCapacityApplied:false});
      continue;
    }
    if(e.demonCapacityOptIn!==true&&e.influence.demonCapacityOptIn!==true){
      audit.push({kind:'night',id:e.id,day:e.day,count:e.playerIds.length,roleIds:[],tightenings:[],demonCapacityOptInRequired:true,demonCapacityApplied:false});
      continue;
    }
    if(s.counts.demon!==1){skipped.push({kind:'night',id:e.id,reason:'one-demon'});continue;}
    const n=e.playerIds.length;
    const tightenings=[];
    const excluded=roles.filter(r=>{
      if(r.team!=='demon'||!Object.hasOwn(DEMON_CAPACITY,r.id))return false;
      const c=capFor(r.id,e.day);
      tightenings.push(...c.tightenings);
      return n>c.cap;
    }).map(r=>r.id);
    if(excluded.length)constraints.push({id:'night-'+e.id,players:players.map(p=>p.id),roleIds:excluded,min:0,max:0});
    audit.push({kind:'night',id:e.id,day:e.day,count:n,roleIds:excluded,tightenings,demonCapacityOptInRequired:true,demonCapacityApplied:true});
    const unsupported=roles.filter(r=>r.team==='demon'&&!Object.hasOwn(DEMON_CAPACITY,r.id)).map(r=>r.id);
    if(unsupported.length)skipped.push({kind:'night',id:e.id,reason:'unsupported',roleIds:unsupported});
  }
  if(factors.length>100)throw new Error('Trop de pondérations actives (100 maximum). Neutralise les indices corrélés. / Too many active weights (100 maximum). Neutralize correlated clues.');
  if(constraints.some(c=>(c.players??[]).some(id=>!pids.has(id))||(c.playerId&&!pids.has(c.playerId))))throw new Error('Relation avec un Voyageur : désactive-la / Relationship includes a Traveller: disable it');
  return {input:{players:players.map(p=>({id:p.id,candidates:s.domains[p.id]||[]})),roles:roles.map(({id,team})=>({id,team})),counts:s.counts,constraints,factors},audit,skipped,model:{nightDemonCapacityOptInRequired:true,claimRoleEnrichment}};
}
export function ballotSummary(ballot) {
  return {yes:ballot.filter(v=>v.choice==='yes').length,no:ballot.filter(v=>v.choice==='no').length,unknown:ballot.filter(v=>v.choice==='unknown').length,knownWeight:ballot.reduce((sum,v)=>sum+(v.choice==='yes'?v.weight:0),0)};
}
