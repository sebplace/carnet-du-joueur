import {buildRelations} from './investigation.js';
import {buildLastClaimIndex} from './evidence.js';

const TEXT = {
  dial: ['Le cadran', 'The dial'],
  dialHelp: ['Touche un siège pour révéler seulement ses liens.', 'Tap a seat to reveal only its connections.'],
  seat: ['Siège', 'Seat'],
  alive: ['vivant', 'alive'],
  dead: ['mort', 'dead'],
  ghostVote: ['vote fantôme disponible', 'ghost vote available'],
  ghostSpent: ['vote fantôme utilisé', 'ghost vote spent'],
  me: ['moi', 'me'],
  traveller: ['Voyageur', 'Traveller'],
  trustUnknown: ['confiance inconnue', 'trust unknown'],
  trustTrusted: ['de confiance', 'trusted'],
  trustWatch: ['à surveiller', 'watch'],
  trustSuspect: ['suspect', 'suspect'],
  claim: ['déclare', 'claims'],
  noClaim: ['aucun rôle déclaré', 'no claimed character'],
  selectSeat: ['Sélectionner le siège', 'Select seat'],
  connections: ['Liens du siège sélectionné', 'Selected seat connections'],
  noSelection: ['Aucun siège sélectionné : cadran net, sans lien.', 'No seat selected: clean dial, no connections.'],
  noLinks: ['Aucun lien pour ce siège.', 'No connection for this seat.'],
  namesHidden: ['Noms masqués à ce nombre de joueurs : voir la liste et les libellés.', 'Names hidden at this player count: see the list and labels.'],
  kindTold: ['communiqué', 'told'],
  kindVoted: ['a voté', 'voted'],
  kindNominated: ['a nommé', 'nominated'],
  kindPaired: ['lié', 'paired'],
  kindConflict: ['conflit', 'conflict']
};

const KIND_KEY = {told: 'kindTold', voted: 'kindVoted', nominated: 'kindNominated', paired: 'kindPaired', conflict: 'kindConflict'};
const TRUST_KEY = {unknown: 'trustUnknown', trusted: 'trustTrusted', watch: 'trustWatch', suspect: 'trustSuspect'};
const TRUST_GLYPH = {unknown: '?', trusted: '✓', watch: '≈', suspect: '!'};

function tr(key, lang) { return (TEXT[key] || [key, key])[lang === 'en' ? 1 : 0]; }
function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}
function kindLabel(kind, lang) { return tr(KIND_KEY[kind] || 'kindTold', lang); }
function truncate(value, max) { const s = String(value ?? ''); return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s; }

function pointAt(index, total, radius, center) {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index / Math.max(1, total));
  return {angle, x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius};
}

function nodeRadius(count, k) { return k * (count <= 9 ? 26 : count <= 14 ? 21 : 16); }

export function buildPlanModel(game, options = {}) {
  const size = Number(options.size) > 0 ? Number(options.size) : 320;
  const selectedId = options.selectedId || '';
  const k = size / 320;
  const center = size / 2;
  const players = game.players;
  const count = players.length;
  const nodeR = nodeRadius(count, k);
  const radius = Math.max(nodeR + k * 6, center - nodeR - k * 8);
  const hit = 44 * k;
  const showNames = count <= 10;
  const claims = buildLastClaimIndex(game);
  const seats = players.map((p, i) => {
    const pt = pointAt(i, count, radius, center);
    const claim = claims.get(p.id);
    return {
      id: p.id, seat: i + 1, name: p.name, angle: pt.angle, x: pt.x, y: pt.y,
      alive: p.alive, ghost: p.ghost, traveller: p.traveller, me: p.id === game.myId,
      trust: p.trust, claimRoleIds: claim ? claim.roleIds : []
    };
  });
  const relations = buildRelations(game);
  const links = selectedId ? relations.links.filter(l => l.from === selectedId || l.to === selectedId) : [];
  return {size, center, radius, nodeR, hit, count, selectedId, showNames, seats, links};
}

function seatMarkers(seat, lang) {
  const marks = [];
  if (seat.me) marks.push('◎');
  if (seat.traveller) marks.push('✈');
  if (!seat.alive) marks.push(seat.ghost ? '✝·' : '✝');
  marks.push(TRUST_GLYPH[seat.trust] || '?');
  return marks.join(' ');
}

function seatAria(seat, claimLabel, lang) {
  const parts = [`${tr('seat', lang)} ${seat.seat}`, seat.name, seat.alive ? tr('alive', lang) : tr('dead', lang)];
  if (!seat.alive) parts.push(seat.ghost ? tr('ghostVote', lang) : tr('ghostSpent', lang));
  if (seat.me) parts.push(tr('me', lang));
  if (seat.traveller) parts.push(tr('traveller', lang));
  parts.push(tr(TRUST_KEY[seat.trust] || 'trustUnknown', lang));
  parts.push(claimLabel ? `${tr('claim', lang)} ${claimLabel}` : tr('noClaim', lang));
  return parts.join(' · ');
}

function chordGeometry(model) {
  const byId = new Map(model.seats.map(s => [s.id, s]));
  const seen = new Set();
  const out = [];
  let index = 0;
  for (const link of model.links) {
    const a = byId.get(link.from), b = byId.get(link.to);
    if (!a || !b || a.id === b.id) continue;
    const pair = [a.id, b.id].sort().join('\0');
    const key = `${pair}\0${link.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sel = a.id === model.selectedId ? a : b;
    const other = sel === a ? b : a;
    const t = 0.62 + 0.08 * (index % 4);
    const u = 1 - t;
    const lx = u * u * sel.x + 2 * u * t * model.center + t * t * other.x;
    const ly = u * u * sel.y + 2 * u * t * model.center + t * t * other.y;
    out.push({ax: a.x, ay: a.y, bx: b.x, by: b.y, lx, ly, kind: link.kind, otherName: other.name, label: link.label});
    index++;
  }
  return out;
}

export function renderPlan(model, options = {}) {
  const lang = options.lang === 'en' ? 'en' : 'fr';
  const roleName = typeof options.roleName === 'function' ? options.roleName : id => id;
  const {size, center, radius, nodeR, hit, showNames} = model;
  const k = size / 320;
  const floor = 14 * k;
  const seatFont = Math.max(floor, nodeR * (showNames ? 0.7 : 0.85)).toFixed(1);
  const nameFont = Math.max(floor, nodeR * 0.5).toFixed(1);
  const markFont = (nodeR * 0.45).toFixed(1);
  const claimLabelOf = seat => seat.claimRoleIds.map(roleName).filter(Boolean).join(' / ');
  const geom = chordGeometry(model);
  const chords = geom.map(c => {
    const d = `M ${c.ax.toFixed(1)} ${c.ay.toFixed(1)} Q ${center} ${center} ${c.bx.toFixed(1)} ${c.by.toFixed(1)}`;
    const title = `${kindLabel(c.kind, lang)} · ${esc(c.otherName)}`;
    return `<path class="plan-chord plan-kind-${esc(c.kind)}" data-plan-kind="${esc(c.kind)}" aria-hidden="true" fill="none" d="${d}"><title>${title}</title></path>` +
      `<text class="plan-chord-label" data-plan-kind="${esc(c.kind)}" x="${c.lx.toFixed(1)}" y="${c.ly.toFixed(1)}" text-anchor="middle" aria-hidden="true">${esc(kindLabel(c.kind, lang))}</text>`;
  }).join('');
  const nodes = model.seats.map(seat => {
    const claimLabel = claimLabelOf(seat);
    const linked = !model.selectedId || seat.id === model.selectedId || model.links.some(l => l.from === seat.id || l.to === seat.id);
    const ghostClass = seat.alive ? '' : (seat.ghost ? 'plan-ghost-available' : 'plan-ghost-spent');
    const classes = ['plan-seat', seat.alive ? 'plan-alive' : 'plan-dead', ghostClass, seat.me ? 'plan-me' : '', seat.traveller ? 'plan-traveller' : '',
      `plan-trust-${esc(seat.trust)}`, seat.id === model.selectedId ? 'plan-selected' : '', linked ? '' : 'plan-dim'].filter(Boolean).join(' ');
    const nameLine = showNames ? `<text class="plan-seat-name" y="${(nodeR * 0.58).toFixed(1)}" text-anchor="middle" style="font-size:${nameFont}px">${esc(truncate(seat.name, seat.traveller ? 6 : 8))}</text>` : '';
    const markers = showNames ? '' : `<text class="plan-seat-mark" y="${(nodeR * 0.5).toFixed(1)}" text-anchor="middle" aria-hidden="true" style="font-size:${markFont}px">${esc(seatMarkers(seat, lang))}</text>`;
    const deadCross = seat.alive ? '' : `<line class="plan-dead-cross" x1="${(-nodeR * 0.6).toFixed(1)}" y1="${(-nodeR * 0.6).toFixed(1)}" x2="${(nodeR * 0.6).toFixed(1)}" y2="${(nodeR * 0.6).toFixed(1)}" aria-hidden="true"></line>`;
    return `<g class="${classes}" role="button" tabindex="0" data-plan-seat="${esc(seat.id)}" data-alive="${seat.alive}" data-ghost="${seat.ghost}" data-traveller="${seat.traveller}" data-me="${seat.me}" data-trust="${esc(seat.trust)}" aria-label="${esc(tr('selectSeat', lang))} — ${esc(seatAria(seat, claimLabel, lang))}" transform="translate(${seat.x.toFixed(1)} ${seat.y.toFixed(1)})">` +
      `<title>${esc(seatAria(seat, claimLabel, lang))}</title>` +
      `<rect class="plan-hit" x="${(-hit / 2).toFixed(1)}" y="${(-hit / 2).toFixed(1)}" width="${hit.toFixed(1)}" height="${hit.toFixed(1)}" fill="transparent"></rect>` +
      `<circle class="plan-disc" r="${nodeR.toFixed(1)}"></circle>${deadCross}` +
      `<text class="plan-seat-num" text-anchor="middle" dominant-baseline="central" y="${showNames ? (-nodeR * 0.28).toFixed(1) : '0'}" style="font-size:${seatFont}px">${seat.seat}</text>` +
      `${nameLine}${markers}</g>`;
  }).join('');
  const listItems = model.selectedId
    ? (geom.length
        ? `<ul class="plan-link-list">${geom.map(c => `<li><span class="plan-chip plan-kind-${esc(c.kind)}">${esc(kindLabel(c.kind, lang))}</span> ${esc(c.otherName)}${c.label && c.label !== c.kind ? ` · ${esc(c.label)}` : ''}</li>`).join('')}</ul>`
        : `<p class="plan-muted">${esc(tr('noLinks', lang))}</p>`)
    : `<p class="plan-muted">${esc(tr('noSelection', lang))}</p>`;
  const namesNotice = showNames ? '' : `<p class="plan-muted">${esc(tr('namesHidden', lang))}</p>`;
  return `<section class="plan" aria-label="${esc(tr('dial', lang))}">` +
    `<p class="plan-help">${esc(tr('dialHelp', lang))}</p>${namesNotice}` +
    `<div class="plan-wrap"><svg class="plan-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(tr('dial', lang))}">` +
    `<circle class="plan-ring" cx="${center}" cy="${center}" r="${radius.toFixed(1)}" fill="none"></circle>${chords}${nodes}</svg></div>` +
    `<div class="plan-connections" aria-label="${esc(tr('connections', lang))}"><h3>${esc(tr('connections', lang))}</h3>${listItems}</div></section>`;
}
