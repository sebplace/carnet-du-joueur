import * as investigation from './investigation.js';

/**
 * Board context contract for renderBoard(container, ctx) and buildBoardModel(game, ctx):
 * ctx.game: current validated game; ctx.catalogue: script/catalogue data; ctx.prediction: null or
 * {result:{reliable, method, probabilities:{[playerId]:{[roleId]:number}}, presence:{[roleId]:number}, halfWidth?:object}};
 * ctx.lang: 'fr'|'en' (French default); ctx.playerName(id), ctx.roleName(id): hostile-text label helpers;
 * ctx.openPlayer(id), ctx.openRecord(recordId): optional callbacks used by explicit open buttons.
 */
export const boardState = { lens: 'timeline', selectedPlayer: '', selectedRole: '', phase: '', query: '', linksLimit: 150 };

const LENSES = ['timeline', 'grille', 'conflits', 'links'];
const PRIMARY_LENSES = ['timeline', 'grille'];
const ANALYTIC_LENSES = ['conflits', 'links'];
const CLUE_TYPES = new Set(['claim', 'info', 'night', 'note']);
const PHASE_ORDER = { night: 0, day: 1 };
const MAX_ROUND_LINKS = 90;
const MAX_LINK_ROWS = 150;

const TEXT = {
  title: ['Tableau d’enquête', 'Investigation board'],
  matrix: ['Matrice', 'Matrix'],
  round: ['Table ronde', 'Round table'],
  timeline: ['Chronologie', 'Timeline'],
  grille: ['Grille', 'Grid'],
  conflits: ['Conflits', 'Conflicts'],
  analytical: ['Analyses', 'Analysis'],
  links: ['Liens', 'Links'],
  phase: ['Moment', 'Phase'],
  allGame: ['Toute la partie', 'Whole game'],
  search: ['Recherche', 'Search'],
  searchPh: ['Joueur, rôle, texte…', 'Player, character, text…'],
  reset: ['Réinitialiser', 'Reset'],
  selected: ['Sélection', 'Selection'],
  none: ['Aucune', 'None'],
  open: ['Ouvrir', 'Open'],
  alive: ['vivant', 'alive'],
  dead: ['mort', 'dead'],
  ghost: ['vote fantôme', 'ghost vote'],
  noGhost: ['vote fantôme utilisé', 'ghost vote spent'],
  traveller: ['Voyageur', 'Traveller'],
  archived: ['archivé', 'archived'],
  noClaim: ['Pas de rôle déclaré', 'No claimed character'],
  currentNeighbours: ['Voisins actuels', 'Current neighbours'],
  leftNeighbour: ['gauche', 'left'],
  rightNeighbour: ['droite', 'right'],
  clues: ['indices', 'clues'],
  given: ['donnés', 'given'],
  received: ['reçus', 'received'],
  votes: ['votes', 'votes'],
  noms: ['nominations', 'nominations'],
  hypotheses: ['hypothèses', 'hypotheses'],
  model: ['modèle', 'model'],
  noProbability: ['Pas d’estimation', 'No estimate'],
  noReliablePrediction: ['Pas de prédiction fiable : la grille montre les déclarations.', 'No reliable prediction: the grid shows claims.'],
  unclaimed: ['non déclaré', 'unclaimed'],
  unclaimedCharacters: ['Personnages déclarés par personne', 'Characters claimed by nobody'],
  claimedBy: ['déclaré par', 'claimed by'],
  cellSelected: ['Case sélectionnée', 'Selected cell'],
  margin: ['marge', 'margin'],
  noMargin: ['marge non disponible', 'margin unavailable'],
  noContradictions: ['Aucun conflit évident dans les déclarations actuelles.', 'No obvious conflict in current claims.'],
  conflictCaution: ['Question à poser, jamais preuve de mensonge.', 'Question to ask, never proof of a lie.'],
  duplicateClaim: ['Ces déclarations récentes partagent le même personnage.', 'These latest claims share the same character.'],
  overClaimed: ['Ce personnage est déclaré par plus de joueurs qu’il ne peut en couvrir.', 'This character is claimed by more players than it can cover.'],
  engineConflict: ['Le moteur signale une contradiction sous l’hypothèse actuelle.', 'The engine reports a contradiction under the current hypothesis.'],
  completeZero: ['résultat complet de poids zéro', 'complete zero-weight result'],
  capacity: ['capacité', 'capacity'],
  conditional: ['conditionnel', 'conditional'],
  selectPlayer: ['Sélectionner', 'Select'],
  clearSelection: ['Effacer la sélection', 'Clear selection'],
  hiddenByFilters: ['masqué(s) par les filtres', 'hidden by filters'],
  hiddenLinks: ['lien(s) non dessinés ici : ouvre Liens pour tout parcourir.', 'link(s) not drawn here: open Links to browse all.'],
  linksTruncated: ['lien(s) non affiché(s) ici.', 'link(s) not shown here.'],
  showMoreLinks: ['Afficher plus de liens', 'Show more links'],
  chordListLabel: ['Liste des liens (équivalent texte)', 'Link list (text equivalent)'],
  chordListEmpty: ['Aucun lien enregistré pour le moment.', 'No link recorded yet.'],
  kindTold: ['communiqué', 'told'],
  kindVoted: ['vote', 'voted'],
  kindNominated: ['nomination', 'nominated'],
  kindPaired: ['hypothèse liée', 'paired hypothesis'],
  kindConflict: ['conflit', 'conflict'],
  noRecords: ['Aucune information ne correspond aux filtres.', 'No record matches the filters.'],
  aroundHelp: ['Les cordes sont des observations notées, jamais une preuve. Les voisins suivent l’ordre réel des sièges.', 'Chords are recorded observations, never proof. Neighbours follow true seat order.'],
  chronologicalHelp: ['Toutes les informations datées restent visibles, groupées par nuit et jour.', 'All dated records stay visible, grouped by night and day.'],
  derivationHelp: ['Détail source → information → modèle. Cette vue peut défiler horizontalement.', 'Source → record → model detail. This view may scroll horizontally.'],
  gridHelp: ['Lignes = sièges réels, colonnes = personnages encore plausibles. Les motifs et les valeurs doublent la couleur.', 'Rows = true seats, columns = still-plausible characters. Patterns and values reinforce colour.'],
  conflictsHelp: ['Les conflits indiquent quoi vérifier à la table ; ils ne prouvent jamais qu’une personne ment.', 'Conflicts show what to verify at the table; they never prove a person lied.'],
  from: ['source', 'source'],
  to: ['cible', 'target'],
  record: ['information', 'record'],
  effect: ['effet', 'effect'],
  tableSeat: ['Siège', 'Seat'],
  claim: ['déclaration', 'claim'],
  info: ['info', 'info'],
  note: ['note', 'note'],
  vote: ['vote', 'vote'],
  execution: ['exécution', 'execution'],
  night: ['nuit', 'night'],
  death: ['mort', 'death'],
  revival: ['réveil', 'revival'],
  hypothesis: ['hypothèse', 'hypothesis'],
  restriction: ['restriction modèle', 'model restriction'],
  phaseRecord: ['phase', 'phase'],
  general: ['Note générale', 'General note']
};

function t(key, lang = 'fr') {
  return (TEXT[key] || [key, key])[lang === 'en' ? 1 : 0];
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

const attr = escapeHtml;
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const uniq = values => [...new Set(values.filter(Boolean))];

function phaseLabel(record, lang) {
  if (!record || !record.phase || !record.day) return t('allGame', lang);
  const name = record.phase === 'day' ? (lang === 'en' ? 'Day' : 'Jour') : (lang === 'en' ? 'Night' : 'Nuit');
  return `${name} ${record.day}`;
}

function recordTypeLabel(type, lang) {
  return t(type === 'phase' ? 'phaseRecord' : type, lang);
}

function roleNameFrom(ctx, id) {
  if (!id) return '';
  if (typeof ctx.roleName === 'function') return ctx.roleName(id);
  const all = [...(ctx.catalogue?.roles || []), ...(ctx.game?.script?.customRoles || ctx.catalogue?.customRoles || [])];
  const role = all.find(r => r.id === id);
  return role?.name?.[ctx.lang === 'en' ? 'en' : 'fr'] || role?.name || id;
}

function playerNameFrom(ctx, peopleById, id) {
  if (!id) return '';
  if (typeof ctx.playerName === 'function') return ctx.playerName(id);
  return peopleById.get(id)?.name || id;
}

function safeInvestigation(game) {
  try {
    return typeof investigation.buildInvestigation === 'function'
      ? investigation.buildInvestigation(game)
      : { people: [], records: [], edges: [] };
  } catch {
    return { people: [], records: [], edges: [] };
  }
}

function safeRelations(game, graph) {
  try {
    if (typeof investigation.buildRelations === 'function') return normalizeRelations(investigation.buildRelations(game));
  } catch {}
  return deriveRelations(graph);
}

function normalizeRelations(relations) {
  return {
    nodes: Array.isArray(relations?.nodes) ? relations.nodes : [],
    links: (Array.isArray(relations?.links) ? relations.links : [])
      .filter(l => l && l.from && l.to && l.from !== l.to)
      .map(l => ({...l, refs: Array.isArray(l.refs) ? l.refs : [], weight: Number(l.weight) || 1, label: l.label || l.kind || ''}))
  };
}

function deriveRelations(graph) {
  const nodes = (graph.people || []).map((p, i) => ({...p, seat: i + 1}));
  const people = new Set(nodes.map(p => p.id));
  const byRecord = new Map();
  for (const edge of graph.edges || []) {
    if (!edge?.to || !String(edge.from || '').startsWith('player:')) continue;
    const player = edge.from.slice(7);
    if (!people.has(player)) continue;
    const bucket = byRecord.get(edge.to) || { sources: [], subjects: [] };
    (edge.kind === 'source' ? bucket.sources : bucket.subjects).push(player);
    byRecord.set(edge.to, bucket);
  }
  const links = new Map();
  const add = (from, to, kind, ref) => {
    if (!from || !to || from === to || !people.has(from) || !people.has(to)) return;
    const key = `${from}\0${to}\0${kind}`;
    const link = links.get(key) || { from, to, kind, weight: 0, refs: [], label: kind };
    link.weight += 1;
    if (ref && !link.refs.includes(ref)) link.refs.push(ref);
    links.set(key, link);
  };
  for (const record of graph.records || []) {
    const bucket = byRecord.get(record.id) || { sources: [], subjects: record.people || [] };
    const kind = record.type === 'execution' ? 'nominated' : record.type === 'vote' ? 'voted' : record.type === 'hypothesis' ? 'paired' : 'told';
    const sources = bucket.sources.length ? bucket.sources : record.people || [];
    const targets = bucket.subjects.length ? bucket.subjects : record.people || [];
    for (const source of sources) for (const target of targets) add(source, target, kind, record.id);
    if (kind === 'paired') for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
      add(targets[i], targets[j], kind, record.id); add(targets[j], targets[i], kind, record.id);
    }
  }
  return { nodes, links: [...links.values()] };
}

function peopleForBoard(game, graph, relations) {
  const activeIds = new Set((game.players || []).map(p => p.id));
  const referenced = new Set();
  for (const record of graph.records || []) for (const id of record.people || []) referenced.add(id);
  for (const edge of graph.edges || []) {
    if (String(edge.from || '').startsWith('player:')) referenced.add(edge.from.slice(7));
    if (String(edge.to || '').startsWith('player:')) referenced.add(edge.to.slice(7));
  }
  for (const link of relations.links || []) { referenced.add(link.from); referenced.add(link.to); }
  const relById = new Map((relations.nodes || []).map(n => [n.id, n]));
  const graphById = new Map((graph.people || []).map(p => [p.id, p]));
  const active = (game.players || []).map((p, i) => ({...p, ...(relById.get(p.id) || {}), archived: false, seat: i + 1}));
  const archived = [...(game.archivedPlayers || []), ...(graph.people || []).filter(p => p.archived)]
    .filter((p, index, arr) => p?.id && !activeIds.has(p.id) && referenced.has(p.id) && arr.findIndex(x => x.id === p.id) === index)
    .map((p, i) => ({...p, ...(graphById.get(p.id) || {}), ...(relById.get(p.id) || {}), archived: true, seat: relById.get(p.id)?.seat || active.length + i + 1}));
  return [...active, ...archived];
}

function recordMatches(record, state, peopleById, ctx) {
  if (state.selectedPlayer && !(record.people || []).includes(state.selectedPlayer)) return false;
  if (state.phase && `${record.phase}:${record.day}` !== state.phase) return false;
  const q = fold(state.query);
  if (!q) return true;
  const haystack = [record.text, record.type, record.impact, ...(record.people || []).map(id => playerNameFrom(ctx, peopleById, id)), ...(record.roleIds || []), ...(record.roleIds || []).map(id => roleNameFrom(ctx, id))].join(' ');
  return fold(haystack).includes(q);
}

function sortRecords(a, b) {
  return (a.day ?? 1000) - (b.day ?? 1000) || (PHASE_ORDER[a.phase] ?? 2) - (PHASE_ORDER[b.phase] ?? 2) || String(a.id).localeCompare(String(b.id));
}

function latestClaim(records) {
  return [...records].filter(r => r.type === 'claim').sort((a, b) => (b.day ?? 0) - (a.day ?? 0) || (b.phase === 'day') - (a.phase === 'day'))[0] || null;
}

function probabilitySummary(playerId, ctx) {
  if (ctx.showModel === false) return []; // locked: matrix rows carry no model output at all
  const probs = ctx.prediction?.result?.probabilities?.[playerId];
  if (!probs) return [];
  return Object.entries(probs)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([roleId, value]) => ({ roleId, role: roleNameFrom(ctx, roleId), value, percent: Math.round(value * 100) }));
}

function activeSeatPeople(people) {
  return [...(people || [])].filter(p => !p.archived).sort((a, b) => (a.seat || 0) - (b.seat || 0));
}

export function seatNeighbours(peopleArg = []) {
  const people = activeSeatPeople(peopleArg);
  const result = {};
  if (!people.length) return result;
  for (let i = 0; i < people.length; i++) {
    const left = people.length > 1 ? people[(i - 1 + people.length) % people.length] : null;
    const right = people.length > 1 ? people[(i + 1) % people.length] : null;
    result[people[i].id] = {
      left: left ? { id: left.id, seat: left.seat, name: left.name } : null,
      right: right ? { id: right.id, seat: right.seat, name: right.name } : null
    };
  }
  return result;
}

function roleEntries(ctx) {
  const catalogueRoles = [...(ctx.catalogue?.roles || []), ...(ctx.catalogue?.customRoles || [])];
  const gameRoles = [...(ctx.game?.script?.roles || []), ...(ctx.game?.script?.customRoles || [])];
  const byId = new Map();
  for (const role of [...catalogueRoles, ...gameRoles]) if (role?.id) byId.set(role.id, role);
  const ids = uniq([...(ctx.game?.script?.roleIds || []), ...(ctx.catalogue?.roleIds || []), ...catalogueRoles.map(r => r.id), ...gameRoles.map(r => r.id)]);
  return ids.map(id => ({ id, role: byId.get(id) || { id }, name: roleNameFrom(ctx, id) }));
}

function latestClaimsByPlayer(records) {
  const byPlayer = new Map();
  for (const record of records || []) {
    if (record?.type !== 'claim') continue;
    for (const playerId of record.people || []) {
      const existing = byPlayer.get(playerId);
      if (!existing || sortRecords(existing, record) <= 0) byPlayer.set(playerId, record);
    }
  }
  return byPlayer;
}

function roleCapacity(role) {
  const candidates = [role?.max, role?.capacity, role?.count, role?.copies, role?.quantity];
  const value = candidates.map(Number).find(n => Number.isFinite(n) && n > 0);
  return value || 1;
}

function predictionCell(playerId, roleId, ctx) {
  if (ctx.showModel === false) return null; // locked: never surface a model-derived percentage anywhere
  const result = ctx.prediction?.result;
  const value = result?.probabilities?.[playerId]?.[roleId];
  if (!result?.reliable || !Number.isFinite(value)) return null;
  const half = result.halfWidth;
  const margin = half?.[playerId]?.[roleId] ?? half?.[`${playerId}:${roleId}`] ?? half?.[`${playerId}|${roleId}`] ?? half?.[roleId]?.[playerId];
  return {
    value,
    percent: Math.round(value * 100),
    margin: Number.isFinite(Number(margin)) ? Number(margin) : null,
    marginPercent: Number.isFinite(Number(margin)) ? Math.round(Number(margin) * 100) : null
  };
}

export function buildCharacterGridModel(gameArg, ctxArg = {}, peopleArg = null, recordsArg = null) {
  const game = gameArg || ctxArg.game || { players: [] };
  const lang = ctxArg.lang === 'en' ? 'en' : 'fr';
  const ctx = {...ctxArg, game, lang};
  const graph = recordsArg ? { records: recordsArg } : safeInvestigation(game);
  const people = (peopleArg || peopleForBoard(game, graph, { nodes: [], links: [] })).filter(p => !p.archived);
  const claims = latestClaimsByPlayer(graph.records || []);
  const claimedByRole = new Map();
  for (const person of people) {
    const claim = claims.get(person.id);
    for (const roleId of claim?.roleIds || []) {
      const list = claimedByRole.get(roleId) || [];
      list.push({ id: person.id, seat: person.seat, name: person.name, recordId: claim.id });
      claimedByRole.set(roleId, list);
    }
  }
  const allRoles = roleEntries(ctx);
  const reliable = !!ctx.prediction?.result?.reliable;
  const plausible = reliable
    ? allRoles.filter(role => people.some(p => Number(ctx.prediction?.result?.probabilities?.[p.id]?.[role.id]) > 0))
    : allRoles;
  const columns = (plausible.length ? plausible : allRoles).map(role => ({
    id: role.id,
    name: role.name,
    capacity: roleCapacity(role.role),
    claimedBy: claimedByRole.get(role.id) || []
  }));
  const rows = people.map(person => ({
    id: person.id,
    seat: person.seat,
    name: person.name,
    neighbours: null,
    cells: columns.map(role => ({
      playerId: person.id,
      playerName: person.name,
      seat: person.seat,
      roleId: role.id,
      roleName: role.name,
      probability: predictionCell(person.id, role.id, ctx),
      claimed: (claimedByRole.get(role.id) || []).some(p => p.id === person.id),
      claimedBy: role.claimedBy
    }))
  }));
  const neighbours = seatNeighbours(people);
  for (const row of rows) row.neighbours = neighbours[row.id] || { left: null, right: null };
  return {
    reliable,
    columns,
    rows,
    unclaimedCharacters: columns.filter(c => !c.claimedBy.length).map(c => ({ id: c.id, name: c.name, capacity: c.capacity })),
    claimedCharacters: columns.filter(c => c.claimedBy.length)
  };
}

function engineContradictions(prediction) {
  const result = prediction?.result || {};
  const weight = Number(result.weight ?? result.totalWeight ?? result.mass ?? result.probabilityWeight);
  const complete = !!(result.complete ?? result.isComplete ?? result.exhaustive);
  if (!complete || weight !== 0) return [];
  const raw = result.contradictions || result.contradictionStrings || result.errors || result.impossibleReasons || result.reasons || [];
  return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(String);
}

export function buildContradictionModel(gameArg, ctxArg = {}, peopleArg = null, recordsArg = null) {
  const game = gameArg || ctxArg.game || { players: [] };
  const lang = ctxArg.lang === 'en' ? 'en' : 'fr';
  const ctx = {...ctxArg, game, lang};
  const graph = recordsArg ? { records: recordsArg } : safeInvestigation(game);
  const people = (peopleArg || peopleForBoard(game, graph, { nodes: [], links: [] })).filter(p => !p.archived);
  const byId = new Map(people.map(p => [p.id, p]));
  const latest = latestClaimsByPlayer(graph.records || []);
  const roleMap = new Map(roleEntries(ctx).map(r => [r.id, r]));
  const claimed = new Map();
  for (const [playerId, record] of latest) {
    if (!byId.has(playerId)) continue;
    for (const roleId of record.roleIds || []) {
      const list = claimed.get(roleId) || [];
      list.push({ playerId, recordId: record.id, name: byId.get(playerId)?.name || playerId, seat: byId.get(playerId)?.seat });
      claimed.set(roleId, list);
    }
  }
  const entries = [];
  for (const [roleId, claimants] of claimed) {
    if (claimants.length > 1) {
      for (let i = 0; i < claimants.length; i++) for (let j = i + 1; j < claimants.length; j++) {
        entries.push({ type: 'duplicate-claim', roleId, roleName: roleNameFrom(ctx, roleId), players: [claimants[i], claimants[j]], message: t('duplicateClaim', lang) });
      }
    }
    const capacity = roleCapacity(roleMap.get(roleId)?.role);
    if (claimants.length > capacity) entries.push({ type: 'over-claimed', roleId, roleName: roleNameFrom(ctx, roleId), players: claimants, capacity, message: t('overClaimed', lang) });
  }
  for (const message of engineContradictions(ctx.prediction)) entries.push({ type: 'engine', message, detail: t('engineConflict', lang) });
  return { entries, claimed: Object.fromEntries(claimed), caution: t('conflictCaution', lang) };
}

function makeRows(people, graph, filteredRecords, filteredLinks, ctx) {
  const sourceRecords = new Map();
  const subjectRecords = new Map();
  for (const edge of graph.edges || []) {
    if (!String(edge.from || '').startsWith('player:')) continue;
    const id = edge.from.slice(7);
    const target = edge.kind === 'source' ? sourceRecords : subjectRecords;
    const set = target.get(id) || new Set();
    set.add(edge.to); target.set(id, set);
  }
  const filteredIds = new Set(filteredRecords.map(r => r.id));
  const byPlayer = new Map(people.map(p => [p.id, filteredRecords.filter(r => (r.people || []).includes(p.id))]));
  return people.map(person => {
    const records = byPlayer.get(person.id) || [];
    const allForPlayer = (graph.records || []).filter(r => (r.people || []).includes(person.id));
    const givenSet = sourceRecords.get(person.id) || new Set();
    const receivedSet = subjectRecords.get(person.id) || new Set(records.map(r => r.id));
    const cluesGiven = [...givenSet].filter(id => filteredIds.has(id) && CLUE_TYPES.has(filteredRecords.find(r => r.id === id)?.type)).length;
    const cluesReceived = [...receivedSet].filter(id => filteredIds.has(id) && CLUE_TYPES.has(filteredRecords.find(r => r.id === id)?.type)).length;
    const votesCast = filteredLinks.filter(l => l.kind === 'voted' && l.from === person.id).reduce((n, l) => n + l.weight, 0);
    const votesReceived = filteredLinks.filter(l => l.kind === 'voted' && l.to === person.id).reduce((n, l) => n + l.weight, 0);
    const nominationsMade = filteredLinks.filter(l => l.kind === 'nominated' && l.from === person.id).reduce((n, l) => n + l.weight, 0);
    const nominationsReceived = filteredLinks.filter(l => l.kind === 'nominated' && l.to === person.id).reduce((n, l) => n + l.weight, 0);
    const hypotheses = records.filter(r => r.type === 'hypothesis' || r.type === 'restriction').length;
    const claim = latestClaim(allForPlayer);
    return {
      ...person,
      latestClaim: claim ? { id: claim.id, roleIds: claim.roleIds || [], roles: (claim.roleIds || []).map(id => roleNameFrom(ctx, id)), text: claim.text || '' } : null,
      counts: { cluesGiven, cluesReceived, votesCast, votesReceived, nominationsMade, nominationsReceived, hypotheses, records: records.length },
      probabilities: probabilitySummary(person.id, ctx)
    };
  });
}

function relationPasses(link, filteredRecordIds, state, peopleById) {
  if (state.selectedPlayer && link.from !== state.selectedPlayer && link.to !== state.selectedPlayer) return false;
  if (link.refs?.length && !link.refs.some(ref => filteredRecordIds.has(ref) || String(ref).split('|').some(part => filteredRecordIds.has(part)))) return false;
  const q = fold(state.query);
  if (!q) return true;
  return fold(`${link.kind} ${link.label || ''} ${peopleById.get(link.from)?.name || ''} ${peopleById.get(link.to)?.name || ''}`).includes(q);
}

export function buildBoardModel(gameArg, ctxArg = {}) {
  const game = gameArg || ctxArg.game || { players: [], archivedPlayers: [], records: [] };
  const lang = ctxArg.lang === 'en' ? 'en' : 'fr';
  const state = {...boardState, ...(ctxArg.state || {})};
  if (!LENSES.includes(state.lens)) state.lens = 'matrix';
  const ctx = {...ctxArg, game, lang};
  // Public posture default: the probabilistic tool stays visible unless the caller explicitly locks it
  // (showModel:false). Normalised once here so every downstream consumer (predictionCell,
  // probabilitySummary, buildCharacterGridModel, renderMatrix/renderCharacterGrid) sees a real boolean.
  ctx.showModel = ctx.showModel !== false;
  const graph = safeInvestigation(game);
  const relations = safeRelations(game, graph);
  const people = peopleForBoard(game, graph, relations);
  const peopleById = new Map(people.map(p => [p.id, p]));
  const allRecords = (graph.records || []).filter(r => !r.archived || (r.people || []).some(id => peopleById.has(id))).map(r => ({...r}));
  const filteredRecords = allRecords.filter(r => recordMatches(r, state, peopleById, ctx)).sort(sortRecords);
  const filteredRecordIds = new Set(filteredRecords.map(r => r.id));
  const links = (relations.links || []).filter(l => l.from !== l.to && peopleById.has(l.from) && peopleById.has(l.to));
  const filteredLinks = links.filter(l => relationPasses(l, filteredRecordIds, state, peopleById));
  const phases = uniq(allRecords.filter(r => r.phase && r.day).sort(sortRecords).map(r => `${r.phase}:${r.day}`));
  const rows = makeRows(people, graph, filteredRecords, filteredLinks, ctx);
  const neighbours = seatNeighbours(people);
  for (const row of rows) row.neighbours = neighbours[row.id] || { left: null, right: null };
  const hidden = {
    byFilters: allRecords.length - filteredRecords.length,
    roundLinks: Math.max(0, filteredLinks.length - MAX_ROUND_LINKS)
  };
  const model = {
    lang, state, people, peopleById: Object.fromEntries(peopleById), rows, graph: {...graph, records: allRecords}, relations: {nodes: people, links},
    filteredRecords, filteredLinks, roundLinks: filteredLinks.slice(0, MAX_ROUND_LINKS), phases, hidden, neighbours, ctx, showModel: ctx.showModel,
    prediction: ctx.prediction?.result ? { reliable: !!ctx.prediction.result.reliable, method: ctx.prediction.result.method || '', halfWidth: ctx.prediction.result.halfWidth || null } : null
  };
  // characterGrid/contradictions are 18-43ms to build and only matter for the grille/conflits lenses (or a
  // persisted cell selection). Compute them lazily so matrix/round/timeline renders never pay that cost.
  // Each getter self-replaces with a plain memoized value on first read, so it only ever runs once.
  lazyModelField(model, 'characterGrid', () => buildCharacterGridModel(game, ctx, people, allRecords));
  lazyModelField(model, 'contradictions', () => buildContradictionModel(game, ctx, people, allRecords));
  return model;
}

function lazyModelField(model, key, compute) {
  Object.defineProperty(model, key, {
    configurable: true,
    enumerable: true,
    get() {
      const value = compute();
      Object.defineProperty(model, key, { value, enumerable: true, configurable: true, writable: false });
      return value;
    }
  });
}

function phaseOptions(model) {
  return model.phases.map(key => {
    const [phase, day] = key.split(':');
    return `<option value="${attr(key)}" ${model.state.phase === key ? 'selected' : ''}>${escapeHtml(phaseLabel({phase, day}, model.lang))}</option>`;
  }).join('');
}

function controls(model) {
  const lang = model.lang;
  const selected = model.people.find(p => p.id === model.state.selectedPlayer);
  // Only touch model.characterGrid (lazy, 18-43ms to build) when a grid cell is actually selected;
  // matrix/round/timeline renders with no selected role must never trigger that computation.
  const selectedRole = model.state.selectedRole ? model.characterGrid.columns.find(c => c.id === model.state.selectedRole) : null;
  const selectedCell = selected && selectedRole
    ? model.characterGrid.rows.find(r => r.id === selected.id)?.cells.find(c => c.roleId === selectedRole.id)
    : null;
  const selectedText = selectedCell
    ? `${t('cellSelected', lang)}: ${selected.name} · ${selectedRole.name}${selectedCell.probability?.marginPercent != null ? ` · ${t('margin', lang)} ±${selectedCell.probability.marginPercent}%` : ''}`
    : `${t('selected', lang)}: ${selected?.name || t('none', lang)}`;
  const analyticValue = ANALYTIC_LENSES.includes(model.state.lens) ? model.state.lens : '';
  // L en-tete disait trois fois la meme chose : le h1 de la page annonce deja
  // « Le tableau », et le bouton de lentille actif annonce deja la lentille.
  // Le h2 reste pour les lecteurs d ecran, qui ont besoin du niveau
  // intermediaire pour naviguer, mais disparait a l oeil ou il faisait doublon.
  return `<section class="board-panel board-controls" aria-label="${attr(t('title', lang))}">
    <h2 class="sr-only">${escapeHtml(t(model.state.lens, lang))}</h2>
    <div class="board-lens-economy">
      <div class="board-lenses" role="tablist" aria-label="${attr(t('title', lang))}">${PRIMARY_LENSES.map(lens => `<button type="button" role="tab" data-board-lens="${attr(lens)}" aria-selected="${model.state.lens === lens}" class="${model.state.lens === lens ? 'active' : ''}">${escapeHtml(t(lens, lang))}</button>`).join('')}</div>
      <label class="board-analytic-select">${escapeHtml(t('analytical', lang))}<select data-board-analytic aria-label="${attr(t('analytical', lang))}"><option value="">${escapeHtml(t('analytical', lang))}</option>${ANALYTIC_LENSES.map(lens => `<option value="${attr(lens)}" ${analyticValue === lens ? 'selected' : ''}>${escapeHtml(t(lens, lang))}</option>`).join('')}</select></label>
    </div>
    <div class="board-filter-grid">
      <label>${escapeHtml(t('phase', lang))}<select data-board-phase><option value="">${escapeHtml(t('allGame', lang))}</option>${phaseOptions(model)}</select></label>
      <label>${escapeHtml(t('search', lang))}<input data-board-query type="search" value="${attr(model.state.query)}" placeholder="${attr(t('searchPh', lang))}"></label>
      ${selected ? `<div class="board-selection"><span class="chip accent">${escapeHtml(selectedText)}</span><button type="button" data-board-clear>${escapeHtml(t('clearSelection', lang))}</button></div>` : ''}
      <button type="button" data-board-reset>${escapeHtml(t('reset', lang))}</button>
    </div>
    ${model.hidden.byFilters ? `<p class="muted">${model.hidden.byFilters} ${escapeHtml(t('hiddenByFilters', lang))}</p>` : ''}
  </section>`;
}


function neighboursHtml(neighbours, lang) {
  const left = neighbours?.left ? `#${neighbours.left.seat} ${neighbours.left.name}` : t('none', lang);
  const right = neighbours?.right ? `#${neighbours.right.seat} ${neighbours.right.name}` : t('none', lang);
  return `<span class="board-neighbours"><strong>${escapeHtml(t('currentNeighbours', lang))}</strong> <span>${escapeHtml(t('leftNeighbour', lang))}: ${escapeHtml(left)}</span> <span>${escapeHtml(t('rightNeighbour', lang))}: ${escapeHtml(right)}</span></span>`;
}





function roundLayout(total) {
  if (total >= 18) return { size: 720, center: 360, radius: 294, node: 24, showNames: false, nameChars: 0, seatFont: 16, nameFont: 0 };
  if (total >= 15) return { size: 700, center: 350, radius: 282, node: 26, showNames: false, nameChars: 0, seatFont: 16, nameFont: 0 };
  if (total >= 12) return { size: 680, center: 340, radius: 268, node: 28, showNames: true, nameChars: 4, seatFont: 15, nameFont: 10 };
  if (total >= 9) return { size: 660, center: 330, radius: 250, node: 32, showNames: true, nameChars: 7, seatFont: 16, nameFont: 11 };
  return { size: 640, center: 320, radius: 228, node: 38, showNames: true, nameChars: 12, seatFont: 17, nameFont: 12 };
}

function truncateLabel(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

const CHORD_KIND_KEY = { told: 'kindTold', voted: 'kindVoted', nominated: 'kindNominated', paired: 'kindPaired', conflict: 'kindConflict' };


// drifts from what is drawn. Chords are decorative (aria-hidden) and unfocusable by design: making hundreds of
// SVG paths keyboard-focusable would be worse for a screen-reader user than one <details> list they can Tab to
// and expand once, so this <details>/<summary> (native, no ARIA needed) is the reachable equivalent instead.


function recordSummary(record, model) {
  const lang = model.lang;
  const people = (record.people || []).map(id => model.peopleById[id]?.name || id).join(', ') || t('general', lang);
  const roles = (record.roleIds || []).map(id => roleNameFrom(model.ctx || {lang, game: {}}, id)).join(' / ');
  const text = record.relation && typeof investigation.describeRelation === 'function'
    ? investigation.describeRelation(record.relation, id => model.peopleById[id]?.name || id, id => roleNameFrom(model.ctx || {lang, game: {}}, id), lang)
    : (roles || record.text || '');
  return { people, roles, text };
}

function renderTimeline(model) {
  const lang = model.lang;
  const dated = model.filteredRecords.filter(r => r.day && r.phase).sort(sortRecords);
  const groups = new Map();
  for (const record of dated) {
    const key = `${record.phase}:${record.day}`;
    const group = groups.get(key) || [];
    group.push(record); groups.set(key, group);
  }
  return `<section class="board-panel"><p class="muted">${escapeHtml(t('chronologicalHelp', lang))}</p><div class="board-timeline">${dated.length ? [...groups].map(([key, records]) => {
    const [phase, day] = key.split(':');
    return `<section class="board-phase"><h3>${escapeHtml(phaseLabel({phase, day}, lang))}</h3>${records.map(r => { const s = recordSummary(r, model); return `<button type="button" data-board-record="${attr(r.id)}" class="board-event"><small>${escapeHtml(recordTypeLabel(r.type, lang))} · ${escapeHtml(s.people)}</small><span>${escapeHtml(s.text || r.text)}</span></button>`; }).join('')}</section>`;
  }).join('') : `<p class="empty">${escapeHtml(t('noRecords', lang))}</p>`}</div></section>`;
}

// Exported so tests can assert the cap without a DOM: with 20 players / 480 events this used to enumerate
// every graph edge (3 224 in the measured case) straight into HTML on every click. Now bounded to `limit`
// (default MAX_LINK_ROWS), with the true total reported separately so the UI can say what's hidden.
export function buildLinksModel(model, limit = MAX_LINK_ROWS) {
  const records = new Map(model.filteredRecords.map(r => [r.id, r]));
  const edgeList = (model.graph.edges || []).filter(e => records.has(e.to) || records.has(e.from));
  const total = edgeList.length;
  const rows = edgeList.slice(0, Math.max(0, limit)).map(e => {
    const rec = records.get(e.to) || records.get(e.from);
    if (!rec) return null;
    const from = String(e.from).startsWith('player:') ? model.peopleById[String(e.from).slice(7)]?.name || String(e.from).slice(7) : e.from;
    const to = e.to === 'model' ? t('model', model.lang) : e.to;
    return { from, record: rec, to, kind: e.kind };
  }).filter(Boolean);
  return { rows, total, hidden: Math.max(0, total - rows.length) };
}

function renderLinks(model) {
  const lang = model.lang;
  const limit = model.state.linksLimit || MAX_LINK_ROWS;
  const { rows, hidden } = buildLinksModel(model, limit);
  const more = hidden ? `<p class="notice warning">${hidden} ${escapeHtml(t('linksTruncated', lang))} <button type="button" data-board-links-more>${escapeHtml(t('showMoreLinks', lang))}</button></p>` : '';
  return `<section class="board-panel"><p class="muted">${escapeHtml(t('derivationHelp', lang))}</p>${more}<div class="board-links-scroll" tabindex="0" aria-label="${attr(t('links', lang))}"><table class="board-links-table"><thead><tr><th>${escapeHtml(t('from', lang))}</th><th>${escapeHtml(t('record', lang))}</th><th>${escapeHtml(t('to', lang))}</th><th>${escapeHtml(t('effect', lang))}</th></tr></thead><tbody>${rows.length ? rows.map(row => { const s = recordSummary(row.record, model); return `<tr><td>${escapeHtml(row.from)}</td><td><button type="button" class="board-plain" data-board-record="${attr(row.record.id)}"><strong>${escapeHtml(recordTypeLabel(row.record.type, lang))} ${row.record.day ? '· ' + escapeHtml(phaseLabel(row.record, lang)) : ''}</strong><small>${escapeHtml(s.text || row.record.text)}</small></button></td><td>${escapeHtml(row.to)}</td><td><span class="chip ${row.kind === 'source' ? '' : 'accent'}">${escapeHtml(row.kind)}</span></td></tr>`; }).join('') : `<tr><td colspan="4">${escapeHtml(t('noRecords', lang))}</td></tr>`}</tbody></table></div></section>`;
}

function cellIntensity(probability) {
  if (!probability) return 'claim';
  if (probability.value >= .75) return 'p4';
  if (probability.value >= .5) return 'p3';
  if (probability.value >= .25) return 'p2';
  if (probability.value > 0) return 'p1';
  return 'p0';
}

function cellText(cell, lang) {
  if (cell.probability) {
    const margin = cell.probability.marginPercent == null ? '' : ` · ${t('margin', lang)} ±${cell.probability.marginPercent}%`;
    return `${cell.probability.percent}%${margin}`;
  }
  if (cell.claimed) return '✓';
  if (cell.claimedBy.length) return cell.claimedBy.map(p => `#${p.seat}`).join(', ');
  return '—';
}

function cellAria(cell, lang) {
  const base = `${cell.playerName}, ${cell.roleName}`;
  const claim = cell.claimed ? `, ${t('claimedBy', lang)} ${cell.playerName}` : cell.claimedBy.length ? `, ${t('claimedBy', lang)} ${cell.claimedBy.map(p => p.name).join(', ')}` : `, ${t('unclaimed', lang)}`;
  const prob = cell.probability ? `, ${cell.probability.percent}%${cell.probability.marginPercent == null ? '' : `, ${t('margin', lang)} ${cell.probability.marginPercent}%`}` : '';
  return `${base}${prob}${claim}`;
}

function renderCharacterGrid(model) {
  const lang = model.lang, showModel = model.showModel !== false;
  const grid = model.characterGrid;
  const head = grid.columns.map(c => `<th title="${attr(c.name)}">${escapeHtml(truncateLabel(c.name, 16))}</th>`).join('');
  const rows = grid.rows.map(row => `<tr><th><button type="button" class="board-plain" data-board-person="${attr(row.id)}"><strong>#${row.seat} ${escapeHtml(row.name)}</strong><small>${neighboursHtml(row.neighbours, lang)}</small></button></th>${row.cells.map(cell => `<td><button type="button" class="board-grid-cell ${cellIntensity(cell.probability)} ${cell.claimed ? 'claimed' : ''}" data-board-cell-player="${attr(cell.playerId)}" data-board-cell-role="${attr(cell.roleId)}" aria-label="${attr(cellAria(cell, lang))}"><span>${escapeHtml(cellText(cell, lang))}</span></button></td>`).join('')}</tr>`).join('');
  const cards = grid.rows.map(row => `<article class="board-grid-card"><h3>#${row.seat} ${escapeHtml(row.name)}</h3>${neighboursHtml(row.neighbours, lang)}<div>${row.cells.map(cell => `<button type="button" class="board-grid-card-cell ${cellIntensity(cell.probability)} ${cell.claimed ? 'claimed' : ''}" data-board-cell-player="${attr(cell.playerId)}" data-board-cell-role="${attr(cell.roleId)}" aria-label="${attr(cellAria(cell, lang))}"><strong>${escapeHtml(cell.roleName)}</strong><span>${escapeHtml(cellText(cell, lang))}</span></button>`).join('')}</div></article>`).join('');
  const unclaimed = grid.unclaimedCharacters.length
    ? `<section class="board-unclaimed"><h3>${escapeHtml(t('unclaimedCharacters', lang))}</h3><p>${grid.unclaimedCharacters.map(c => escapeHtml(c.name)).join(', ')}</p></section>`
    : '';
  // Locked posture: cell.probability is already null (predictionCell gates on showModel), so cells fall
  // back to claim-only text/intensity. The "unreliable prediction" notice would still name-drop the model
  // concept in prose, so it is suppressed here too rather than left as a half-measure.
  return `<section class="board-panel board-grid-lens" aria-label="${attr(t('grille', lang))}"><p class="muted">${escapeHtml(t('gridHelp', lang))}</p>${!showModel || grid.reliable ? '' : `<p class="notice warning">${escapeHtml(t('noReliablePrediction', lang))}</p>`}<div class="board-character-grid-scroll" tabindex="0"><table class="board-character-grid"><thead><tr><th>${escapeHtml(t('tableSeat', lang))}</th>${head}</tr></thead><tbody>${rows}</tbody></table></div><div class="board-grid-cards">${cards}</div>${unclaimed}</section>`;
}

function renderContradictions(model) {
  const lang = model.lang;
  const entries = model.contradictions.entries;
  const item = entry => {
    if (entry.type === 'engine') return `<li><strong>${escapeHtml(t('engineConflict', lang))}</strong><p>${escapeHtml(entry.message)}</p><small>${escapeHtml(t('conflictCaution', lang))}</small></li>`;
    const players = (entry.players || []).map(p => `#${p.seat} ${p.name}`).join(' / ');
    const capacity = entry.type === 'over-claimed' ? ` (${escapeHtml(t('capacity', lang))}: ${escapeHtml(String(entry.capacity))})` : '';
    return `<li><strong>${escapeHtml(entry.roleName)}${capacity}</strong><p>${escapeHtml(players)} — ${escapeHtml(entry.message)}</p><small>${escapeHtml(t('conflictCaution', lang))}</small></li>`;
  };
  return `<section class="board-panel board-conflicts" aria-label="${attr(t('conflits', lang))}"><p class="muted">${escapeHtml(t('conflictsHelp', lang))}</p>${entries.length ? `<ul>${entries.map(item).join('')}</ul>` : `<p class="empty">${escapeHtml(t('noContradictions', lang))}</p>`}</section>`;
}

function renderLens(model) {
  if (model.state.lens === 'grille') return renderCharacterGrid(model);
  if (model.state.lens === 'conflits') return renderContradictions(model);
  if (model.state.lens === 'links') return renderLinks(model);
  return renderTimeline(model);
}

export function resetBoard() {
  Object.assign(boardState, { lens: 'timeline', selectedPlayer: '', selectedRole: '', phase: '', query: '', linksLimit: MAX_LINK_ROWS });
}

export function renderBoard(container, ctx = {}) {
  const model = buildBoardModel(ctx.game, ctx);
  model.ctx = ctx;
  container.innerHTML = `<div class="board-root">${controls(model)}${renderLens(model)}</div>`;
  const rerender = () => renderBoard(container, ctx);
  if (container.__boardClick) container.removeEventListener('click', container.__boardClick);
  if (container.__boardInput) container.removeEventListener('input', container.__boardInput);
  if (container.__boardChange) container.removeEventListener('change', container.__boardChange);
  if (container.__boardKey) container.removeEventListener('keydown', container.__boardKey);
  container.__boardClick = event => {
    const el = event.target.closest('[data-board-lens],[data-board-person],[data-board-cell-player],[data-board-record],[data-board-open-player],[data-board-clear],[data-board-reset],[data-board-links-more]');
    if (!el || !container.contains(el)) return;
    if (el.dataset.boardLens) boardState.lens = LENSES.includes(el.dataset.boardLens) ? el.dataset.boardLens : 'matrix';
    else if (el.dataset.boardCellPlayer) { boardState.selectedPlayer = el.dataset.boardCellPlayer; boardState.selectedRole = el.dataset.boardCellRole || ''; }
    else if (el.dataset.boardPerson) { boardState.selectedPlayer = boardState.selectedPlayer === el.dataset.boardPerson ? '' : el.dataset.boardPerson; boardState.selectedRole = ''; boardState.linksLimit = MAX_LINK_ROWS; }
    else if (el.dataset.boardRecord && typeof ctx.openRecord === 'function') ctx.openRecord(el.dataset.boardRecord);
    else if (el.dataset.boardOpenPlayer && typeof ctx.openPlayer === 'function') ctx.openPlayer(el.dataset.boardOpenPlayer);
    else if (el.hasAttribute('data-board-clear')) { boardState.selectedPlayer = ''; boardState.selectedRole = ''; boardState.linksLimit = MAX_LINK_ROWS; }
    else if (el.hasAttribute('data-board-reset')) resetBoard();
    else if (el.hasAttribute('data-board-links-more')) boardState.linksLimit = (boardState.linksLimit || MAX_LINK_ROWS) + MAX_LINK_ROWS;
    rerender();
  };
  container.__boardInput = event => { if (event.target.matches('[data-board-query]')) { boardState.query = event.target.value; boardState.linksLimit = MAX_LINK_ROWS; rerender(); } };
  container.__boardChange = event => {
    if (event.target.matches('[data-board-phase]')) { boardState.phase = event.target.value; boardState.linksLimit = MAX_LINK_ROWS; rerender(); }
    else if (event.target.matches('[data-board-analytic]') && LENSES.includes(event.target.value)) { boardState.lens = event.target.value; rerender(); }
  };
  container.__boardKey = event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('svg [role="button"][data-board-person]')) {
      event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  };
  container.addEventListener('click', container.__boardClick);
  container.addEventListener('input', container.__boardInput);
  container.addEventListener('change', container.__boardChange);
  container.addEventListener('keydown', container.__boardKey);
  return model;
}




