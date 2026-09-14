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
  connectionsOf: ['Liens', 'Connections of'],
  noSelection: ['Aucun siège sélectionné : cadran net, sans lien.', 'No seat selected: clean dial, no connections.'],
  noLinks: ['Aucun lien pour ce siège.', 'No connection for this seat.'],
  namesHidden: ['Noms masqués à ce nombre de joueurs : voir la liste et les libellés.', 'Names hidden at this player count: see the list and labels.'],
  legend: ['Lecture des traits', 'Reading the lines'],
  kindTold: ['communiqué', 'told'],
  kindVoted: ['a voté', 'voted'],
  kindNominated: ['a nommé', 'nominated'],
  kindPaired: ['lié', 'paired'],
  kindConflict: ['conflit', 'conflict'],
  says: ['dit', 'says'],
  is: ['est', 'is'],
  bothClaim: ['revendiquent tous deux', 'both claim'],
  votedAgainst: ['a voté contre', 'voted against'],
  nominatedVerb: ['a nommé', 'nominated'],
  linkedTo: ['lié à', 'linked to'],
  arePaired: ['sont liés par une hypothèse', 'are linked by an assumption'],
  saidSomething: ['a parlé', 'spoke about'],
  noRoleGiven: [', sans rôle précisé', ', no character named'],
  noDetail: ['sans détail', 'no detail'],
  arrowHint: ['La flèche va de qui parle vers qui est visé.', 'The arrow runs from who speaks to who is named.']
};

// Seuls ces liens ont un sens de lecture : quelqu un agit envers quelqu un.
// Un conflit ou une hypothese lient deux sieges a egalite, sans direction.
const DIRECTED = new Set(['told', 'voted', 'nominated']);

const KIND_KEY = {told: 'kindTold', voted: 'kindVoted', nominated: 'kindNominated', paired: 'kindPaired', conflict: 'kindConflict'};
const TRUST_KEY = {unknown: 'trustUnknown', trusted: 'trustTrusted', watch: 'trustWatch', suspect: 'trustSuspect'};
const TRUST_GLYPH = {unknown: '?', trusted: '✓', watch: '≈', suspect: '!'};

function tr(key, lang) { return (TEXT[key] || [key, key])[lang === 'en' ? 1 : 0]; }
function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}
function kindLabel(kind, lang) { return tr(KIND_KEY[kind] || 'kindTold', lang); }
function truncate(value, max) { const s = String(value ?? ''); return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s; }

// Couper au signe pres donne « serait mal… » : on recule au dernier espace
// pour qu une note tronquee se termine sur un mot entier.
function truncateWords(value, max) {
  const s = String(value ?? '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s,;:.!?]+$/, '')}…`;
}

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

// Les etiquettes restent sur leur corde : on choisit le point du trace qui
// n empiete ni sur un siege ni sur une etiquette deja posee, plutot que de les
// deplacer au hasard. Les quatre dernieres valeurs sont des positions de repli,
// utilisees seulement quand les six premieres sont toutes obstruees.
const LABEL_T = [0.62, 0.72, 0.52, 0.80, 0.44, 0.88, 0.36, 0.67, 0.57, 0.47];

// Deux liens sur une meme paire suivraient exactement la meme courbe et le
// second disparaitrait sous le premier : on eloigne son point de controle du
// centre pour ecarter les traces, et donc aussi leurs etiquettes.
const SPREAD = [0, 0.34, 0.58, 0.76];

function labelBox(x, y, text, font, pad = 0) {
  const w = Math.max(font, 0.56 * font * String(text).length) + pad * 2;
  return {x: x - w / 2, y: y - font * 0.6 - pad, w, h: font * 1.2 + pad * 2};
}

function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

function placeLabels(geom, font, labelOf, obstacles) {
  const placed = obstacles.slice();
  for (const c of geom) {
    const text = labelOf(c);
    let best = null;
    for (const t of LABEL_T) {
      const u = 1 - t;
      const x = u * u * c.selX + 2 * u * t * c.cx + t * t * c.otherX;
      const y = u * u * c.selY + 2 * u * t * c.cy + t * t * c.otherY;
      const box = labelBox(x, y, text, font, font * 0.35);
      const cost = placed.reduce((sum, p) => sum + overlapArea(box, p), 0);
      if (!best || cost < best.cost) best = {x, y, box, cost};
      if (cost === 0) break;
    }
    c.lx = best.x;
    c.ly = best.y;
    placed.push(best.box);
  }
}

function chordGeometry(model, center) {
  const byId = new Map(model.seats.map(s => [s.id, s]));
  const seen = new Set();
  const rankOf = new Map();
  const out = [];
  for (const link of model.links) {
    const a = byId.get(link.from), b = byId.get(link.to);
    if (!a || !b || a.id === b.id) continue;
    const pair = [a.id, b.id].sort().join('\0');
    const key = `${pair}\0${link.kind}\0${(link.roleIds || []).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rank = rankOf.get(pair) || 0;
    rankOf.set(pair, rank + 1);
    const spread = SPREAD[Math.min(rank, SPREAD.length - 1)];
    const cx = center + ((a.x + b.x) / 2 - center) * spread;
    const cy = center + ((a.y + b.y) / 2 - center) * spread;
    const sel = a.id === model.selectedId ? a : b;
    const other = sel === a ? b : a;
    out.push({
      ax: a.x, ay: a.y, bx: b.x, by: b.y, cx, cy, lx: 0, ly: 0, kind: link.kind,
      selX: sel.x, selY: sel.y, otherX: other.x, otherY: other.y,
      selName: sel.name, otherName: other.name,
      fromName: a.name, toName: b.name,
      selIsSource: link.from === sel.id,
      directed: DIRECTED.has(link.kind),
      roleIds: link.roleIds || [], notes: link.notes || [], label: link.label
    });
  }
  return out;
}

// Ce qui EST en jeu : le role s il existe, sinon le verbatim.
function substance(c, roleName) {
  return {
    roles: c.roleIds.map(roleName).filter(Boolean).join(' / '),
    note: c.notes.find(Boolean) || ''
  };
}

// Etiquette posee sur la corde : elle dit le CONTENU du lien, jamais sa
// categorie, que le style du trait et la legende portent deja. Un role tient
// en douze signes. Faute de role, un propos avoue qu on ignore ce qui a ete
// dit ; les autres liens sont des actes complets et gardent le mot exact de
// la legende, pour qu un seul vocabulaire circule dans toute la vue.
function chordText(c, lang, roleName) {
  const {roles} = substance(c, roleName);
  if (roles) return truncate(roles, 12);
  if (c.kind === 'told') return tr('noDetail', lang);
  return truncate(kindLabel(c.kind, lang), 12);
}

// La fleche se pose juste avant le cercle vise. Pres de t=1 la courbe suit la
// droite point de controle vers destination, donc reculer le long de cette
// droite revient a rester sur le trace.
function arrowPoints(c, nodeR, k) {
  const dx = c.bx - c.cx, dy = c.by - c.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tipX = c.bx - ux * (nodeR + 2 * k), tipY = c.by - uy * (nodeR + 2 * k);
  const back = 7 * k, wing = 3.6 * k;
  const p1x = tipX - ux * back - uy * wing, p1y = tipY - uy * back + ux * wing;
  const p2x = tipX - ux * back + uy * wing, p2y = tipY - uy * back - ux * wing;
  return `${tipX.toFixed(1)},${tipY.toFixed(1)} ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}`;
}

// Phrase complete : qui dit quoi de qui.
function sentence(c, lang, roleName) {
  const {roles} = substance(c, roleName);
  const and = lang === 'en' ? 'and' : 'et';
  const source = c.selIsSource ? c.selName : c.otherName;
  const subject = c.selIsSource ? c.otherName : c.selName;
  if (c.kind === 'conflict') return `${c.selName} ${and} ${c.otherName} ${tr('bothClaim', lang)} ${roles}`;
  if (c.kind === 'voted') return `${source} ${tr('votedAgainst', lang)} ${subject}`;
  if (c.kind === 'nominated') return `${source} ${tr('nominatedVerb', lang)} ${subject}`;
  if (c.kind === 'paired') return `${c.selName} ${and} ${c.otherName} ${tr('arePaired', lang)}`;
  if (roles) return `${source} ${tr('says', lang)} : ${subject} ${tr('is', lang)} ${roles}`;
  return lang === 'en'
    ? `${source} ${tr('saidSomething', lang)} ${subject}${tr('noRoleGiven', lang)}`
    : `${source} ${tr('saidSomething', lang)} ${elide(subject)}${tr('noRoleGiven', lang)}`;
}

// « de Alice » se dit « d Alice » : l elision evite la faute a chaque ligne.
function elide(name) {
  const first = String(name || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').charAt(0).toLowerCase();
  return /[aeiouyh]/.test(first) ? `d’${name}` : `de ${name}`;
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
  const geom = chordGeometry(model, center);
  const labelFont = Math.max(11 * k, nodeR * 0.42);
  // Les sieges sont des obstacles fixes : une etiquette posee sous un cercle
  // est illisible, quel que soit son ecart avec les autres etiquettes.
  const seatBoxes = model.seats.map(s => ({x: s.x - nodeR, y: s.y - nodeR, w: nodeR * 2, h: nodeR * 2}));
  placeLabels(geom, labelFont, c => chordText(c, lang, roleName), seatBoxes);
  const chords = geom.map(c => {
    const d = `M ${c.ax.toFixed(1)} ${c.ay.toFixed(1)} Q ${c.cx.toFixed(1)} ${c.cy.toFixed(1)} ${c.bx.toFixed(1)} ${c.by.toFixed(1)}`;
    const text = chordText(c, lang, roleName);
    const arrow = c.directed
      ? `<polygon class="plan-arrow plan-kind-${esc(c.kind)}" points="${arrowPoints(c, nodeR, k)}" aria-hidden="true"></polygon>`
      : '';
    return `<path class="plan-chord plan-kind-${esc(c.kind)}" data-plan-kind="${esc(c.kind)}" aria-hidden="true" fill="none" d="${d}"><title>${esc(sentence(c, lang, roleName))}</title></path>${arrow}` +
      `<text class="plan-chord-label" data-plan-kind="${esc(c.kind)}" x="${c.lx.toFixed(1)}" y="${c.ly.toFixed(1)}" text-anchor="middle" style="font-size:${labelFont.toFixed(1)}px" aria-hidden="true">${esc(text)}</text>`;
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
  const selectedSeat = model.seats.find(s => s.id === model.selectedId);
  const listItems = model.selectedId
    ? (geom.length
        ? `<ul class="plan-link-list">${(() => {
            const seenNotes = new Set();
            return geom.map(c => {
              const note = substance(c, roleName).note;
              const fresh = note && c.kind !== 'conflict' && !seenNotes.has(note);
              if (fresh) seenNotes.add(note);
              return `<li class="plan-link plan-kind-${esc(c.kind)}">` +
                `<span class="plan-chip plan-kind-${esc(c.kind)}">${esc(kindLabel(c.kind, lang))}</span>` +
                `<span class="plan-link-text">${esc(sentence(c, lang, roleName))}</span>` +
                (fresh ? `<span class="plan-link-note">${esc(truncateWords(note, 90))}</span>` : '') +
                `</li>`;
            }).join('');
          })()}</ul>`
        : `<p class="plan-muted">${esc(tr('noLinks', lang))}</p>`)
    : `<p class="plan-muted">${esc(tr('noSelection', lang))}</p>`;
  const kindsShown = [...new Set(geom.map(c => c.kind))];
  const legendList = kindsShown.length > 1
    ? `<ul class="plan-legend" aria-label="${esc(tr('legend', lang))}">${kindsShown.map(kind =>
        `<li class="plan-kind-${esc(kind)}"><span class="plan-legend-line" aria-hidden="true"></span>${esc(kindLabel(kind, lang))}</li>`).join('')}</ul>`
    : '';
  // La fleche apparait des qu un lien est oriente : il faut la decoder meme
  // quand un seul type de trait est a l ecran et rend la legende inutile.
  const legend = legendList + (geom.some(c => c.directed) ? `<p class="plan-arrow-hint">${esc(tr('arrowHint', lang))}</p>` : '');
  const heading = selectedSeat
    ? (lang === 'en' ? `${tr('connectionsOf', lang)} ${selectedSeat.name}` : `${tr('connectionsOf', lang)} ${elide(selectedSeat.name)}`)
    : tr('connections', lang);
  const namesNotice = showNames ? '' : `<p class="plan-muted">${esc(tr('namesHidden', lang))}</p>`;
  const help = model.selectedId ? '' : `<p class="plan-help">${esc(tr('dialHelp', lang))}</p>`;
  return `<section class="plan" aria-label="${esc(tr('dial', lang))}">` +
    `${help}${namesNotice}` +
    `<div class="plan-wrap"><svg class="plan-svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(tr('dial', lang))}">` +
    `<circle class="plan-ring" cx="${center}" cy="${center}" r="${radius.toFixed(1)}" fill="none"></circle>${chords}${nodes}</svg></div>` +
    `<div class="plan-connections" aria-label="${esc(tr('connections', lang))}"><h3>${esc(heading)}</h3>${legend}${listItems}</div></section>`;
}
