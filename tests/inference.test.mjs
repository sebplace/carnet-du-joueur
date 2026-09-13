import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { baseCounts, solve } from "../js/inference.js";

const teams = ["townsfolk", "outsider", "minion", "demon"];
const ample = { maxNodes: 2000000, timeMs: 10000, maxWorlds: 500000 };
const counts = (townsfolk, outsider = 0, minion = 0, demon = 0) => ({ townsfolk, outsider, minion, demon });
const roles = [
  { id: "washer", team: "townsfolk" },
  { id: "chef", team: "townsfolk" },
  { id: "drunk", team: "outsider" },
  { id: "baron", team: "minion" },
  { id: "imp", team: "demon" },
];

function model(n = 3) {
  return {
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, candidates: [] })),
    roles: structuredClone(roles),
    counts: n === 3 ? counts(1, 0, 1, 1) : counts(n),
    constraints: [],
  };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

function bruteForce(input) {
  const roleMap = new Map(input.roles.map((role) => [role.id, role]));
  const worlds = [];
  const assignment = new Map();
  const taken = new Set();
  const assignedCounts = counts(0);
  function recurse(index) {
    if (index === input.players.length) {
      if (teams.some((team) => assignedCounts[team] !== input.counts[team])) return;
      for (const constraint of input.constraints ?? []) {
        const targetRoles = new Set(constraint.roleIds ?? []);
        let matches = 0;
        if (constraint.type === "adjacent-pairs") {
          const n = input.players.length;
          const edges = n === 2 ? [[0, 1]] : Array.from({ length: n > 1 ? n : 0 }, (_, i) => [i, (i + 1) % n]);
          matches = edges.filter(([a, b]) =>
            targetRoles.has(assignment.get(input.players[a].id)) && targetRoles.has(assignment.get(input.players[b].id))).length;
        } else if (constraint.type === "player-neighbours") {
          const index = input.players.findIndex((p) => p.id === constraint.playerId);
          const skip = new Set(constraint.skipPlayers ?? []);
          const neighbours = [];
          for (const step of [-1, 1]) {
            for (let offset = 1; offset < input.players.length; offset++) {
              const candidate = (index + step * offset + input.players.length) % input.players.length;
              if (candidate === index || skip.has(input.players[candidate].id)) continue;
              if (!neighbours.includes(candidate)) neighbours.push(candidate);
              break;
            }
          }
          matches = neighbours.filter((i) => targetRoles.has(assignment.get(input.players[i].id))).length;
        } else if (constraint.type === "pair-count") {
          matches = constraint.pairs.filter((pair) => assignment.get(pair.playerId) === pair.roleId).length;
        } else {
          matches = [...new Set(constraint.players)]
            .filter((player) => targetRoles.has(assignment.get(player))).length;
        }
        if (matches < constraint.min || matches > constraint.max) return;
      }
      worlds.push(Object.fromEntries(assignment));
      return;
    }
    const player = input.players[index];
    const candidates = player.candidates.length ? [...new Set(player.candidates)] : [...roleMap.keys()];
    for (const roleId of candidates) {
      if (taken.has(roleId)) continue;
      const team = roleMap.get(roleId).team;
      if (assignedCounts[team] >= input.counts[team]) continue;
      taken.add(roleId);
      assignedCounts[team]++;
      assignment.set(player.id, roleId);
      recurse(index + 1);
      assignment.delete(player.id);
      assignedCounts[team]--;
      taken.delete(roleId);
    }
  }
  recurse(0);
  const marginals = Object.fromEntries(input.players.map((player) => [
    player.id,
    Object.fromEntries((player.candidates.length ? player.candidates : [...roleMap.keys()]).map((roleId) => [
      roleId, worlds.filter((world) => world[player.id] === roleId).length,
    ])),
  ]));
  return { worlds, marginals };
}

function assertMatchesOracle(input) {
  const expected = bruteForce(input);
  const actual = solve(input, ample);
  assert.equal(actual.complete, true);
  assert.equal(actual.reason, null);
  assert.equal(actual.worlds, expected.worlds.length);
  assert.deepEqual(plain(actual.marginals), expected.marginals);
  assert.equal(actual.contradictions.length > 0, expected.worlds.length === 0);
  for (const example of actual.examples) {
    assert.ok(expected.worlds.some((world) => JSON.stringify(world) === JSON.stringify(example)));
  }
  return actual;
}

test("canonical normal-player counts are correct for every supported size", () => {
  const expected = [
    [3, 0, 1, 1], [3, 1, 1, 1], [5, 0, 1, 1], [5, 1, 1, 1],
    [5, 2, 1, 1], [7, 0, 2, 1], [7, 1, 2, 1], [7, 2, 2, 1],
    [9, 0, 3, 1], [9, 1, 3, 1], [9, 2, 3, 1],
  ];
  expected.forEach((values, i) => {
    const result = baseCounts(i + 5);
    assert.deepEqual(teams.map((team) => result[team]), values);
    assert.equal(Object.values(result).reduce((a, b) => a + b), i + 5);
  });
  for (const n of [0, 1, 4, 16, 20, -1, 5.5, NaN, Infinity, "5", null, undefined]) {
    assert.throws(() => baseCounts(n), Error);
  }
  const fresh = baseCounts(5);
  fresh.townsfolk = 100;
  assert.equal(baseCounts(5).townsfolk, 3);
});

test("empty candidates mean all roles; exact teams, unique roles and zero marginals", () => {
  const result = assertMatchesOracle(model());
  assert.equal(result.worlds, 12);
  assert.deepEqual(plain(result.marginals.p0), { washer: 2, chef: 2, drunk: 0, baron: 4, imp: 4 });
  assert.equal(result.examples.length, 5);
  for (const example of result.examples) assert.equal(new Set(Object.values(example)).size, 3);
});

test("manual counts are authoritative without character mechanics", () => {
  const input = model();
  input.counts = counts(1, 1, 1, 0);
  input.players[0].candidates = ["washer", "chef"];
  input.players[1].candidates = ["drunk"];
  input.players[2].candidates = ["baron"];
  assert.equal(assertMatchesOracle(input).worlds, 2);
});

test("overlapping lower and upper constraints agree with brute force", () => {
  const input = model(4);
  input.counts = counts(2, 0, 1, 1);
  input.constraints = [
    { id: "evil-neighbors", players: ["p0", "p1"], roleIds: ["baron", "imp"], min: 1, max: 1 },
    { id: "chef-nearby", players: ["p1", "p2"], roleIds: ["chef"], min: 1, max: 1 },
    { id: "no-imp", players: ["p2"], roleIds: ["imp"], min: 0, max: 0 },
  ];
  assert.ok(assertMatchesOracle(input).worlds > 0);
});

test("seat adjacency constraints match brute force, including wrap-around and skip lists", () => {
  const input = model(5);
  input.counts = counts(5);
  input.roles = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, team: "townsfolk" }));
  input.players.forEach((player) => { player.candidates = []; });
  input.constraints = [
    { id: "chef-cycle", type: "adjacent-pairs", roleIds: ["r0", "r1"], min: 1, max: 2 },
    { id: "empath-skip", type: "player-neighbours", playerId: "p0", skipPlayers: ["p1"], roleIds: ["r2"], min: 0, max: 1 },
  ];
  assert.ok(assertMatchesOracle(input).worlds > 0);
  input.players[0].candidates = ["r0"];
  input.players[4].candidates = ["r1"];
  input.constraints = [{ id: "wrap", type: "adjacent-pairs", roleIds: ["r0", "r1"], min: 1, max: 1 }];
  assert.ok(assertMatchesOracle(input).worlds > 0);
});

test("player-role pair-count constraints express exact Juggler-style pairs", () => {
  const input = model(4);
  input.counts = counts(4);
  input.roles = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, team: "townsfolk" }));
  input.constraints = [{
    id: "juggler", type: "pair-count",
    pairs: [{ playerId: "p0", roleId: "r0" }, { playerId: "p1", roleId: "r0" }, { playerId: "p2", roleId: "r2" }],
    min: 1, max: 2,
  }];
  assertMatchesOracle(input);
});

test("constraint maximum, minimum, role uniqueness and team-capacity pruning are sound", () => {
  const cases = [
    [{ id: "unique", players: ["p0", "p1"], roleIds: ["imp"], min: 2, max: 2 }],
    [{ id: "capacity", players: ["p0", "p1", "p2"], roleIds: ["washer", "chef"], min: 2, max: 3 }],
    [{ id: "maximum", players: ["p0", "p1", "p2"], roleIds: ["baron", "imp"], min: 0, max: 1 }],
  ];
  for (const constraints of cases) {
    const input = model();
    input.constraints = constraints;
    const result = solve(input, { ...ample, propagate: false });
    assert.equal(result.worlds, 0);
    assert.ok(result.contradictions.some((message) => message.includes(constraints[0].id)));
  }
});

test("empty constraint sets have explicit zero-match semantics", () => {
  const input = model();
  input.constraints = [{ id: "empty", players: ["p0"], roleIds: [], min: 0, max: 0 }];
  assert.equal(assertMatchesOracle(input).worlds, 12);
  input.constraints[0].min = 1;
  input.constraints[0].max = 1;
  const impossible = assertMatchesOracle(input);
  assert.equal(impossible.worlds, 0);
  assert.equal(impossible.nodes, 0);
  input.constraints = [{ id: "empty-scope", players: [], roleIds: ["imp"], min: 0, max: 0 }];
  assert.equal(assertMatchesOracle(input).worlds, 12);
});

test("duplicate domain and constraint-list entries are deduplicated", () => {
  const input = model();
  input.players[0].candidates = ["washer", "washer", "baron"];
  input.constraints = [{
    id: "dedup", players: ["p0", "p0", "p1"], roleIds: ["baron", "baron"], min: 1, max: 1,
  }];
  assertMatchesOracle(input);
  input.constraints[0].max = 3;
  assert.throws(() => solve(input), /bornes invalides/);
});

test("local domain and role-pool contradictions are proven even with no search budget", () => {
  const input = model();
  input.players[0].candidates = ["drunk"];
  const result = solve(input, { maxNodes: 0, timeMs: 0 });
  assert.equal(result.complete, true);
  assert.equal(result.worlds, 0);
  assert.equal(result.nodes, 0);
  assert.equal(result.reason, null);
  assert.ok(result.contradictions.some((message) => message.includes("p0")));
  assert.equal(result.marginals.p0.drunk, 0);
  const empty = model(1);
  empty.roles = [];
  assert.equal(solve(empty).complete, true);
  assert.equal(solve(empty).worlds, 0);
  const scarce = model();
  scarce.roles = roles.filter((role) => role.team === "townsfolk");
  assert.ok(solve(scarce).contradictions.some((message) => message.includes("minion")));
});

test("zero partial worlds is not a contradiction or usable posterior", () => {
  for (const maxNodes of [0, 1, 2]) {
    const result = solve(model(), { maxNodes, timeMs: 10000 });
    assert.equal(result.complete, false);
    assert.equal(result.worlds, 0);
    assert.equal(result.nodes, maxNodes);
    assert.equal(result.reason, "node-limit");
    assert.deepEqual(plain(result.marginals), {});
    assert.deepEqual(result.contradictions, []);
  }
});

test("partial positive worlds withhold marginals and retain valid example assignments", () => {
  const result = solve(model(), { maxWorlds: 1, timeMs: 10000 });
  assert.equal(result.complete, false);
  assert.equal(result.reason, "world-limit");
  assert.equal(result.worlds, 1);
  assert.equal(result.examples.length, 1);
  assert.deepEqual(plain(result.marginals), {});
  assert.deepEqual(result.contradictions, []);
  const expected = bruteForce(model()).worlds;
  assert.ok(expected.some((world) => JSON.stringify(world) === JSON.stringify(result.examples[0])));
});

test("a limit reached exactly at final completion does not make a complete search partial", () => {
  const baseline = solve(model(), ample);
  const exact = solve(model(), { maxNodes: baseline.nodes, maxWorlds: baseline.worlds, timeMs: 10000 });
  assert.equal(exact.complete, true);
  assert.equal(exact.worlds, 12);
});

test("time limits produce incomplete results rather than impossibility", () => {
  const result = solve(model(), { timeMs: 0 });
  assert.equal(result.complete, false);
  assert.equal(result.nodes, 0);
  assert.equal(result.reason, "time-limit");
  assert.deepEqual(plain(result.marginals), {});
  assert.deepEqual(result.contradictions, []);
});

test("time budget is checked during search, including after some worlds were found", (t) => {
  let clock = 0;
  t.mock.method(globalThis.performance, "now", () => clock++);
  const result = solve(model(), { timeMs: 5, propagate: false });
  assert.equal(result.complete, false);
  assert.equal(result.reason, "time-limit");
  assert.equal(result.worlds, 1);
  assert.deepEqual(plain(result.marginals), {});
  assert.deepEqual(result.contradictions, []);
});

test("deep search contradictions are conflicts in assumptions, not accusations", () => {
  const input = model(4);
  input.roles = ["a", "b", "c", "d"].map((id) => ({ id, team: "townsfolk" }));
  input.players.forEach((player, index) => {
    player.candidates = index < 3 ? ["a", "b"] : ["c", "d"];
  });
  const result = solve(input, { ...ample, propagate: false });
  assert.equal(result.worlds, 0);
  assert.ok(result.nodes > 1);
  assert.match(result.contradictions.join(" "), /conflit entre les hypothèses/);
  const partial = solve(input, { maxNodes: 1, timeMs: 10000, propagate: false });
  assert.equal(partial.complete, false);
  assert.equal(partial.worlds, 0);
  assert.deepEqual(partial.contradictions, []);
});

test("MRV is deterministic and returns assignments in original player order", () => {
  const input = model();
  input.players[2].candidates = ["imp"];
  assert.deepEqual(solve(input, ample), solve(input, ample));
  for (const example of solve(input, ample).examples) {
    assert.deepEqual(Object.keys(example), ["p0", "p1", "p2"]);
    assert.equal(example.p2, "imp");
  }
});

test("malicious player, role and constraint IDs cannot pollute prototypes", () => {
  const input = {
    players: [
      { id: "__proto__", candidates: [] },
      { id: "constructor", candidates: [] },
      { id: "toString", candidates: [] },
    ],
    roles: ["__proto__", "constructor", "toString"].map((id) => ({ id, team: "townsfolk" })),
    counts: counts(3),
    constraints: [{
      id: "__proto__", players: ["__proto__", "constructor"], roleIds: ["__proto__"], min: 1, max: 1,
    }],
  };
  const result = assertMatchesOracle(input);
  assert.equal(result.worlds, 4);
  assert.equal(Object.getPrototypeOf(result.marginals), null);
  assert.equal(Object.getPrototypeOf(result.marginals.__proto__), null);
  assert.equal(result.marginals.__proto__.__proto__, 2);
  assert.equal(Object.hasOwn(result.examples[0], "__proto__"), true);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal({}.constructor, Object);
  assert.deepEqual(plain(structuredClone(result)), plain(result));
});

test("inherited IDs cannot satisfy references or required fields", () => {
  const input = model();
  input.players[0].candidates = ["__proto__"];
  assert.throws(() => solve(input), /inconnu/);
  input.players[0] = Object.create({ id: "inherited", candidates: [] });
  assert.throws(() => solve(input), /obligatoire/);
  input.players[0] = { id: "p0", candidates: [] };
  input.counts = Object.create(counts(1, 0, 1, 1));
  assert.throws(() => solve(input), /obligatoire/);
});

test("input is not mutated and null-prototype records are supported", () => {
  const input = model();
  input.players[0].candidates = ["imp", "washer", "washer"];
  const before = structuredClone(input);
  function freeze(value) {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  }
  solve(freeze(input), ample);
  assert.deepEqual(input, before);
  const nullRecord = Object.assign(Object.create(null), before);
  assertMatchesOracle(nullRecord);
});

test("invalid model shapes, IDs, teams, counts and bounds always throw Error", () => {
  const mutations = [
    (input) => { input.players = []; },
    (input) => { input.players = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, candidates: [] })); },
    (input) => { input.players = null; },
    (input) => { input.players[0] = null; },
    (input) => { input.players[0].id = ""; },
    (input) => { input.players[0].id = " "; },
    (input) => { input.players[0].id = 1; },
    (input) => { input.players[0].id = input.players[1].id; },
    (input) => { delete input.players[0].candidates; },
    (input) => { input.players[0].candidates = "washer"; },
    (input) => { input.players[0].candidates = ["missing"]; },
    (input) => { input.players[0].candidates = [null]; },
    (input) => { input.roles = {}; },
    (input) => { input.roles[0] = []; },
    (input) => { input.roles[0].id = " "; },
    (input) => { input.roles[0].id = input.roles[1].id; },
    (input) => { input.roles[0].team = "traveller"; },
    (input) => { input.roles[0].team = "__proto__"; },
    (input) => { delete input.roles[0].team; },
    (input) => { input.counts = null; },
    (input) => { input.counts.townsfolk = -1; },
    (input) => { input.counts.townsfolk = 1.5; },
    (input) => { input.counts.townsfolk = Infinity; },
    (input) => { input.counts.townsfolk = "1"; },
    (input) => { input.counts.townsfolk = 2; },
    (input) => { delete input.counts.outsider; },
    (input) => { input.counts.traveller = 0; },
    (input) => { input.counts = JSON.parse('{"townsfolk":1,"outsider":0,"minion":1,"demon":1,"__proto__":0}'); },
    (input) => { input.constraints = null; },
    (input) => { input.constraints = [null]; },
    (input) => { input.constraints = [Object.create({ id: "x", players: [], roleIds: [], min: 0, max: 0 })]; },
  ];
  for (const mutate of mutations) {
    const input = model();
    mutate(input);
    assert.throws(() => solve(input), Error, String(mutate));
  }
  for (const invalid of [null, undefined, true, [], "input"]) assert.throws(() => solve(invalid), Error);
  const base = { id: "c", players: ["p0"], roleIds: ["imp"], min: 0, max: 1 };
  const bad = [
    { id: "" }, { id: null }, { players: ["unknown"] }, { players: ["constructor"] },
    { players: "p0" }, { roleIds: ["unknown"] }, { roleIds: null }, { min: -1 },
    { min: 1.5 }, { min: "0" }, { min: 2 }, { max: 2 }, { max: -1 }, { max: NaN },
  ];
  for (const override of bad) {
    const input = model();
    input.constraints = [{ ...base, ...override }];
    assert.throws(() => solve(input), Error, JSON.stringify(override));
  }
  for (const key of ["id", "players", "roleIds", "min", "max"]) {
    const input = model();
    input.constraints = [{ ...base }];
    delete input.constraints[0][key];
    assert.throws(() => solve(input), Error);
  }
  const duplicate = model();
  duplicate.constraints = [{ ...base }, { ...base }];
  assert.throws(() => solve(duplicate), /dupliqué/);
  for (const constraint of [
    { id: "bad-type", type: "near", roleIds: ["imp"], min: 0, max: 1 },
    { id: "bad-adj", type: "adjacent-pairs", players: ["p0"], roleIds: ["imp"], min: 0, max: 1 },
    { id: "bad-neighbour", type: "player-neighbours", playerId: "missing", roleIds: ["imp"], min: 0, max: 1 },
    { id: "bad-pair", type: "pair-count", pairs: [{ playerId: "p0", roleId: "missing" }], min: 0, max: 1 },
  ]) assert.throws(() => solve({ ...model(), constraints: [constraint] }), Error);
});

test("solver options reject malformed values and clamp large valid budgets", () => {
  for (const options of [
    null, [], { maxNodes: -1 }, { maxNodes: 1.1 }, { maxNodes: Infinity },
    { maxWorlds: 0 }, { maxWorlds: "1" }, { maxWorlds: -1 },
    { timeMs: -1 }, { timeMs: NaN }, { timeMs: Infinity }, { timeMs: "10" },
    { maxNodes: undefined }, { misspelled: 4 }, JSON.parse('{"__proto__":1}'),
  ]) assert.throws(() => solve(model(), options), Error);
  const result = solve(model(), {
    maxNodes: Number.MAX_SAFE_INTEGER,
    timeMs: Number.MAX_SAFE_INTEGER,
    maxWorlds: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(result.complete, true);
  assert.equal(result.worlds, 12);
});

test("one-player and twenty-player manually fixed models are supported", () => {
  assert.equal(assertMatchesOracle(model(1)).worlds, 2);
  const input = model(20);
  input.roles = input.players.map((_, i) => ({ id: `r${i}`, team: "townsfolk" }));
  input.players.forEach((player, i) => { player.candidates = [`r${i}`]; });
  assert.equal(assertMatchesOracle(input).worlds, 1);
});

test("deterministic randomized small models agree with exhaustive brute force", () => {
  let seed = 928379;
  const random = (max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % max;
  };
  for (let iteration = 0; iteration < 200; iteration++) {
    const n = 1 + random(5);
    const input = model(n);
    input.roles = Array.from({ length: n + random(3) }, (_, i) => ({
      id: `r${i}`, team: teams[random(teams.length)],
    }));
    input.counts = counts(0);
    for (let i = 0; i < n; i++) input.counts[teams[random(teams.length)]]++;
    input.players.forEach((player) => {
      player.candidates = random(4) ? input.roles.filter(() => random(3) !== 0).map((role) => role.id) : [];
    });
    input.constraints = Array.from({ length: random(4) }, (_, i) => {
      const scoped = input.players.filter(() => random(3) !== 0).map((player) => player.id);
      const min = random(scoped.length + 1);
      return {
        id: `c${i}`, players: scoped,
        roleIds: input.roles.filter(() => random(3) !== 0).map((role) => role.id),
        min, max: min + random(scoped.length - min + 1),
      };
    });
    assertMatchesOracle(input);
  }
});

test("randomized satisfiable models never lose a witness through pruning", () => {
  let seed = 198163;
  const random = (max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % max;
  };
  for (let iteration = 0; iteration < 150; iteration++) {
    const n = 1 + random(5);
    const input = model(n);
    input.roles = Array.from({ length: n + random(3) }, (_, i) => ({
      id: `r${i}`, team: teams[random(teams.length)],
    }));
    const pool = input.roles.slice();
    const witness = input.players.map(() => pool.splice(random(pool.length), 1)[0]);
    input.counts = counts(0);
    witness.forEach((role) => { input.counts[role.team]++; });
    input.players.forEach((player, i) => {
      player.candidates = random(3) ? input.roles
        .filter((role) => role.id === witness[i].id || random(2)).map((role) => role.id) : [];
    });
    input.constraints = Array.from({ length: random(5) }, (_, i) => {
      const scoped = input.players.filter(() => random(3) !== 0).map((player) => player.id);
      const roleIds = input.roles.filter(() => random(3) !== 0).map((role) => role.id);
      const matches = input.players.filter((player, index) =>
        scoped.includes(player.id) && roleIds.includes(witness[index].id)).length;
      return {
        id: `c${i}`, players: scoped, roleIds,
        min: random(matches + 1), max: matches + random(scoped.length - matches + 1),
      };
    });
    assert.ok(assertMatchesOracle(input).worlds > 0);
  }
});

test("propagation is optional, reports candidate reduction, and preserves witnesses", () => {
  const input = model(4);
  input.counts = counts(4);
  input.roles = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, team: "townsfolk" }));
  input.players[0].candidates = ["r0", "r1"];
  input.constraints = [{ id: "force-p0", players: ["p0"], roleIds: ["r0"], min: 1, max: 1 }];
  const pruned = solve(input, ample);
  const raw = solve(input, { ...ample, propagate: false });
  assert.equal(pruned.worlds, raw.worlds);
  assert.deepEqual(plain(pruned.marginals), plain(raw.marginals));
  assert.ok(pruned.pruning.removed >= 1);
  assert.ok(pruned.pruning.before > pruned.pruning.after);
  assert.ok(pruned.pruning.nodes > 0);
  assert.ok(pruned.pruning.timeMs >= 0);
});

test("worker imports the native module and echoes IDs for results and errors", async (t) => {
  const workerUrl = new URL("../js/inference-worker.js", import.meta.url);
  const worker = new Worker(`
    const { parentPort } = require("node:worker_threads");
    globalThis.self = {
      addEventListener(type, callback) {
        if (type !== "message") throw new Error("Unexpected worker event");
        parentPort.on("message", data => callback({ data }));
      },
      postMessage(message) { parentPort.postMessage(message); }
    };
    import(${JSON.stringify(workerUrl.href)}).then(() => parentPort.postMessage("ready"));
  `, { eval: true });
  t.after(() => worker.terminate());
  assert.deepEqual(await once(worker, "message"), ["ready"]);
  const resultPromise = once(worker, "message");
  worker.postMessage({ id: "request-old", input: model(), options: ample });
  const [success] = await resultPromise;
  assert.equal(success.id, "request-old");
  assert.equal(success.result.worlds, 12);
  const errorPromise = once(worker, "message");
  worker.postMessage({ id: "request-new", input: null });
  const [failure] = await errorPromise;
  assert.equal(failure.id, "request-new");
  assert.equal(typeof failure.error, "string");
  assert.equal(Object.hasOwn(failure, "result"), false);
});
