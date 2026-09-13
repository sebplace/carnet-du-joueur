export const PUBLIC_AUDIENCE = 'public';
export const SELF_LOG_LIMITS = Object.freeze({entries:500,audience:20,roles:10,text:2000});
export const RETAINED_LIMITS = Object.freeze({entries:300,value:80,text:2000});

const forbidden = new Set(['__proto__','prototype','constructor']);
const STATUSES = ['kept','told','public'];
const PHASES = ['day','night'];

function fail(message) { throw new Error(message); }
function assertSafeObject(v,label) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${label} invalide / Invalid ${label}`);
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail('Objet dangereux / Unsafe object');
  for (const key of Object.keys(v)) if (forbidden.has(key)) fail('Clé dangereuse / Unsafe key');
  return v;
}
function id(v) {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(v) || forbidden.has(v)) fail('Identifiant invalide / Invalid ID');
  return v;
}
function integer(v,min,max) {
  if (!Number.isInteger(v) || v < min || v > max) fail('Nombre invalide / Invalid number');
  return v;
}
function text(v,max) {
  if (typeof v !== 'string' || v.length > max) fail('Texte invalide / Invalid text');
  return v;
}
function list(v,max) {
  if (!Array.isArray(v) || v.length > max) fail('Liste invalide / Invalid list');
  return v;
}
function choice(v,choices) {
  if (!choices.includes(v)) fail('Valeur invalide / Invalid value');
  return v;
}
function bool(v) {
  if (typeof v !== 'boolean') fail('Booléen invalide / Invalid boolean');
  return v;
}
function unique(v) {
  if (new Set(v).size !== v.length) fail('Doublon / Duplicate');
  return v;
}
function setFrom(values,label) {
  const out = new Set();
  const source = values instanceof Set ? [...values] : values;
  for (const value of list(source,500).map(id)) {
    if (out.has(value)) fail('Doublon / Duplicate');
    out.add(value);
  }
  if (!out.size) fail(`${label} manquant / Missing ${label}`);
  return out;
}
function known(set,value,missingMessage) {
  id(value);
  if (!set.has(value)) fail(missingMessage);
  return value;
}
function normalizeAudience(value,playerIds) {
  const audience = unique(list(value,SELF_LOG_LIMITS.audience).map(v => {
    if (v === PUBLIC_AUDIENCE) return PUBLIC_AUDIENCE;
    return known(playerIds,v,'Joueur absent / Missing player');
  }));
  if (!audience.length) fail('Audience vide / Empty audience');
  if (audience.includes(PUBLIC_AUDIENCE) && audience.length !== 1) fail('Audience publique mixte / Mixed public audience');
  return audience;
}

export function validateSelfLog(raw,{playerIds,roleIds}={}) {
  const players = setFrom(playerIds ?? [],'joueurs / players');
  const roles = setFrom(roleIds ?? [],'rôles / roles');
  const entries = list(raw ?? [],SELF_LOG_LIMITS.entries).map(entry => {
    assertSafeObject(entry,'entrée / entry');
    return {
      id:id(entry.id),
      day:integer(entry.day,1,99),
      phase:choice(entry.phase,PHASES),
      audience:normalizeAudience(entry.audience,players),
      roleIds:unique(list(entry.roleIds ?? [],SELF_LOG_LIMITS.roles).map(role => known(roles,role,'Rôle absent du script / Role not on script'))),
      text:text(entry.text ?? '',SELF_LOG_LIMITS.text),
      status:choice(entry.status,STATUSES)
    };
  });
  unique(entries.map(entry => entry.id));
  return entries;
}

export function validateRetained(raw,{roleIds}={}) {
  const roles = setFrom(roleIds ?? [],'rôles / roles');
  const entries = list(raw ?? [],RETAINED_LIMITS.entries).map(entry => {
    assertSafeObject(entry,'entrée / entry');
    return {
      id:id(entry.id),
      night:integer(entry.night,1,99),
      roleId:entry.roleId ? known(roles,entry.roleId,'Rôle absent du script / Role not on script') : '',
      value:text(entry.value ?? '',RETAINED_LIMITS.value),
      text:text(entry.text ?? '',RETAINED_LIMITS.text),
      shared:bool(entry.shared)
    };
  });
  unique(entries.map(entry => entry.id));
  return entries;
}

function audienceKey(audience) { return audience.includes(PUBLIC_AUDIENCE) ? PUBLIC_AUDIENCE : audience.join('|'); }
function audienceType(audience) { return audience.includes(PUBLIC_AUDIENCE) ? 'public' : 'private'; }
function byTime(a,b) { return a.day-b.day || (a.phase === 'night' ? 0 : 1) - (b.phase === 'night' ? 0 : 1) || a.id.localeCompare(b.id); }

export function consistency(selfLog,{roleName=id=>id}={}) {
  const claimsByAudience = new Map();
  const statements = [];
  for (const entry of [...(selfLog ?? [])].sort(byTime)) {
    const audience = [...entry.audience];
    const key = audienceKey(audience);
    if (entry.roleIds?.length) {
      const record = claimsByAudience.get(key) ?? {audience,type:audienceType(audience),claims:[]};
      for (const roleId of entry.roleIds) record.claims.push({entryId:entry.id,day:entry.day,phase:entry.phase,roleId,roleName:roleName(roleId)});
      claimsByAudience.set(key,record);
    }
    if ((entry.text ?? '').trim()) statements.push({entryId:entry.id,day:entry.day,phase:entry.phase,audience,type:audienceType(audience),status:entry.status,text:entry.text});
  }
  return {claimsByAudience:[...claimsByAudience.values()],statements};
}

export function whoKnows(selfLog) {
  const result = {};
  for (const entry of selfLog ?? []) {
    if (!Array.isArray(entry.audience) || entry.audience.includes(PUBLIC_AUDIENCE)) continue;
    for (const playerId of entry.audience) {
      if (!Object.hasOwn(result,playerId)) result[playerId] = [];
      result[playerId].push({
        entryId:entry.id,
        day:entry.day,
        phase:entry.phase,
        roleIds:[...(entry.roleIds ?? [])],
        text:entry.text ?? '',
        status:entry.status
      });
    }
  }
  return result;
}

export function retainedSeries(retained,{roleName=id=>id,lang='fr'}={}) {
  const byRole = new Map();
  for (const entry of [...(retained ?? [])].sort((a,b)=>a.night-b.night||a.id.localeCompare(b.id))) {
    const item = `N${entry.night} ${entry.value || entry.text || '—'}`;
    const record = byRole.get(entry.roleId) ?? {roleId:entry.roleId,roleName:roleName(entry.roleId),series:'',items:[],shared:0,total:0};
    record.items.push({night:entry.night,value:entry.value,text:entry.text,shared:entry.shared,label:item});
    record.total++;
    if (entry.shared) record.shared++;
    byRole.set(entry.roleId,record);
  }
  return [...byRole.values()].map(record => ({...record,series:record.items.map(item=>item.label).join(', '),lang}));
}
