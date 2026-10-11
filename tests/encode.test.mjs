import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {newGame, validateGame, parseSave, SCHEMA_VERSION, uid} from '../js/state.js';
import {CAMPS, nextCamp, campForTeam, campFromTrust, templatesFor, describeLink, shortLinkLabel, neighbourIds, linkEdges, campTally, guessIndex, guessedByTeam, LINK_TEMPLATES, EFFECTS} from '../js/encode.js';

const catalogue = JSON.parse(readFileSync(new URL('../data/catalogue.json', import.meta.url), 'utf8'));
const tb = catalogue.scripts.find(s => s.id === 'trouble-brewing');
const names = ['Alice', 'Bruno', 'Chloé', 'David', 'Emma', 'Farid', 'Gaëlle'];
const fresh = () => newGame({name: tb.name, roleIds: tb.roleIds, customRoles: [], warnings: []}, names, 'Test');
const roleName = id => catalogue.roles.find(r => r.id === id)?.name.fr || id;

test('camp: la pastille fait le tour de quatre états puis revient au neutre', () => {
  let camp = 'neutral';
  const seen = [camp];
  for (let i = 0; i < 4; i++) { camp = nextCamp(camp); seen.push(camp); }
  assert.deepEqual(seen, ['neutral', 'good', 'evil', 'doubt', 'neutral']);
  assert.deepEqual(CAMPS, ['neutral', 'good', 'evil', 'doubt']);
});

test('camp: un rôle supposé suggère sa couleur, un Voyageur n’en suggère pas', () => {
  assert.equal(campForTeam('townsfolk'), 'good');
  assert.equal(campForTeam('outsider'), 'good');
  assert.equal(campForTeam('minion'), 'evil');
  assert.equal(campForTeam('demon'), 'evil');
  assert.equal(campForTeam('traveller'), '');
});

test('une nouvelle partie démarre neutre, sans rôle supposé, sans effet ni lien', () => {
  const game = fresh();
  assert.equal(game.version, SCHEMA_VERSION);
  assert.ok(game.players.every(p => p.camp === 'neutral' && p.guess === '' && p.effects.length === 0));
  assert.deepEqual(game.links, []);
});

test('migration: un carnet sans camp reprend la confiance comme couleur', () => {
  const old = JSON.parse(JSON.stringify(fresh()));
  old.version = 5;
  delete old.links;
  old.players.forEach(p => { delete p.camp; delete p.guess; delete p.effects; });
  old.players[0].trust = 'trusted';
  old.players[1].trust = 'suspect';
  old.players[2].trust = 'watch';
  const game = parseSave(JSON.stringify(old));
  assert.deepEqual(game.players.slice(0, 4).map(p => p.camp), ['good', 'evil', 'doubt', 'neutral']);
  assert.equal(campFromTrust('unknown'), 'neutral');
  assert.deepEqual(game.links, []);
});

test('validation: rôle supposé hors script, effet inconnu et doublon refusés', () => {
  const game = fresh();
  const bad = structuredClone(game);
  bad.players[0].guess = 'imp-inconnu';
  assert.throws(() => validateGame(bad));
  const effect = structuredClone(game);
  effect.players[0].effects = [{id: 'inconnu', day: 1, phase: 'day'}];
  assert.throws(() => validateGame(effect));
  const twice = structuredClone(game);
  twice.players[0].effects = [{id: 'drunk', day: 1, phase: 'day'}, {id: 'drunk', day: 2, phase: 'night'}];
  assert.throws(() => validateGame(twice));
  const ok = structuredClone(game);
  ok.players[0].guess = 'empath';
  ok.players[0].effects = EFFECTS.map(e => ({id: e.id, day: 2, phase: 'night'}));
  assert.equal(validateGame(ok).players[0].effects.length, EFFECTS.length);
});

test('validation des liens: nombre de cibles, réponse et cible = soi-même', () => {
  const game = fresh();
  const [a, b, c] = game.players;
  const link = (over = {}) => ({id: uid(), kind: 'oneof', from: a.id, to: [b.id, c.id], roleId: 'chef', result: '', note: '', day: 1, phase: 'night', ...over});
  const withLinks = links => validateGame({...structuredClone(game), links});
  assert.equal(withLinks([link()]).links.length, 1);
  assert.throws(() => withLinks([link({to: [b.id]})]), /Lien invalide/);
  assert.throws(() => withLinks([link({to: [a.id, b.id]})]), /Lien invalide/);
  assert.throws(() => withLinks([link({kind: 'pick-demon', roleId: '', result: 'peut-etre'})]), /Réponse invalide/);
  assert.throws(() => withLinks([link({kind: 'neighbours', to: [], roleId: '', result: '12'})]), /Nombre invalide/);
  assert.throws(() => withLinks([link({kind: 'inconnu'})]));
  assert.throws(() => withLinks([link({roleId: 'role-absent'})]), /Rôle absent/);
  const id = uid();
  assert.throws(() => withLinks([link({id}), link({id})]), /Doublon/);
});

test('modèles de liens: chaque rôle propose son lien d’abord, puis les liens libres', () => {
  assert.deepEqual(templatesFor('empath'), ['neighbours', 'chosen', 'related']);
  assert.deepEqual(templatesFor('washerwoman'), ['oneof', 'chosen', 'related']);
  assert.deepEqual(templatesFor('fortuneteller'), ['pick-demon', 'chosen', 'related']);
  assert.deepEqual(templatesFor('inconnu', 'minion'), ['targets', 'chosen', 'related']);
  assert.deepEqual(templatesFor('inconnu', 'townsfolk'), ['chosen', 'related']);
  for (const id of Object.values(LINK_TEMPLATES).map(t => t.id)) assert.ok(LINK_TEMPLATES[id].max >= LINK_TEMPLATES[id].min);
  const known = new Set(catalogue.roles.map(r => r.id));
  for (const role of ['washerwoman', 'librarian', 'investigator', 'empath', 'fortuneteller', 'seamstress', 'undertaker', 'ravenkeeper', 'monk', 'poisoner', 'butler', 'grandmother', 'bountyhunter']) assert.ok(known.has(role), role);
});

test('voisins: on saute les morts, jamais soi-même, et un Voyageur est hors cercle', () => {
  const game = fresh();
  const [a, b, c, d, e, f, g] = game.players;
  assert.deepEqual(neighbourIds(game, a.id), [g.id, b.id]);
  b.alive = false;
  assert.deepEqual(neighbourIds(game, a.id), [g.id, c.id]);
  g.alive = false;
  assert.deepEqual(neighbourIds(game, a.id), [f.id, c.id]);
  const tiny = {players: game.players.slice(0, 2)};
  assert.deepEqual(neighbourIds(tiny, a.id), []);
});

test('phrases: le sens se lit sans connaître le jargon, en français et en anglais', () => {
  const game = fresh();
  const [a, b, c] = game.players;
  const name = id => game.players.find(p => p.id === id).name;
  const opts = {name, roleName, lang: 'fr', game};
  const oneof = {id: 'l1', kind: 'oneof', from: a.id, to: [b.id, c.id], roleId: 'chef', result: '', note: '', day: 1, phase: 'night'};
  assert.equal(describeLink(oneof, opts), 'Alice : Bruno ou Chloé serait Cuisinier');
  assert.equal(describeLink(oneof, {...opts, lang: 'en', roleName: id => id}), 'Alice: Bruno or Chloé is chef');
  const yes = {id: 'l2', kind: 'pick-demon', from: a.id, to: [b.id, c.id], roleId: '', result: 'yes', note: '', day: 1, phase: 'night'};
  assert.equal(describeLink(yes, opts), 'Alice · A désigné : Bruno et Chloé → oui');
  assert.equal(shortLinkLabel(yes, {lang: 'fr'}), 'oui');
  const empath = {id: 'l3', kind: 'neighbours', from: a.id, to: [], roleId: '', result: '1', note: '', day: 1, phase: 'night'};
  assert.match(describeLink(empath, opts), /^Alice : 1 voisin\(s\) maléfique\(s\) \(Gaëlle et Bruno\)$/);
  assert.equal(shortLinkLabel(empath, {}), '1');
  const pending = {...yes, result: ''};
  assert.equal(describeLink(pending, opts), 'Alice · A désigné : Bruno et Chloé');
});

test('le cadran dessine un trait par cible, les voisins étant calculés au moment de dessiner', () => {
  const game = fresh();
  const [a, b, c, d, e, f, g] = game.players;
  game.links = [
    {id: 'l1', kind: 'oneof', from: a.id, to: [b.id, c.id], roleId: 'chef', result: '', note: '', day: 1, phase: 'night'},
    {id: 'l2', kind: 'neighbours', from: d.id, to: [], roleId: '', result: '2', note: '', day: 1, phase: 'night'}
  ];
  const edges = linkEdges(game);
  assert.deepEqual(edges.map(x => `${x.from}>${x.to}`).sort(), [`${a.id}>${b.id}`, `${a.id}>${c.id}`, `${d.id}>${c.id}`, `${d.id}>${e.id}`].sort());
  c.alive = false;
  const later = linkEdges(game).filter(x => x.link.id === 'l2').map(x => x.to);
  assert.deepEqual(later.sort(), [b.id, e.id].sort());
});

test('décompte: camps, rôles supposés par type et index des rôles déjà attribués', () => {
  const game = fresh();
  game.players[0].camp = 'good';
  game.players[1].camp = 'evil';
  game.players[2].camp = 'evil';
  game.players[3].camp = 'doubt';
  game.players[0].guess = 'empath';
  game.players[1].guess = 'imp';
  game.players[2].guess = 'empath';
  assert.deepEqual(campTally(game), {neutral: 3, good: 1, evil: 2, doubt: 1});
  const roleOf = id => catalogue.roles.find(r => r.id === id);
  assert.deepEqual(guessedByTeam(game, roleOf), {townsfolk: 2, outsider: 0, minion: 0, demon: 1});
  assert.deepEqual(guessIndex(game).get('empath'), [game.players[0].id, game.players[2].id]);
});
