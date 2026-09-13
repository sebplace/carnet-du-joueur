export const STORAGE_KEY = 'botc-player-notebook-v1';
export const BACKUP_KEY = 'botc-player-notebook-backup-v1';
export const BACKUP_KEYS = [BACKUP_KEY, 'botc-player-notebook-backup-v2', 'botc-player-notebook-backup-v3'];
export const SCHEMA_VERSION = 5;
export const LIMITS = Object.freeze({players:20, archived:60, claims:1000, events:2000, scenarios:8, save:8_000_000});
export const TEAMS = ['townsfolk', 'outsider', 'minion', 'demon'];
export const uid = () => crypto.randomUUID();
import {validateSelfLog, validateRetained} from './mynotes.js';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function fail(message) { throw new Error(message); }
function object(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function text(v, max = 2000) {
  if (typeof v !== 'string' || v.normalize('NFC').length > max) fail('Texte invalide / Invalid text');
  return v;
}
function name(v,max) {
  const result=text(v,max);
  if(!result.trim())fail('Nom vide / Empty name');
  return result;
}
function id(v) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v) || forbidden.has(v)) fail('Identifiant invalide / Invalid ID');
  return v;
}
function integer(v, min, max) {
  if (!Number.isInteger(v) || v < min || v > max) fail('Nombre invalide / Invalid number');
  return v;
}
function list(v, max) {
  if (!Array.isArray(v) || v.length > max) fail('Liste invalide / Invalid list');
  return v;
}
function choice(v, choices) {
  if (!choices.includes(v)) fail('Valeur invalide / Invalid value');
  return v;
}
function bool(v) { if (typeof v !== 'boolean') fail('Booléen invalide / Invalid boolean'); return v; }
function unique(v) { if (new Set(v).size !== v.length) fail('Doublon / Duplicate'); return v; }
export function normalCounts(n) {
  const table = {5:[3,0,1,1],6:[3,1,1,1],7:[5,0,1,1],8:[5,1,1,1],9:[5,2,1,1],10:[7,0,2,1],11:[7,1,2,1],12:[7,2,2,1],13:[9,0,3,1],14:[9,1,3,1],15:[9,2,3,1]};
  if (!table[n]) fail('5 à 15 non-Voyageurs requis / 5 to 15 non-Travellers required');
  return Object.fromEntries(TEAMS.map((t, i) => [t, table[n][i]]));
}
export function newScenario(name, n) {
  return {id:uid(),name,counts:normalCounts(n),domains:{},constraints:[],notes:''};
}
export function newGame(script, names, title = 'Ma partie') {
  if (names.length < 5 || names.length > 20) fail('5 à 20 joueurs / 5 to 20 players');
  const players = names.map((name, i) => ({id:uid(),name:name.trim() || `#${i+1}`,alive:true,ghost:true,traveller:i>=15,trust:'unknown'}));
  const scenario = newScenario('Hypothèse A', Math.min(15, players.length));
  return {version:SCHEMA_VERSION,id:uid(),title,script:structuredClone(script),players,archivedPlayers:[],rosterReviewRequired:false,day:1,phase:'day',claims:[],events:[],scenarios:[scenario],activeScenario:scenario.id,myId:players[0].id,myRole:'',createdAt:new Date().toISOString(),estimateConsent:false,settings:{showEstimates:false,captureMode:true,claimRoleEnrichment:true,unlocked:false},selfLog:[],retained:[]};
}
export function validateGame(raw) {
  if (!object(raw) || ![1,2,3,4,5].includes(raw.version)) fail('Format Carnet du Joueur non reconnu / Unrecognized player notebook format');
  const normalizePlayer=p=>{
    if (!object(p)) fail('Joueur invalide / Invalid player');
    return {id:id(p.id),name:name(p.name,60),alive:bool(p.alive),ghost:bool(p.ghost),traveller:bool(p.traveller),trust:choice(p.trust,['unknown','trusted','watch','suspect'])};
  };
  const players = list(raw.players,LIMITS.players).map(normalizePlayer);
  const archivedPlayers=list(raw.archivedPlayers??[],LIMITS.archived).map(normalizePlayer);
  const archivedIds=new Set(archivedPlayers.map(p=>p.id));
  if (players.length < 5) fail('5 joueurs minimum / Minimum 5 players');
  const pids = new Set(unique([...players,...archivedPlayers].map(p => p.id)));
  const pid = v => { if (!pids.has(v)) fail('Joueur absent / Missing player'); return v; };
  const optionalPid = v => v === '' ? '' : pid(v);
  if (!object(raw.script)) fail('Script invalide / Invalid script');
  const script = {name:text(raw.script.name,120),roleIds:unique(list(raw.script.roleIds,200).map(id)),customRoles:list(raw.script.customRoles ?? [],200).map(r => {
    if (!object(r) || !object(r.name) || !object(r.ability)) fail('Rôle invalide / Invalid role');
    return {id:id(r.id),name:{fr:text(r.name.fr,100),en:text(r.name.en,100)},team:choice(r.team,[...TEAMS,'traveller','fabled','unknown']),ability:{fr:text(r.ability.fr,4000),en:text(r.ability.en,4000)}};
  }),warnings:list(raw.script.warnings ?? [],200).map(v=>text(v,500))};
  unique(script.customRoles.map(r=>r.id));
  if (!script.roleIds.length || script.customRoles.some(r=>!script.roleIds.includes(r.id))) fail('Liste de rôles incohérente / Inconsistent roles');
  const rid = v => { id(v); if (!script.roleIds.includes(v)) fail('Rôle absent du script / Role not on script'); return v; };
  const time = v => ({day:integer(v.day,1,99),phase:choice(v.phase,['day','night'])});
  const claims = list(raw.claims,LIMITS.claims).map(c => ({
    id:id(c.id),playerId:pid(c.playerId),roleIds:unique(list(c.roleIds,10).map(rid)),sourceId:optionalPid(c.sourceId),
    visibility:choice(c.visibility,['private','public']),note:text(c.note),weight:choice(c.weight??1,[1,2,5,20]),...time(c)
  }));
  if (claims.some(c=>!c.roleIds.length)) fail('Déclaration sans rôle / Empty claim');
  unique(claims.map(c=>c.id));
  const events = list(raw.events,LIMITS.events).map(e=>{
    const ballot=list(e.ballot??[],20).map(v=>({playerId:pid(v.playerId),choice:choice(v.choice,['yes','no','unknown']),weight:v.choice==='unknown'?null:integer(v.weight,v.choice==='yes'?-9:0,9)}));
    unique(ballot.map(v=>v.playerId));
    if(ballot.some(v=>v.choice==='no'&&v.weight!==0))fail('Un non ne porte pas de voix / No vote must have zero weight');
    const influence=e.influence??{roleIds:[],multiplier:1,demonOnly:false,stable:false};
    if(!object(influence))fail('Influence invalide / Invalid influence');
    return {
    id:id(e.id),type:choice(e.type,['note','info','death','revival','execution','vote','phase','claim','night']),
    text:text(e.text,4000),playerIds:unique(list(e.playerIds,20).map(pid)),sourceId:optionalPid(e.sourceId),
    roleId:e.roleId ? rid(e.roleId) : '',value:text(e.value ?? '',100),...time(e),
    aliveSnapshot:unique(list(e.aliveSnapshot ?? [],20).map(pid)),ballot,
    outcome:choice(e.outcome??'unknown',['unknown','survived','died']),
    complete:bool(e.complete??false),demonCapacityOptIn:bool(e.demonCapacityOptIn??influence.demonCapacityOptIn??false),
    influence:{roleIds:unique(list(influence.roleIds,200).map(rid)),multiplier:choice(influence.multiplier,[1,2,5,20]),demonOnly:bool(influence.demonOnly),stable:bool(influence.stable),demonCapacityOptIn:bool(influence.demonCapacityOptIn??e.demonCapacityOptIn??false)}
  };});
  if(events.some(e=>e.type==='night'&&e.phase!=='night'))fail('Un bilan de nuit doit être daté la nuit / Night summary requires night phase');
  unique(events.map(e=>e.id));
  const scenarios = list(raw.scenarios,LIMITS.scenarios).map(s => {
    if (!object(s) || !object(s.counts) || !object(s.domains)) fail('Hypothèse invalide / Invalid hypothesis');
    const counts = Object.fromEntries(TEAMS.map(t=>[t,integer(s.counts[t],0,20)]));
    const domains = {};
    for (const [p,roles] of Object.entries(s.domains)) domains[pid(p)] = unique(list(roles,200).map(rid));
    const constraints = list(s.constraints,40).map(c=>({
      id:id(c.id),kind:choice(c.kind??'group',['group','neighbours']),
      players:unique(list(c.players,20).map(pid)),roleIds:unique(list(c.roleIds,200).map(rid)),
      anchor:c.anchor ? pid(c.anchor) : '',
      min:integer(c.min,0,20),max:integer(c.max,0,20),note:text(c.note,500),enabled:bool(c.enabled),
      provenance:choice(c.provenance??'hunch',['hunch','claim','ability','public','deduction']),
      fragile:bool(c.fragile??false)
    }));
    unique(constraints.map(c=>c.id));
    if (constraints.some(c=>!c.roleIds.length || c.min>c.max)) fail('Contrainte invalide / Invalid constraint');
    if (constraints.some(c=>c.kind==='group'&&(!c.players.length||c.max>c.players.length))) fail('Contrainte invalide / Invalid constraint');
    if (constraints.some(c=>c.kind==='neighbours'&&(!c.anchor||c.players.length||c.max>2))) fail('Voisinage invalide / Invalid neighbourhood');
    return {id:id(s.id),name:name(s.name,80),counts,domains,constraints,notes:text(s.notes,4000)};
  });
  if (!scenarios.length) fail('Hypothèse manquante / Missing hypothesis');
  const sids = unique(scenarios.map(s=>s.id));
  if (!sids.includes(raw.activeScenario)) fail('Hypothèse active absente / Missing active hypothesis');
  let archivedSelf = null;
  if (raw.archivedSelf != null) {
    if (!object(raw.archivedSelf)) fail('Identité archivée invalide / Invalid archived identity');
    const selfId = id(raw.archivedSelf.playerId);
    if (!archivedIds.has(selfId)) fail('Identité archivée invalide / Invalid archived identity');
    archivedSelf = {playerId:selfId,myRole:raw.archivedSelf.myRole ? rid(raw.archivedSelf.myRole) : ''};
  }
  return {version:SCHEMA_VERSION,id:id(raw.id),title:name(raw.title,120),script,players,archivedPlayers,rosterReviewRequired:bool(raw.rosterReviewRequired??false),...time(raw),claims,events,scenarios,activeScenario:raw.activeScenario,myId:optionalPid(raw.myId),myRole:raw.myRole ? rid(raw.myRole) : '',createdAt:text(raw.createdAt,40),estimateConsent:bool(raw.estimateConsent??false),
    settings:{showEstimates:bool(raw.settings?.showEstimates??false),captureMode:bool(raw.settings?.captureMode??true),claimRoleEnrichment:bool(raw.settings?.claimRoleEnrichment??true),unlocked:bool(raw.settings?.unlocked??false)},
    selfLog:validateSelfLog(raw.selfLog??[],{playerIds:pids,roleIds:new Set(script.roleIds)}),
    retained:validateRetained(raw.retained??[],{roleIds:new Set(script.roleIds)}),...(archivedSelf ? {archivedSelf} : {})};
}
export function parseSave(textValue) {
  if (typeof textValue !== 'string' || textValue.length>LIMITS.save) fail('Sauvegarde trop volumineuse / Save too large');
  return validateGame(JSON.parse(textValue));
}
export function createStorage(storage) {
  let baseline;
  const rotate = current => {
    if (!current) return;
    for (let i = BACKUP_KEYS.length - 1; i > 0; i--) {
      const previous = storage.getItem(BACKUP_KEYS[i - 1]);
      if (previous !== null) storage.setItem(BACKUP_KEYS[i], previous);
    }
    storage.setItem(BACKUP_KEYS[0], current);
  };
  return {
    load() {
      const raw = storage.getItem(STORAGE_KEY);
      baseline = raw;
      return raw ? parseSave(raw) : null;
    },
    save(game, {backup = false} = {}) {
      const clean = validateGame(game);
      const next = JSON.stringify(clean);
      if (next.length > LIMITS.save) fail('Sauvegarde trop volumineuse / Save too large');
      const current = storage.getItem(STORAGE_KEY);
      if (baseline === undefined || current !== baseline) fail('Une autre fenêtre a modifié la partie. Rechargez avant de continuer. / Another window changed this game. Reload first.');
      const rotateBackup = backup && current && current !== storage.getItem(BACKUP_KEYS[0]);
      const previous = rotateBackup ? BACKUP_KEYS.map(key => storage.getItem(key)) : null;
      storage.setItem(STORAGE_KEY,next);
      baseline = next;
      if (rotateBackup) {
        try {
          rotate(current);
        } catch (error) {
          previous.forEach((value, i) => { if (value === null) storage.removeItem(BACKUP_KEYS[i]); else storage.setItem(BACKUP_KEYS[i], value); });
          throw error;
        }
      }
      return clean;
    },
    backups() {
      return BACKUP_KEYS.map((key, index) => {
        const value = storage.getItem(key);
        if (!value) return null;
        try {
          const parsed = JSON.parse(value);
          return {slot:index, key, title:typeof parsed?.title === 'string' ? parsed.title : '', createdAt:typeof parsed?.createdAt === 'string' ? parsed.createdAt : '', players:Array.isArray(parsed?.players) ? parsed.players.length : 0, bytes:value.length};
        } catch { return {slot:index, key, title:'', createdAt:'', players:0, bytes:value.length, unreadable:true}; }
      }).filter(Boolean);
    },
    backup(slot = 0) {
      const value = storage.getItem(BACKUP_KEYS[slot] ?? '');
      if (!value) fail('Aucune sauvegarde précédente / No previous backup');
      return parseSave(value);
    },
    usage() {
      const game = (storage.getItem(STORAGE_KEY) ?? '').length;
      const backups = BACKUP_KEYS.reduce((sum,key)=>sum+(storage.getItem(key) ?? '').length, 0);
      return {game, backups, total:game+backups, limit:LIMITS.save};
    }
  };
}
