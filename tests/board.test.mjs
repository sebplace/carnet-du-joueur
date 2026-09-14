import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame} from '../js/state.js';
import {buildBoardModel, boardState, resetBoard, escapeHtml, buildCharacterGridModel, buildContradictionModel, seatNeighbours, buildLinksModel, renderBoard} from '../js/board.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const catalogue = {roles:[
  {id:'chef',name:{fr:'Chef',en:'Chef'},team:'townsfolk'},
  {id:'empath',name:{fr:'Empathe',en:'Empath'},team:'townsfolk'},
  {id:'monk',name:{fr:'Moine',en:'Monk'},team:'townsfolk'},
  {id:'poisoner',name:{fr:'Empoisonneuse',en:'Poisoner'},team:'minion'},
  {id:'imp',name:{fr:'Diablotin',en:'Imp'},team:'demon'}
]};

function ctx(game, state = {}) {
  return {
    game, catalogue, state, lang:'fr',
    playerName:id=>[...game.players, ...(game.archivedPlayers || [])].find(p=>p.id===id)?.name || id,
    roleName:id=>catalogue.roles.find(r=>r.id===id)?.name.fr || id,
    prediction:{result:{reliable:true,method:'test',probabilities:{[game.players[0].id]:{chef:.7,imp:.3}},presence:{}}}
  };
}

function makeGame(names = ['Alice','Bruno','Chloé','David','Emma']) {
  const g = newGame({name:'Fixture',roleIds:catalogue.roles.map(r=>r.id),customRoles:[],warnings:[]}, names);
  const [a,b,c,d,e] = g.players;
  g.claims = [
    {id:'c1',playerId:a.id,sourceId:b.id,roleIds:['chef'],note:'rôle privé',day:1,phase:'day',visibility:'private',weight:5}
  ];
  g.events = [
    {id:'i1',type:'info',playerIds:[c.id],sourceId:a.id,roleId:'',text:'info de nuit',value:'',day:1,phase:'night',aliveSnapshot:[],ballot:[]},
    {id:'x1',type:'execution',playerIds:[d.id],sourceId:c.id,roleId:'',text:'nomination visible',value:'',day:2,phase:'day',aliveSnapshot:[],ballot:[
      {playerId:a.id,choice:'yes',weight:1},
      {playerId:b.id,choice:'no',weight:0},
      {playerId:e.id,choice:'yes',weight:1}
    ],outcome:'unknown'}
  ];
  g.scenarios[0].constraints = [{id:'h1',players:[a.id,b.id],roleIds:['chef'],min:1,max:1,note:'paire test',enabled:true}];
  return g;
}

test('seat ordering matches the active roster and referenced archives only', () => {
  const g = makeGame(['Bruno','Alice','Emma','Chloé','David']);
  const referenced = {id:'old1',name:'Ancien',alive:false,ghost:false,traveller:false,trust:'unknown'};
  const unreferenced = {id:'old2',name:'Oublié',alive:true,ghost:true,traveller:false,trust:'unknown'};
  g.archivedPlayers = [referenced, unreferenced];
  g.claims.push({id:'oldc',playerId:referenced.id,sourceId:g.players[0].id,roleIds:['monk'],note:'archive utile',day:1,phase:'day',visibility:'private',weight:5});
  const model = buildBoardModel(g, ctx(g));
  assert.deepEqual(model.people.slice(0,5).map(p=>p.name), ['Bruno','Alice','Emma','Chloé','David']);
  assert.equal(model.people.some(p=>p.id===referenced.id && p.archived), true);
  assert.equal(model.people.some(p=>p.id===unreferenced.id), false);
});

test('relation links never self-reference', () => {
  const g = makeGame();
  g.claims.push({id:'self',playerId:g.players[0].id,sourceId:g.players[0].id,roleIds:['empath'],note:'auto',day:2,phase:'day',visibility:'public',weight:5});
  const model = buildBoardModel(g, ctx(g));
  assert.equal(model.relations.links.some(l=>l.from===l.to), false);
});

test('counts per player combine clues, votes, nominations and hypotheses', () => {
  const g = makeGame();
  const model = buildBoardModel(g, ctx(g));
  const alice = model.rows.find(r=>r.name==='Alice');
  const bruno = model.rows.find(r=>r.name==='Bruno');
  const chloe = model.rows.find(r=>r.name==='Chloé');
  const david = model.rows.find(r=>r.name==='David');
  assert.equal(alice.counts.cluesGiven, 1);
  assert.equal(alice.counts.cluesReceived, 1);
  assert.equal(alice.counts.votesCast, 1);
  assert.equal(alice.counts.hypotheses, 1);
  assert.equal(bruno.counts.cluesGiven, 1);
  assert.equal(bruno.counts.votesCast, 0);
  assert.equal(chloe.counts.nominationsMade, 1);
  assert.equal(david.counts.nominationsReceived, 1);
  assert.deepEqual(alice.probabilities.map(p=>p.roleId), ['chef','imp']);
});

test('filters and query narrow the view without dropping the underlying graph', () => {
  const g = makeGame();
  const all = buildBoardModel(g, ctx(g));
  const filtered = buildBoardModel(g, ctx(g, {phase:'night:1', query:'info'}));
  assert.equal(filtered.filteredRecords.length, 1);
  assert.equal(filtered.filteredRecords[0].id, 'event:i1');
  assert.equal(filtered.graph.records.length, all.graph.records.length);
  assert.equal(filtered.hidden.byFilters, all.graph.records.length - 1);
});

test('hidden round-link counts are exact', () => {
  const g = makeGame(Array.from({length:15}, (_, i)=>`J${i+1}`));
  const players = g.players.map(p=>p.id);
  g.scenarios[0].constraints = [];
  g.events = [];
  for (let i = 0; i < players.length; i++) for (let j = 0; j < players.length; j++) {
    if (i !== j) g.events.push({id:`n${i}_${j}`,type:'execution',playerIds:[players[j]],sourceId:players[i],roleId:'',text:'many links',value:'',day:1,phase:'day',aliveSnapshot:[],ballot:[],outcome:'unknown'});
  }
  const model = buildBoardModel(g, ctx(g));
  assert.equal(model.roundLinks.length, 90);
  assert.equal(model.hidden.roundLinks, model.filteredLinks.length - 90);
});

test('escaping helper neutralises angle brackets, quotes and ampersands', () => {
  assert.equal(escapeHtml(`<x a="1" b='2'>&`), '&lt;x a=&quot;1&quot; b=&#39;2&#39;&gt;&amp;');
});

test('character grid rows follow seat order and include every active seat', () => {
  const g = makeGame(['Bruno','Alice','Emma','Chloé','David']);
  const model = buildBoardModel(g, ctx(g));
  assert.deepEqual(model.characterGrid.rows.map(r => r.name), ['Bruno','Alice','Emma','Chloé','David']);
  assert.deepEqual(model.characterGrid.rows.map(r => r.seat), [1,2,3,4,5]);
});

test('character grid identifies unclaimed characters without a reliable prediction', () => {
  const g = makeGame();
  const context = {...ctx(g), prediction:null};
  const grid = buildCharacterGridModel(g, context);
  assert.equal(grid.reliable, false);
  assert.equal(grid.unclaimedCharacters.some(c => c.id === 'chef'), false);
  assert.equal(grid.unclaimedCharacters.some(c => c.id === 'empath'), true);
});

test('contradiction detection finds duplicate claims and ignores distinct claims', () => {
  const g = makeGame();
  const [a,b,c] = g.players;
  g.claims = [
    {id:'aChef',playerId:a.id,sourceId:a.id,roleIds:['chef'],note:'a',day:1,phase:'day',visibility:'public',weight:5},
    {id:'bChef',playerId:b.id,sourceId:b.id,roleIds:['chef'],note:'b',day:1,phase:'day',visibility:'public',weight:5},
    {id:'cMonk',playerId:c.id,sourceId:c.id,roleIds:['monk'],note:'c',day:1,phase:'day',visibility:'public',weight:5}
  ];
  let conflicts = buildContradictionModel(g, ctx(g)).entries;
  assert.equal(conflicts.some(e => e.type === 'duplicate-claim' && e.roleId === 'chef'), true);
  g.claims[1].roleIds = ['empath'];
  conflicts = buildContradictionModel(g, ctx(g)).entries;
  assert.equal(conflicts.some(e => e.type === 'duplicate-claim'), false);
});

test('seat neighbours wrap around for five and twenty player tables', () => {
  const five = makeGame(['A','B','C','D','E']);
  let neighbours = seatNeighbours(five.players.map((p, i) => ({...p, seat:i + 1})));
  assert.equal(neighbours[five.players[0].id].left.id, five.players[4].id);
  assert.equal(neighbours[five.players[0].id].right.id, five.players[1].id);
  const twenty = makeGame(Array.from({length:20}, (_, i) => `J${i + 1}`));
  neighbours = seatNeighbours(twenty.players.map((p, i) => ({...p, seat:i + 1})));
  assert.equal(neighbours[twenty.players[0].id].left.id, twenty.players[19].id);
  assert.equal(neighbours[twenty.players[19].id].right.id, twenty.players[0].id);
});

test('resetBoard clears shared state to the default timeline lens', () => {
  Object.assign(boardState, {lens:'links', selectedPlayer:'p1', selectedRole:'chef', phase:'day:2', query:'x', linksLimit:300});
  resetBoard();
  assert.deepEqual(boardState, {lens:'timeline', selectedPlayer:'', selectedRole:'', phase:'', query:'', linksLimit:150});
});

// --- Regression tests for B1-B4 -------------------------------------------------------------

const boardCssPath = fileURLToPath(new URL('../css/board.css', import.meta.url));
const boardCss = readFileSync(boardCssPath, 'utf8');

function fakeContainer() {
  const listeners = {};
  return {
    innerHTML: '',
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
    contains() { return true; },
    __listeners: listeners
  };
}

// Large synthetic game matching the measured defect scenario (20 players, hundreds of events with
// full ballots), which used to push thousands of graph edges straight into HTML with no cap.
function makeLargeGame(playerCount = 20, eventCount = 480) {
  const g = makeGame(Array.from({length: playerCount}, (_, i) => `J${i + 1}`));
  const players = g.players.map(p => p.id);
  g.scenarios[0].constraints = [];
  g.events = [];
  for (let i = 0; i < eventCount; i++) {
    const source = players[i % players.length];
    const target = players[(i + 1) % players.length];
    g.events.push({
      id: `bulk${i}`, type: 'execution', playerIds: [target], sourceId: source, roleId: '', text: `event ${i}`,
      value: '', day: 1 + (i % 5), phase: i % 2 ? 'day' : 'night', aliveSnapshot: [],
      ballot: players.map(p => ({playerId: p, choice: p === target ? 'no' : 'yes', weight: 1})), outcome: 'unknown'
    });
  }
  return g;
}

test('B1: links lens caps rendered rows and reports the true hidden count for a large synthetic game', () => {
  resetBoard();
  const g = makeLargeGame(20, 480);
  const model = buildBoardModel(g, ctx(g, {lens: 'links'}));
  const total = model.graph.edges.length;
  assert.ok(total > 150, `synthetic game should exceed the cap (got ${total} edges)`);
  const capped = buildLinksModel(model);
  assert.ok(capped.rows.length <= 150, 'default call must never exceed MAX_LINK_ROWS');
  assert.equal(capped.total, total);
  assert.equal(capped.hidden, total - capped.rows.length);
  assert.ok(capped.hidden > 0, 'a large game must report hidden links instead of silently truncating');
  // Nothing is permanently lost: raising the limit ("show more") reaches every edge.
  const all = buildLinksModel(model, total);
  assert.equal(all.rows.length, total);
  assert.equal(all.hidden, 0);
});

test('B1: renderBoard on the links lens renders at most the current limit of rows and a show-more affordance', () => {
  resetBoard();
  const g = makeLargeGame(20, 480);
  boardState.lens = 'links';
  const container = fakeContainer();
  const model = renderBoard(container, ctx(g, {lens: 'links'}));
  const bodyRows = n => (n.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].match(/<tr>/g) || []).length;
  const rowCount = bodyRows(container.innerHTML);
  assert.ok(rowCount <= 150, `rendered rows must stay within the cap (got ${rowCount})`);
  assert.match(container.innerHTML, /data-board-links-more/);
  assert.match(container.innerHTML, /notice warning/);
  const hidden = model.graph.edges.length - 150;
  assert.ok(hidden > 0);
  assert.match(container.innerHTML, new RegExp(`${hidden} (lien|link)`));
  // Clicking "show more" reveals more rows without a full page reload, and never fewer than before.
  container.__listeners.click({target: {closest: sel => sel.includes('data-board-links-more') ? {dataset: {}, hasAttribute: a => a === 'data-board-links-more'} : null}});
  const rowCountAfter = bodyRows(container.innerHTML);
  assert.ok(rowCountAfter > rowCount, 'show more must reveal additional rows');
  resetBoard();
});

test('B2: characterGrid and contradictions stay unbuilt (lazy) after a full timeline-lens render', () => {
  resetBoard();
  const g = makeGame();
  const container = fakeContainer();
  const model = renderBoard(container, ctx(g, {lens: 'timeline'}));
  assert.equal(model.state.lens, 'timeline');
  assert.equal(typeof Object.getOwnPropertyDescriptor(model, 'characterGrid').get, 'function',
    'timeline lens render must not have computed characterGrid yet');
  assert.equal(typeof Object.getOwnPropertyDescriptor(model, 'contradictions').get, 'function',
    'timeline lens render must not have computed contradictions yet');
  // Accessing it (e.g. because grille/conflits is opened next) computes it once and memoises the result.
  const grid = model.characterGrid;
  const descriptor = Object.getOwnPropertyDescriptor(model, 'characterGrid');
  assert.equal(descriptor.get, undefined, 'first access must replace the getter with a plain cached value');
  assert.equal(model.characterGrid, grid, 'repeated access must return the same memoised reference');
});

test('B2: links lens render also avoids building the expensive per-lens models', () => {
  const g = makeGame();
  for (const lens of ['round', 'timeline']) {
    resetBoard();
    const container = fakeContainer();
    const model = renderBoard(container, ctx(g, {lens}));
    assert.equal(typeof Object.getOwnPropertyDescriptor(model, 'characterGrid').get, 'function', `${lens} lens must not build characterGrid`);
    assert.equal(typeof Object.getOwnPropertyDescriptor(model, 'contradictions').get, 'function', `${lens} lens must not build contradictions`);
  }
  resetBoard();
});

test('B3: voted and nominated chords each get their own dash pattern, distinct from neutral/paired/conflict', () => {
  const dasharray = kind => {
    const m = boardCss.match(new RegExp(`\\.board-chord\\.${kind}\\{[^}]*stroke-dasharray:([^;}]+)`));
    return m ? m[1].trim() : null;
  };
  const base = boardCss.match(/\.board-chord\{[^}]*\}/)[0];
  assert.equal(/stroke-dasharray/.test(base), false, 'the neutral chord has no dash pattern (solid line)');
  const patterns = {conflict: dasharray('conflict'), paired: dasharray('paired'), voted: dasharray('voted'), nominated: dasharray('nominated')};
  for (const [kind, value] of Object.entries(patterns)) assert.ok(value, `${kind} must declare its own stroke-dasharray`);
  const values = Object.values(patterns);
  assert.equal(new Set(values).size, values.length, 'every link kind must have a visually distinct dash pattern');
});



// --- Regression tests for the showModel posture flag ------------------------------------------


test('showModel:false suppresses percentages and the reliability notice on the character-grid lens too', () => {
  resetBoard();
  const g = makeGame();
  const container = fakeContainer();
  const lockedCtx = {...ctx(g, {lens: 'grille'}), showModel: false, prediction:{result:{reliable:false,method:'test',probabilities:{[g.players[0].id]:{chef:.7}},presence:{}}}};
  renderBoard(container, lockedCtx);
  const html = container.innerHTML;
  assert.doesNotMatch(html, /%/, 'grid cells must fall back to claim-only text, never a percentage');
  assert.doesNotMatch(html, /prédiction fiable/i, 'the unreliable-prediction notice must not leak the model concept either');
  resetBoard();
});




