import {normalCounts} from './state.js';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function roleLabel(role,lang) {
  const name = role?.name;
  if (name && typeof name === 'object') return name[lang] || name.en || name.fr || role.id;
  return typeof name === 'string' ? name : role?.id;
}
function composition(game) {
  const scenario = game.scenarios?.find(s=>s.id===game.activeScenario) ?? game.scenarios?.[0];
  if (scenario?.counts) return scenario.counts;
  try { return normalCounts(Math.min(15,(game.players ?? []).filter(p=>!p.traveller).length)); }
  catch { return {townsfolk:'',outsider:'',minion:'',demon:''}; }
}
function recordedFor(game,playerId) {
  const claims = (game.claims ?? []).filter(c=>c.playerId === playerId).map(c=>[...(c.roleIds ?? [])].join(' / ')).filter(Boolean);
  const notes = (game.events ?? []).filter(e=>(e.playerIds ?? []).includes(playerId)).map(e=>e.text).filter(Boolean);
  return {claims:claims.join('; '),notes:notes.join('; ')};
}
function scriptRoles(game,catalogue,lang) {
  const known = new Map((catalogue?.roles ?? []).map(r=>[r.id,r]));
  for (const role of game.script?.customRoles ?? []) known.set(role.id,role);
  return (game.script?.roleIds ?? []).map(id=>roleLabel(known.get(id) ?? {id},lang)).filter(Boolean);
}

export function printableSheet(game,{catalogue={},lang='fr',includeRecorded=false}={}) {
  const players = game.players ?? [];
  const counts = composition(game);
  const roles = scriptRoles(game,catalogue,lang);
  const labels = lang === 'en'
    ? {players:'players',composition:'Starting composition',seat:'Seat',name:'Name',claim:'Claims',notes:'Notes',votes:'Votes and nominations',deaths:'Night deaths',reference:'Script characters'}
    : {players:'joueurs',composition:'Composition initiale',seat:'Place',name:'Nom',claim:'Déclarations',notes:'Notes',votes:'Votes et nominations',deaths:'Morts de nuit',reference:'Personnages du script'};
  const rows = players.map((player,index)=>{
    const recorded = includeRecorded ? recordedFor(game,player.id) : {claims:'',notes:''};
    return `<tr><td>${index+1}</td><td>${esc(player.name)}</td><td>${esc(recorded.claims)}</td><td>${esc(recorded.notes)}</td></tr>`;
  }).join('');
  const roleList = roles.map(role=>`<li>${esc(role)}</li>`).join('');
  const comp = `T ${esc(counts.townsfolk)} / O ${esc(counts.outsider)} / M ${esc(counts.minion)} / D ${esc(counts.demon)}`;
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<title>${esc(game.script?.name || game.title || 'Carnet du Joueur')}</title>
<style>
@page{size:A4;margin:10mm}
*{box-sizing:border-box}
body{font:10pt/1.25 system-ui,sans-serif;color:#000;background:#fff;margin:0}
h1{font-size:16pt;margin:0 0 2mm}
h2{font-size:11pt;margin:4mm 0 1.5mm}
.meta{display:flex;gap:5mm;flex-wrap:wrap;margin-bottom:3mm}
table{width:100%;border-collapse:collapse;page-break-inside:auto}
tr{page-break-inside:avoid}
th,td{border:1px solid #000;padding:1.5mm;vertical-align:top}
th{font-weight:700;text-align:left}
td:nth-child(1){width:9mm;text-align:center}
td:nth-child(2){width:28mm}
td:nth-child(3),td:nth-child(4){height:9mm}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.box{border:1px solid #000;min-height:30mm;padding:2mm}
.roles{columns:3;font-size:8.5pt;margin:0;padding-left:4mm}
@media print{body{print-color-adjust:exact}.screen{display:none}}
</style>
</head>
<body>
<h1>${esc(game.script?.name || game.title || 'Carnet du Joueur')}</h1>
<div class="meta"><span>${players.length} ${labels.players}</span><span>${labels.composition}: ${comp}</span></div>
<table aria-label="players"><thead><tr><th>${labels.seat}</th><th>${labels.name}</th><th>${labels.claim}</th><th>${labels.notes}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="grid">
<section><h2>${labels.votes}</h2><div class="box"></div></section>
<section><h2>${labels.deaths}</h2><div class="box"></div></section>
</div>
<section><h2>${labels.reference}</h2><ul class="roles">${roleList}</ul></section>
</body>
</html>`;
}
