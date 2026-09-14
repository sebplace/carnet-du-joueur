import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame, validateGame} from '../js/state.js';
import {buildRelations} from '../js/investigation.js';
import {buildPlanModel, renderPlan} from '../js/plan.js';

const SCRIPT = {name: 'X', roleIds: ['chef', 'empath', 'monk', 'poisoner', 'imp'], customRoles: [], warnings: []};

function linkedGame() {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloé', 'David', 'Emma']);
  const [a, b, c, d] = g.players;
  g.claims = [{id: 'c1', playerId: a.id, sourceId: b.id, roleIds: ['chef'], note: 'x', day: 1, phase: 'day', visibility: 'private', weight: 1}];
  g.events = [{id: 'e1', type: 'execution', playerIds: [a.id], sourceId: c.id, roleId: '', text: 'vote', value: '', day: 1, phase: 'day', aliveSnapshot: [], ballot: [{playerId: d.id, choice: 'yes', weight: 1}], outcome: 'unknown', complete: false, influence: {roleIds: [], multiplier: 1, demonOnly: false, stable: false}}];
  return validateGame(g);
}

function render(game, opts = {}) {
  const model = buildPlanModel(game, opts);
  return {model, svg: renderPlan(model, {lang: 'fr', roleName: id => id, ...opts})};
}

test('1. no selection draws zero connection paths', () => {
  const {svg} = render(linkedGame(), {selectedId: ''});
  assert.ok(!svg.includes('plan-chord'), 'no chord path when nothing is selected');
  assert.ok(svg.includes('plan-seat'), 'seats are still drawn');
});

test('2. selecting a seat shows exactly that seat\'s links', () => {
  const g = linkedGame();
  const sel = g.players[0].id;
  const {model} = render(g, {selectedId: sel});
  const expected = buildRelations(g).links.filter(l => l.from === sel || l.to === sel).length;
  assert.ok(expected > 0, 'fixture produced links for the selected player');
  assert.equal(model.links.length, expected);
  assert.ok(model.links.every(l => l.from === sel || l.to === sel));
  const other = g.players[4].id;
  const otherModel = buildPlanModel(g, {selectedId: other});
  assert.equal(otherModel.links.length, buildRelations(g).links.filter(l => l.from === other || l.to === other).length);
});

test('3. seat 1 is at the top and seats run clockwise', () => {
  const {model} = render(linkedGame(), {size: 320});
  const s1 = model.seats[0], s2 = model.seats[1];
  assert.equal(s1.seat, 1);
  assert.ok(Math.abs(s1.x - model.center) < 0.01, 'seat 1 x is centred');
  assert.ok(s1.y < model.center - model.radius + 0.01, 'seat 1 sits at the top');
  assert.ok(s2.x > model.center, 'seat 2 moves clockwise to the right');
  assert.ok(s2.y > s1.y, 'seat 2 is lower than seat 1');
});

test('4. hostile player names are escaped, never raw tags', () => {
  const g = newGame(SCRIPT, ['<img src=x onerror=alert(1)>', 'Bruno', 'Chloé', 'David', 'Emma']);
  const {svg} = render(validateGame(g), {selectedId: g.players[0].id});
  assert.ok(!svg.includes('<img src=x'), 'no raw injected tag');
  assert.ok(svg.includes('&lt;img src=x onerror=alert(1)&gt;'), 'name appears escaped');
});

test('5. state markers are distinct and not colour-only', () => {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloé', 'David', 'Emma']);
  g.players[0].trust = 'suspect';
  g.players[1].alive = false; g.players[1].ghost = true; g.players[1].trust = 'watch';
  g.players[2].alive = false; g.players[2].ghost = false; g.players[2].trust = 'trusted';
  g.players[3].traveller = true; g.players[3].trust = 'unknown';
  const clean = validateGame(g);
  const {svg} = render(clean, {selectedId: ''});
  assert.match(svg, /data-me="true"/);
  assert.match(svg, /data-traveller="true"/);
  assert.match(svg, /data-alive="false"[^>]*data-ghost="true"/);
  assert.ok(svg.includes('plan-dead-cross'), 'dead seats carry a shape marker, not only dimming');
  for (const trust of ['unknown', 'trusted', 'watch', 'suspect']) {
    assert.ok(svg.includes(`data-trust="${trust}"`), `trust ${trust} has an assertable marker`);
    assert.ok(svg.includes(`plan-trust-${trust}`));
  }
});

test('6. twenty players make twenty distinct seats with unique positions', () => {
  const names = Array.from({length: 20}, (_, i) => `J${i + 1}`);
  const g = validateGame(newGame(SCRIPT, names));
  const {model, svg} = render(g, {size: 320});
  assert.equal(model.seats.length, 20);
  const ids = new Set((svg.match(/data-plan-seat="[^"]+"/g) || []));
  assert.equal(ids.size, 20, 'twenty distinct seat handles rendered');
  const coords = new Set(model.seats.map(s => `${s.x.toFixed(2)},${s.y.toFixed(2)}`));
  assert.equal(coords.size, 20, 'no two seats share a position');
});

test('tap target is at least 44px at a 320px dial', () => {
  const {model, svg} = render(linkedGame(), {size: 320});
  assert.ok(model.hit >= 44, 'hit area is 44 units in a 320 viewBox');
  assert.match(svg, /class="plan-hit"[^>]*width="44\.0"/);
});

test('name font never drops below the 14px dim-room floor', () => {
  for (const n of [5, 7, 9, 10]) {
    const names = Array.from({length: n}, (_, i) => `Name${i}`);
    const {svg} = render(validateGame(newGame(SCRIPT, names)), {size: 320});
    const fonts = [...svg.matchAll(/class="plan-seat-name"[^>]*font-size:([\d.]+)px/g)];
    assert.ok(fonts.length === n, `${n} players show all names`);
    for (const f of fonts) assert.ok(parseFloat(f[1]) >= 14, `${n} players: name font ${f[1]} below 14`);
  }
});

test('names disappear cleanly past ten players instead of shrinking', () => {
  const shown = render(validateGame(newGame(SCRIPT, Array.from({length: 10}, (_, i) => `P${i}`))), {}).svg;
  assert.ok(shown.includes('plan-seat-name'), 'ten players keep names');
  const hidden = render(validateGame(newGame(SCRIPT, Array.from({length: 11}, (_, i) => `P${i}`))), {}).svg;
  assert.ok(!hidden.includes('plan-seat-name'), 'eleven players drop names');
  assert.ok(hidden.includes('plan-seat-mark'), 'hidden-name discs keep the compact glyph cue');
});

test('ghost vote state carries a dedicated class, available vs spent', () => {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloé', 'David', 'Emma']);
  g.players[1].alive = false; g.players[1].ghost = true;
  g.players[2].alive = false; g.players[2].ghost = false;
  const {svg} = render(validateGame(g), {});
  assert.ok(svg.includes('plan-ghost-available'), 'a dead player who can still vote is marked available');
  assert.ok(svg.includes('plan-ghost-spent'), 'a dead player who spent the vote is marked spent');
  assert.ok(!/plan-alive[^"]*plan-ghost/.test(svg), 'living players get no ghost class');
});

function spokeGame() {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloé', 'David', 'Emma']);
  const [a, b, c, d, e] = g.players;
  g.claims = [
    {id: 'c1', playerId: a.id, sourceId: b.id, roleIds: ['chef'], note: 'x', day: 1, phase: 'day', visibility: 'private', weight: 1},
    {id: 'c2', playerId: d.id, sourceId: d.id, roleIds: ['chef'], note: 'x', day: 1, phase: 'day', visibility: 'private', weight: 1}
  ];
  g.events = [{id: 'e1', type: 'execution', playerIds: [c.id], sourceId: a.id, roleId: '', text: 'nom', value: '', day: 1, phase: 'day', aliveSnapshot: [], ballot: [], outcome: 'unknown', complete: false, influence: {roleIds: [], multiplier: 1, demonOnly: false, stable: false}}];
  g.scenarios[0].constraints = [{id: 'p1', kind: 'group', players: [a.id, e.id], roleIds: ['imp'], anchor: '', min: 1, max: 1, note: 'pair', enabled: true, provenance: 'hunch', fragile: false}];
  return {game: validateGame(g), selected: a.id};
}

test('multiple chord labels are spread out, never stacked on one point', () => {
  const {game, selected} = spokeGame();
  const {model, svg} = render(game, {selectedId: selected});
  assert.ok(model.links.length >= 4, 'selected seat fans out to several links');
  const labels = [...svg.matchAll(/class="plan-chord-label"[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"/g)].map(m => `${m[1]},${m[2]}`);
  assert.ok(labels.length >= 3, 'at least three chord labels drawn');
  assert.equal(new Set(labels).size, labels.length, 'every chord label sits at a distinct position');
});

// Sebastien, sur la 1.8 publiee : « difficile de comprendre au premier coup d'oeil
// ce qui a ete communique ou ce qui cause le conflit ». Les liens doivent porter la
// substance, pas seulement la categorie.

function conflictGame() {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloe', 'David', 'Emma']);
  const [a, b] = g.players;
  g.claims = [
    {id: 'c1', playerId: a.id, sourceId: a.id, roleIds: ['empath'], note: '', day: 1, phase: 'day', visibility: 'private', weight: 1},
    {id: 'c2', playerId: b.id, sourceId: b.id, roleIds: ['empath'], note: '', day: 1, phase: 'day', visibility: 'private', weight: 1}
  ];
  g.events = [];
  return validateGame(g);
}

const ROLE_NAMES = {empath: 'Empathe', chef: 'Chef'};

test('12. a conflict states its cause with the resolved role name, never the raw id', () => {
  const g = conflictGame();
  const sel = g.players[0].id;
  const svg = renderPlan(buildPlanModel(g, {selectedId: sel}), {lang: 'fr', roleName: id => ROLE_NAMES[id] || id, selectedId: sel});
  assert.ok(svg.includes('revendiquent tous deux Empathe'), 'the cause of the conflict is spelled out');
  assert.ok(!/plan-link-text[^<]*>[^<]*\bempath\b/.test(svg), 'the raw role id never reaches the reader');
});

test('13. a link without a role never fabricates "X est <verbatim>"', () => {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloe', 'David', 'Emma']);
  const [a, b] = g.players;
  g.claims = [];
  g.events = [{id: 'e9', type: 'info', playerIds: [a.id], sourceId: b.id, roleId: '', text: 'Bruno me dit avoir recu 1.', value: '', day: 1, phase: 'day', aliveSnapshot: [], ballot: [], outcome: 'unknown', complete: false, influence: {roleIds: [], multiplier: 1, demonOnly: false, stable: false}}];
  const game = validateGame(g);
  const sel = a.id;
  const svg = renderPlan(buildPlanModel(game, {selectedId: sel}), {lang: 'fr', roleName: id => ROLE_NAMES[id] || id, selectedId: sel});
  assert.ok(!svg.includes('est Bruno me dit'), 'free text is never injected into a role sentence');
  assert.ok(svg.includes('plan-link-note'), 'the verbatim is shown as its own secondary line');
  assert.ok(svg.includes('Bruno me dit avoir recu 1.'), 'the verbatim itself is readable');
});

test('14. the panel names the selected seat and the legend decodes the lines', () => {
  const g = conflictGame();
  const sel = g.players[0].id;
  const svg = renderPlan(buildPlanModel(g, {selectedId: sel}), {lang: 'fr', roleName: id => ROLE_NAMES[id] || id, selectedId: sel});
  assert.ok(svg.includes('Liens d\u2019Alice'), 'the heading says whose links these are, correctly elided');
  const single = (svg.match(/plan-legend/g) || []).length;
  assert.equal(single, 0, 'no legend when a single kind of link is on screen');
});

test('15. French elision, because "de Alice" is a mistake repeated on every row', () => {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloe', 'David', 'Emma']);
  const [a, b] = g.players;
  g.claims = [];
  g.events = [{id: 'e8', type: 'info', playerIds: [a.id], sourceId: b.id, roleId: '', text: 'note', value: '', day: 1, phase: 'day', aliveSnapshot: [], ballot: [], outcome: 'unknown', complete: false, influence: {roleIds: [], multiplier: 1, demonOnly: false, stable: false}}];
  const game = validateGame(g);
  const svg = renderPlan(buildPlanModel(game, {selectedId: a.id}), {lang: 'fr', roleName: id => id, selectedId: a.id});
  assert.ok(svg.includes('d\u2019Alice'), 'vowel initial takes the elided form');
  assert.ok(!svg.includes('de Alice'), 'the unelided form never appears');
});

test('16. the dial label carries the role, not a truncated sentence', () => {
  const g = conflictGame();
  const sel = g.players[0].id;
  const svg = renderPlan(buildPlanModel(g, {selectedId: sel}), {lang: 'fr', roleName: id => ROLE_NAMES[id] || id, selectedId: sel});
  const label = svg.match(/<text class="plan-chord-label"[^>]*>([^<]*)</);
  assert.ok(label, 'a chord label is drawn');
  assert.equal(label[1], 'Empathe');
});


test('17. two links on the same pair never stack their labels', () => {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloe', 'David', 'Emma']);
  const [a, b] = g.players;
  // Deux liens sur la meme paire : Alice parle de Bruno, puis vote contre lui.
  g.claims = [{id: 'k3', playerId: b.id, sourceId: a.id, roleIds: ['chef'], note: '', day: 1, phase: 'day', visibility: 'private', weight: 1}];
  g.events = [{id: 'v1', type: 'execution', playerIds: [b.id], sourceId: '', roleId: '', text: '', value: '', day: 1, phase: 'day', aliveSnapshot: [], ballot: [{playerId: a.id, choice: 'yes', weight: 1}], outcome: 'unknown', complete: false, influence: {roleIds: [], multiplier: 1, demonOnly: false, stable: false}}];
  const game = validateGame(g);
  const svg = renderPlan(buildPlanModel(game, {selectedId: a.id, size: 320}), {lang: 'fr', roleName: id => ROLE_NAMES[id] || id, selectedId: a.id});
  const labels = [...svg.matchAll(/<text class="plan-chord-label"[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*style="font-size:([\d.]+)px"[^>]*>([^<]*)</g)]
    .map(m => ({x: +m[1], y: +m[2], font: +m[3], text: m[4]}));
  assert.ok(labels.length >= 2, 'fixture produced at least two labels');
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const A = labels[i], B = labels[j];
    const wA = Math.max(A.font, 0.56 * A.font * A.text.length), wB = Math.max(B.font, 0.56 * B.font * B.text.length);
    const dx = Math.min(A.x + wA / 2, B.x + wB / 2) - Math.max(A.x - wA / 2, B.x - wB / 2);
    const dy = Math.min(A.y + A.font * 0.6, B.y + B.font * 0.6) - Math.max(A.y - A.font * 0.6, B.y - B.font * 0.6);
    assert.ok(!(dx > 0 && dy > 0), `labels "${A.text}" and "${B.text}" overlap`);
  }
});

// Sebastien, sur la 1.9 publiee : « que signifie le dit qui apparait sur le
// schema ? ». Le cadran disait « dit » la ou la legende disait « communique »,
// sans direction et sans contenu. Une etiquette doit porter le CONTENU du lien,
// le style du trait porte la categorie, et un seul mot sert les deux.

function labelsOf(svg) {
  return [...svg.matchAll(/<text class="plan-chord-label"[^>]*x="([\d.]+)" y="([\d.]+)"[^>]*style="font-size:([\d.]+)px"[^>]*>([^<]*)</g)]
    .map(m => ({x: +m[1], y: +m[2], font: +m[3], text: m[4]}));
}

function drawPlan(game, selected) {
  const model = buildPlanModel(game, {selectedId: selected, size: 320});
  return {model, svg: renderPlan(model, {lang: 'fr', roleName: id => ROLE_NAMES[id] || id, selectedId: selected})};
}

// Bruno parle d Alice sans lui attribuer de role : le lien existe, son contenu
// est inconnu. C est le cas exact qui affichait « dit ».
function toldNoRoleGame() {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloe', 'David', 'Emma']);
  const [a, b] = g.players;
  g.claims = [];
  g.events = [{id: 'e9', type: 'info', playerIds: [a.id], sourceId: b.id, roleId: '', text: 'note libre', value: '', day: 1, phase: 'day', aliveSnapshot: [], ballot: [], outcome: 'unknown', complete: false, influence: {roleIds: [], multiplier: 1, demonOnly: false, stable: false}}];
  return {game: validateGame(g), selected: a.id};
}

function voteGame() {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloe', 'David', 'Emma']);
  const [a, b] = g.players;
  g.claims = [];
  g.events = [{id: 'v1', type: 'execution', playerIds: [b.id], sourceId: '', roleId: '', text: '', value: '', day: 1, phase: 'day', aliveSnapshot: [], ballot: [{playerId: a.id, choice: 'yes', weight: 1}], outcome: 'unknown', complete: false, influence: {roleIds: [], multiplier: 1, demonOnly: false, stable: false}}];
  return {game: validateGame(g), selected: a.id};
}

test('18. le cadran et la liste emploient le meme mot pour un meme lien', () => {
  const {game, selected} = voteGame();
  const {svg} = drawPlan(game, selected);
  const label = labelsOf(svg)[0];
  const chip = svg.match(/<span class="plan-chip[^"]*">([^<]*)</);
  assert.ok(label, 'une etiquette est dessinee sur le trait');
  assert.ok(chip, 'une pastille est dessinee dans la liste');
  assert.equal(label.text, chip[1], 'le trait et la pastille disent le meme mot');
  assert.ok(!/>contre</.test(svg), 'le vocabulaire parallele du cadran a disparu');
});

test('19. un propos sans role avoue qu on ignore ce qui a ete dit', () => {
  const {game, selected} = toldNoRoleGame();
  const {svg} = drawPlan(game, selected);
  const label = labelsOf(svg)[0];
  assert.ok(label, 'le lien est bien dessine');
  assert.equal(label.text, 'sans détail', 'le trait annonce une absence, pas une information');
  assert.ok(svg.includes('sans rôle précisé'), 'la phrase de la liste le dit aussi en toutes lettres');
  assert.ok(!/>dit</.test(svg), 'l ancienne etiquette muette a disparu');
});

test('20. seuls les liens orientes portent une fleche, et elle est expliquee', () => {
  const conflict = conflictGame();
  const {svg: svgC} = drawPlan(conflict, conflict.players[0].id);
  assert.ok(!svgC.includes('<polygon class="plan-arrow'), 'un conflit lie deux sieges a egalite, sans direction');
  assert.ok(!svgC.includes('plan-arrow-hint'), 'et rien n explique une fleche absente');
  const {game, selected} = toldNoRoleGame();
  const {svg} = drawPlan(game, selected);
  assert.ok(svg.includes('<polygon class="plan-arrow'), 'un propos va de qui parle vers qui est vise');
  assert.ok(svg.includes('plan-arrow-hint'), 'le sens de lecture de la fleche est donne');
});

test('21. aucune etiquette ne se pose sous un siege', () => {
  const {game, selected} = spokeGame();
  const {model, svg} = drawPlan(game, selected);
  const labels = labelsOf(svg);
  assert.ok(labels.length >= 3, 'plusieurs etiquettes sont posees');
  for (const L of labels) {
    const w = Math.max(L.font, 0.56 * L.font * L.text.length);
    for (const s of model.seats) {
      const dx = Math.min(L.x + w / 2, s.x + model.nodeR) - Math.max(L.x - w / 2, s.x - model.nodeR);
      const dy = Math.min(L.y + L.font * 0.6, s.y + model.nodeR) - Math.max(L.y - L.font * 0.6, s.y - model.nodeR);
      assert.ok(!(dx > 0 && dy > 0), `l etiquette "${L.text}" passe sous le siege ${s.seat}`);
    }
  }
});

test('23. une note trop longue est coupee sur un mot entier', () => {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloe', 'David', 'Emma']);
  const [a, b] = g.players;
  const longNote = 'Bruno déclare Empathe et annonce le chiffre 1 : un de ses deux voisins vivants serait maléfique. À vérifier cette nuit.';
  g.claims = [];
  g.events = [{id: 'e9', type: 'info', playerIds: [a.id], sourceId: b.id, roleId: '', text: longNote, value: '', day: 1, phase: 'day', aliveSnapshot: [], ballot: [], outcome: 'unknown', complete: false, influence: {roleIds: [], multiplier: 1, demonOnly: false, stable: false}}];
  const {svg} = drawPlan(validateGame(g), a.id);
  const note = svg.match(/<span class="plan-link-note">([^<]*)</);
  assert.ok(note, 'la note est affichee sous le lien');
  assert.ok(note[1].endsWith('…'), 'la coupe est signalee au lecteur');
  const body = note[1].slice(0, -1);
  assert.ok(longNote.startsWith(body), 'le fragment garde est bien le debut de la note');
  const next = longNote[body.length] || ' ';
  const letter = /[a-zà-ÿ]/i;
  assert.ok(!(letter.test(next) && letter.test(body.slice(-1))), `aucun mot n est coupe en deux, ici "${body.slice(-12)}"`);
});

test('22. deux liens sur une meme paire ne se cachent plus l un l autre', () => {
  const g = newGame(SCRIPT, ['Alice', 'Bruno', 'Chloe', 'David', 'Emma']);
  const [a, b] = g.players;
  g.claims = [{id: 'k3', playerId: b.id, sourceId: a.id, roleIds: ['chef'], note: '', day: 1, phase: 'day', visibility: 'private', weight: 1}];
  g.events = [{id: 'v1', type: 'execution', playerIds: [b.id], sourceId: '', roleId: '', text: '', value: '', day: 1, phase: 'day', aliveSnapshot: [], ballot: [{playerId: a.id, choice: 'yes', weight: 1}], outcome: 'unknown', complete: false, influence: {roleIds: [], multiplier: 1, demonOnly: false, stable: false}}];
  const {svg} = drawPlan(validateGame(g), a.id);
  const curves = [...svg.matchAll(/<path class="plan-chord[^"]*"[^>]*d="([^"]+)"/g)].map(m => m[1]);
  assert.ok(curves.length >= 2, 'la paire porte bien deux liens');
  assert.equal(new Set(curves).size, curves.length, 'chaque lien suit sa propre courbe');
});

