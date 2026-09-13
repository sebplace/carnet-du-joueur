import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fold, parseScript } from '../js/catalogue.js';

const catalogue = JSON.parse(await readFile(new URL('../data/catalogue.json', import.meta.url), 'utf8'));
const parse = value => parseScript(JSON.stringify(value), catalogue);
const teams = new Set(['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled', 'unknown']);

test('fold handles accents, combining marks, case and empty values', () => {
  assert.equal(fold('ÉCOLE À côté'), 'ecole a cote');
  assert.equal(fold('E\u0301carlate'), 'ecarlate');
  assert.equal(fold(undefined), '');
  assert.equal(fold(null), '');
});

test('Bone Collector paraphrases exclude the first night in both languages', () => {
  const ability = catalogue.roles.find(role => role.id === 'bonecollector').ability;
  assert.match(ability.fr, /nuit autre que la première/);
  assert.match(ability.en, /night other than the first/);
});

test('catalogue has exactly three complete script lists and unique safe roles', () => {
  assert.equal(catalogue.roles.length, 143);
  assert.equal(new Set(catalogue.roles.map(role => role.id)).size, catalogue.roles.length);
  assert.deepEqual(catalogue.scripts.map(script => [script.id, script.roleIds.length]), [
    ['trouble-brewing', 27], ['bad-moon-rising', 30], ['sects-and-violets', 30],
  ]);
  const allIds = new Set(catalogue.roles.map(role => role.id));
  for (const script of catalogue.scripts) {
    assert.deepEqual(Object.keys(script).sort(), ['id', 'name', 'roleIds']);
    assert.equal(typeof script.name, 'string');
    assert.equal(new Set(script.roleIds).size, script.roleIds.length);
    assert.ok(script.roleIds.every(id => allIds.has(id)));
    assert.equal(script.roleIds.filter(id => catalogue.roles.find(role => role.id === id).team === 'traveller').length, 5);
  }
  for (const role of catalogue.roles) {
    assert.deepEqual(Object.keys(role).sort(), ['ability', 'id', 'name', 'team']);
    assert.match(role.id, /^[a-zA-Z0-9_-]{1,80}$/);
    assert.ok(teams.has(role.team));
    assert.deepEqual(Object.keys(role.name).sort(), ['en', 'fr']);
    assert.deepEqual(Object.keys(role.ability).sort(), ['en', 'fr']);
    for (const language of ['fr', 'en']) {
      assert.equal(typeof role.name[language], 'string');
      assert.ok(role.name[language].length);
      assert.equal(typeof role.ability[language], 'string');
    }
  }
});

test('only roles from the original three scripts have bundled ability paraphrases', () => {
  const scripted = new Set(catalogue.scripts.flatMap(script => script.roleIds));
  assert.equal(scripted.size, 87);
  for (const role of catalogue.roles) {
    if (scripted.has(role.id)) {
      assert.ok(role.ability.fr);
      assert.ok(role.ability.en);
    } else {
      assert.deepEqual(role.ability, { fr: '', en: '' });
    }
  }
});

test('official string, object and mixed arrays resolve bundled roles', () => {
  for (const input of [['washerwoman', 'imp'], [{ id: 'washerwoman' }, { id: 'imp' }], ['washerwoman', { id: 'imp' }]]) {
    assert.deepEqual(parse(input), {
      name: 'Script importé', roleIds: ['washerwoman', 'imp'], customRoles: [], warnings: [],
    });
  }
  assert.deepEqual(parse([]).roleIds, []);
});

test('metadata can appear anywhere and preserves only its plain-text name', () => {
  const result = parse(['imp', { id: '_meta', name: '  Mon script  ', author: 'Someone', logo: 'https://example.test/logo.svg' }]);
  assert.equal(result.name, 'Mon script');
  assert.deepEqual(result.roleIds, ['imp']);
  assert.deepEqual(Object.keys(result).sort(), ['customRoles', 'name', 'roleIds', 'warnings']);
  assert.equal(parse([{ id: '_meta' }]).name, 'Script importé');
  assert.equal(parse([{ id: '_meta', name: '  ' }]).name, 'Script importé');
});

test('script names are limited at import and reject bidirectional controls', () => {
  const maximum = 'a'.repeat(120);
  assert.equal(parse([{ id: '_meta', name: maximum }]).name, maximum);
  assert.throws(() => parse([{ id: '_meta', name: 'a'.repeat(121) }]), /120/);
  for (const control of ['\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069']) {
    assert.throws(() => parse({ meta: { name: `safe${control}spoofed` }, characters: [] }), /direction/);
  }
});

test('internal meta/characters shape uses the same safe conversion', () => {
  const result = parse({ meta: { id: 'my-script', name: 'My script' }, characters: [{ id: 'imp' }, 'washerwoman'] });
  assert.equal(result.name, 'My script');
  assert.deepEqual(result.roleIds, ['imp', 'washerwoman']);
  assert.equal(parse({ characters: ['imp'] }).name, 'Script importé');
});

test('duplicate metadata is rejected rather than silently replacing the script name', () => {
  assert.throws(() => parse([{ id: '_meta', name: 'One' }, { id: '_meta', name: 'Two' }]), /répétées/);
  assert.throws(() => parse({ meta: {}, characters: [{ id: '_meta' }] }), /répétées/);
});

test('malformed JSON, root shapes, entries and metadata fail clearly', () => {
  for (const value of ['', '[', '["imp",]', '/* comment */ ["imp"]', '["imp"]; alert(1)']) {
    assert.throws(() => parseScript(value, catalogue), /JSON invalide/);
  }
  for (const value of [null, 42, true, 'imp', {}, { roles: [] }, { characters: 'imp' }]) {
    assert.throws(() => parse(value), /Format de script invalide/);
  }
  for (const value of [null, 12, true, [], {}, { name: 'No id' }, { id: 7 }]) {
    assert.throws(() => parse([value]), /entrée|Identifiant/);
  }
  for (const meta of [null, [], 'name', { name: 42 }, { name: { fr: 'Nom' } }]) {
    assert.throws(() => parse({ meta, characters: [] }), /métadonnées|nom du script/);
  }
  assert.throws(() => parseScript([], catalogue), /texte JSON/);
  assert.throws(() => parseScript('[]', null), /Catalogue/);
});

test('unsafe IDs and prototype-related names are rejected in both forms', () => {
  const invalid = [
    '', 'a'.repeat(81), '__proto__', 'constructor', 'prototype', 'toString',
    'hasOwnProperty', '__defineGetter__', 'valueOf', 'Constructor', '_META',
    '<script>', 'role/name', 'role.name', 'role name', 'éclair', 'https://x', 'evil\u0000id',
  ];
  for (const id of invalid) {
    assert.throws(() => parse([id]), /Identifiant/, id);
    assert.throws(() => parse([{ id }]), /Identifiant/, id);
  }
  assert.throws(() => parse(['_meta']), /Identifiant/);
  const id = 'A'.repeat(78) + '_-';
  assert.equal(parse([id]).customRoles[0].id, id);
});

test('duplicate IDs are deduplicated in original order with first definition winning', () => {
  const result = parse(['imp', { id: 'imp' }, 'my-role', { id: 'my-role', name: 'Override', team: 'demon' }]);
  assert.deepEqual(result.roleIds, ['imp', 'my-role']);
  assert.deepEqual(result.customRoles, [{
    id: 'my-role', name: { fr: 'my-role', en: 'my-role' }, team: 'unknown', ability: { fr: '', en: '' },
  }]);
  assert.equal(result.warnings.filter(warning => warning.includes('en double')).length, 2);
});

test('bundled definitions are immutable and cannot be overridden by imported definitions', () => {
  const before = JSON.stringify(catalogue);
  const result = parse([{ id: 'imp', name: 'Not Imp', team: 'townsfolk', ability: { html: '<script>bad()</script>' } }]);
  assert.deepEqual(result.roleIds, ['imp']);
  assert.deepEqual(result.customRoles, []);
  assert.ok(result.warnings.some(warning => warning.includes('Définitions intégrées conservées')));
  assert.equal(JSON.stringify(catalogue), before);
});

test('unknown bare IDs stay visible without invented teams or abilities', () => {
  for (const entry of ['lost-role', { id: 'lost-role' }]) {
    const result = parse([entry]);
    assert.deepEqual(result.customRoles[0], {
      id: 'lost-role', name: { fr: 'lost-role', en: 'lost-role' }, team: 'unknown', ability: { fr: '', en: '' },
    });
    assert.match(result.warnings[0], /Rôle inconnu/);
  }
});

test('homebrew scalar and bilingual text is allowlisted, with traveller normalization', () => {
  const result = parse([
    { id: 'custom-one', name: 'Custom One', team: 'traveler', ability: 'A custom description.' },
    { id: 'custom-two', name: { fr: 'Deuxième' }, team: 'fabled', ability: { en: 'English description.' } },
  ]);
  assert.deepEqual(result.customRoles, [
    { id: 'custom-one', name: { fr: 'Custom One', en: 'Custom One' }, team: 'traveller', ability: { fr: 'A custom description.', en: 'A custom description.' } },
    { id: 'custom-two', name: { fr: 'Deuxième', en: 'Deuxième' }, team: 'fabled', ability: { fr: '', en: 'English description.' } },
  ]);
  assert.ok(result.warnings.every(warning => warning.includes('mécaniques non vérifiées')));
  for (const team of teams) assert.equal(parse([{ id: 'custom', team }]).customRoles[0].team, team);
});

test('unsupported teams remain unknown and are never inferred from the role name', () => {
  const result = parse([{ id: 'new-demon', name: 'Demon', team: 'loric' }]);
  assert.equal(result.customRoles[0].team, 'unknown');
  assert.ok(result.warnings.some(warning => warning.includes('Catégorie non reconnue')));
});

test('invalid allowlisted homebrew field types fail instead of coercing objects', () => {
  for (const fields of [
    { name: null }, { name: 42 }, { name: [] }, { name: { fr: {} } },
    { ability: false }, { ability: [] }, { ability: { en: null } }, { team: {} }, { team: null },
  ]) {
    assert.throws(() => parse([{ id: 'custom', ...fields }]), /champ/);
  }
});

test('text remains inert text, while remote assets, code and extra fields are discarded', () => {
  const text = '<img src=x onerror=alert(1)> & "quoted"';
  const result = parse([
    { id: '_meta', name: text, logo: 'https://example.test/logo.svg', script: 'alert(1)' },
    {
      id: 'custom', name: text, team: 'townsfolk', ability: { fr: text, en: 'Literal text', html: '<script>bad()</script>' },
      image: 'https://example.test/image.svg', script: 'alert(1)', url: 'javascript:alert(1)',
      reminders: ['ignored'], firstNightReminder: 'ignored', setup: true, arbitrary: { nested: 'ignored' },
    },
  ]);
  assert.equal(result.name, text);
  assert.equal(result.customRoles[0].name.fr, text);
  assert.equal(result.customRoles[0].ability.fr, text);
  assert.deepEqual(Object.keys(result.customRoles[0]).sort(), ['ability', 'id', 'name', 'team']);
  assert.deepEqual(Object.keys(result.customRoles[0].ability).sort(), ['en', 'fr']);
  assert.ok(!JSON.stringify(result).includes('example.test'));
  assert.ok(!JSON.stringify(result).includes('javascript:'));
});

test('untrusted prototype keys are never copied or applied', () => {
  const result = parseScript('[{"id":"custom","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"name":{"fr":"Nom","__proto__":{"polluted":true}}}]', catalogue);
  const role = result.customRoles[0];
  assert.equal(Object.getPrototypeOf(role), Object.prototype);
  assert.equal(Object.getPrototypeOf(role.name), Object.prototype);
  assert.equal(Object.hasOwn(role, '__proto__'), false);
  assert.equal(Object.hasOwn(role, 'constructor'), false);
  assert.equal({}.polluted, undefined);
});

test('text limit is enforced at exactly 250000 characters', () => {
  assert.deepEqual(parseScript('[]' + ' '.repeat(249_998), catalogue).roleIds, []);
  assert.throws(() => parseScript('[]' + ' '.repeat(249_999), catalogue), /250 000/);
});

test('entry limit counts metadata and duplicates before deduplication', () => {
  assert.deepEqual(parse(Array(200).fill('imp')).roleIds, ['imp']);
  assert.throws(() => parse(Array(201).fill('imp')), /200 entrées/);
  assert.throws(() => parse([{ id: '_meta' }, ...Array(200).fill('imp')]), /200 entrées/);
  assert.throws(() => parse({ characters: Array(201).fill('imp') }), /200 entrées/);
});
