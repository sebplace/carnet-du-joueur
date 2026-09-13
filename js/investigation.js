import {buildLastClaimIndex,constraintPeople} from './evidence.js';

function seatNeighboursOf(game,anchorId) {
  const seats=game.players.filter(p=>!p.traveller);
  const index=seats.findIndex(p=>p.id===anchorId);
  if(index<0||seats.length<3)return [];
  const pick=step=>{
    for(let i=1;i<seats.length;i++){
      const candidate=seats[(index+step*i+seats.length*seats.length)%seats.length];
      if(candidate.id!==anchorId&&candidate.alive)return candidate.id;
    }
    return '';
  };
  return [pick(-1),pick(1)].filter(Boolean);
}

export function describeRelation(c,playerName,roleName,lang='fr') {
  const roles=c.roleIds.map(roleName).join(' / ');
  if(c.kind==='neighbours'){
    const who=playerName(c.anchor);
    if(lang==='en')return `Among ${who}'s two living neighbours, ${c.min===c.max?`exactly ${c.min}`:`between ${c.min} and ${c.max}`} initially had ${roles}.`;
    const n=c.min===c.max?(c.min===0?'aucun n’avait':c.min===1?'un seul avait':`exactement ${c.min} avaient`):`entre ${c.min} et ${c.max} avaient`;
    return `Parmi les deux voisins vivants de ${who}, ${n} au départ ${roles}.`;
  }
  const people=c.players.map(playerName).join(', ');
  if(lang==='en')return `Among ${people}, ${c.min===c.max?`exactly ${c.min}`:`between ${c.min} and ${c.max}`} initially had ${roles}.`;
  const quantity=c.min===c.max?(c.min===0?'personne n’avait':c.min===1?'une seule personne avait':`exactement ${c.min} personnes avaient`):`entre ${c.min} et ${c.max} personnes avaient`;
  return `Parmi ${people}, ${quantity} au départ ${roles}.`;
}
export function buildInvestigation(game) {
  const current=new Set(game.players.map(p=>p.id));
  const people=[...game.players,...(game.archivedPlayers||[])].map(p=>({...p,archived:!current.has(p.id)}));
  const peopleIds=new Set(people.map(p=>p.id));
  const records=[];
  const edges=[];
  const latestClaims=buildLastClaimIndex(game);
  function connect(record,sourceIds,targetIds) {
    for(const id of new Set(sourceIds))if(peopleIds.has(id))edges.push({from:'player:'+id,to:record.id,kind:'source'});
    for(const id of new Set(targetIds))if(peopleIds.has(id)&&!sourceIds.includes(id))edges.push({from:'player:'+id,to:record.id,kind:'subject'});
    if(record.impact==='weight'||record.impact==='strict'||record.impact==='conditional')edges.push({from:record.id,to:'model',kind:record.impact});
  }
  for(const c of game.claims) {
    const latest=latestClaims.get(c.playerId)?.id===c.id;
    const usable=current.has(c.playerId)&&!game.players.find(p=>p.id===c.playerId)?.traveller;
    const record={id:'claim:'+c.id,ref:c.id,type:'claim',day:c.day,phase:c.phase,people:[...new Set([c.playerId,c.sourceId].filter(Boolean))],roleIds:c.roleIds,text:c.note,impact:latest&&usable&&c.weight>1?'weight':'neutral',multiplier:c.weight||1,latest,archived:!usable};
    records.push(record);connect(record,[c.sourceId||c.playerId],[c.playerId]);
  }
  for(const e of game.events) {
    if(e.type==='claim')continue;
    const voters=(e.ballot||[]).filter(v=>v.choice!=='unknown').map(v=>v.playerId);
    const ids=[...new Set([e.sourceId,...e.playerIds,...voters].filter(Boolean))];
    const weighted=e.influence?.multiplier>1&&e.influence.roleIds.length>0;
    const conditional=e.type==='night'&&e.influence?.demonOnly&&e.influence.stable;
    const record={id:'event:'+e.id,ref:e.id,type:e.type,day:e.day,phase:e.phase,people:ids,roleIds:[...new Set([e.roleId,...(e.influence?.roleIds||[])].filter(Boolean))],text:e.text,impact:weighted?'weight':conditional?'conditional':'neutral',multiplier:e.influence?.multiplier||1,conditional,archived:false};
    records.push(record);connect(record,[e.sourceId].filter(Boolean),[...e.playerIds,...voters]);
  }
  const scenario=game.scenarios.find(s=>s.id===game.activeScenario);
  for(const p of game.players){
    const roleIds=scenario.domains[p.id];
    if(p.traveller||!roleIds?.length)continue;
    const relation={id:'domain:'+p.id,players:[p.id],roleIds,min:1,max:1,note:'',enabled:true};
    const record={id:'domain:'+p.id,ref:p.id,type:'restriction',day:null,phase:null,people:[p.id],roleIds,text:'',impact:'strict',relation,domain:true,archived:false};
    records.push(record);connect(record,[],[p.id]);
  }
  for(const c of scenario.constraints){
    const people=constraintPeople(c);
    const record={id:'relation:'+c.id,ref:c.id,type:'hypothesis',day:null,phase:null,people,roleIds:c.roleIds,text:c.note,impact:c.enabled?'strict':'neutral',relation:c,archived:false};
    records.push(record);connect(record,[],people);
  }
  records.sort((a,b)=>(b.day??1000)-(a.day??1000)||(b.phase==='day'?1:0)-(a.phase==='day'?1:0));
  return {people,records,edges};
}
export function buildRelations(game) {
  const current=new Set(game.players.map(p=>p.id));
  const nodes=[...game.players,...(game.archivedPlayers||[])].map((p,i)=>({
    id:p.id,name:p.name,seat:current.has(p.id)?game.players.findIndex(x=>x.id===p.id)+1:i+1,
    alive:p.alive,traveller:p.traveller,archived:!current.has(p.id),trust:p.trust
  }));
  const peopleIds=new Set(nodes.map(p=>p.id));
  const latestClaims=buildLastClaimIndex(game);
  const links=new Map();
  const add=(from,to,kind,ref,label)=>{
    if(!from||!to||from===to||!peopleIds.has(from)||!peopleIds.has(to))return;
    const key=`${from}\0${to}\0${kind}\0${label||''}`;
    const link=links.get(key)||{from,to,kind,weight:0,refs:[],label:label||kind};
    link.weight++;
    if(ref&&!link.refs.includes(ref))link.refs.push(ref);
    links.set(key,link);
  };
  for(const c of game.claims){
    add(c.sourceId||c.playerId,c.playerId,'told',`claim:${c.id}`,'told');
  }
  for(const e of game.events){
    const ref=`event:${e.id}`;
    if(e.sourceId)for(const target of e.playerIds)add(e.sourceId,target,e.type==='execution'?'nominated':'told',ref,e.type==='execution'?'nominated':'told');
    if(e.type==='execution'||e.type==='vote'){
      for(const v of e.ballot||[])if(v.choice==='yes')for(const target of e.playerIds)add(v.playerId,target,'voted',ref,'voted yes');
    }
  }
  const latest=[...latestClaims.values()];
  for(let i=0;i<latest.length;i++)for(let j=i+1;j<latest.length;j++){
    const a=latest[i],b=latest[j];
    if(a.playerId===b.playerId)continue;
    const shared=a.roleIds.filter(id=>b.roleIds.includes(id));
    if(shared.length){
      add(a.playerId,b.playerId,'conflict',`claim:${a.id}|claim:${b.id}`,shared.join(' / '));
      add(b.playerId,a.playerId,'conflict',`claim:${a.id}|claim:${b.id}`,shared.join(' / '));
    }
  }
  const scenario=game.scenarios.find(s=>s.id===game.activeScenario);
  for(const c of scenario?.constraints||[]){
    if(!c.enabled)continue;
    const people=c.kind==='neighbours'?seatNeighboursOf(game,c.anchor).concat(c.anchor?[c.anchor]:[]):c.players;
    for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++){
      add(people[i],people[j],'paired',`relation:${c.id}`,c.note||'paired');
      add(people[j],people[i],'paired',`relation:${c.id}`,c.note||'paired');
    }
  }
  return {nodes,links:[...links.values()]};
}
export function selectRecords(graph,{person='',phase='',query='',type='all',playerName=id=>id,roleName=id=>id}={}) {
  const fold=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const q=fold(query);
  return graph.records.filter(r=>(!person||r.people.includes(person))&&(!phase||`${r.phase}:${r.day}`===phase)&&(type==='all'||r.type===type)&&fold(`${r.text} ${r.people.map(playerName).join(' ')} ${r.roleIds.join(' ')} ${r.roleIds.map(roleName).join(' ')}`).includes(q));
}
