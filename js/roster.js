import {normalCounts,validateGame} from './state.js';
import {constraintPeople} from './evidence.js';

export function rosterImpact(game,rows) {
  const ids=new Set(rows.map(p=>p.id));
  if(ids.size!==rows.length)throw new Error('Siège dupliqué / Duplicate seat');
  const active=new Map(game.players.map(p=>[p.id,p]));
  const historical=new Set((game.archivedPlayers||[]).map(p=>p.id));
  const removed=game.players.filter(p=>!ids.has(p.id));
  const added=rows.filter(p=>!active.has(p.id));
  const changedType=rows.filter(p=>active.has(p.id)&&active.get(p.id).traveller!==p.traveller);
  const excluded=new Set([...removed.map(p=>p.id),...rows.filter(p=>p.traveller).map(p=>p.id)]);
  const affected=game.scenarios.reduce((sum,s)=>sum+s.constraints.filter(c=>c.enabled&&constraintPeople(c).some(id=>excluded.has(id))).length,0);
  return {removed,added,restored:added.filter(p=>historical.has(p.id)),changedType,affected,membershipChanged:!!(removed.length||added.length||changedType.length)};
}
export function applyRoster(game,rows) {
  if(rows.length<5||rows.length>20)throw new Error('Conserve 5 à 20 sièges actifs / Keep 5 to 20 active seats');
  const normal=rows.filter(p=>!p.traveller).length;
  if(normal<5||normal>15)throw new Error('Il faut 5 à 15 non-Voyageurs ; les autres sièges sont des Voyageurs / Use 5 to 15 non-Travellers');
  const impact=rosterImpact(game,rows);
  const next=structuredClone(game);
  const records=new Map([...next.players,...(next.archivedPlayers||[])].map(p=>[p.id,p]));
  next.players=rows.map(row=>{
    const prior=records.get(row.id);
    return {...(prior||{id:row.id,alive:true,ghost:true,trust:'unknown'}),name:row.name.trim(),traveller:row.traveller};
  });
  const active=new Set(next.players.map(p=>p.id));
  next.archivedPlayers=[...(next.archivedPlayers||[]),...impact.removed].filter(p=>!active.has(p.id));
  if(next.myId&&!active.has(next.myId)){next.archivedSelf={playerId:next.myId,myRole:next.myRole};next.myId='';next.myRole='';}
  if(next.archivedSelf&&active.has(next.archivedSelf.playerId)){next.myId=next.archivedSelf.playerId;next.myRole=next.archivedSelf.myRole;next.archivedSelf=null;}
  if(impact.membershipChanged) {
    next.rosterReviewRequired=true;
    next.estimateConsent=false;
    const normalIds=new Set(next.players.filter(p=>!p.traveller).map(p=>p.id));
    for(const s of next.scenarios){
      s.counts=normalCounts(normal);
      for(const c of s.constraints)if(constraintPeople(c).some(id=>!normalIds.has(id)))c.enabled=false;
    }
  }
  return validateGame(next);
}
