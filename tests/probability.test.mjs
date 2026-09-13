import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { estimate, explain } from "../js/probability.js";
import { solve } from "../js/inference.js";

const exactOptions = { maxNodes: 2000000, timeMs: 5000, maxWorlds: 100000 };
const sampleOptions = { maxNodes: 0, maxSamples: 8000, sampleTimeMs: 5000, seed: 4921 };
const counts = (townsfolk, outsider = 0, minion = 0, demon = 0) => ({ townsfolk, outsider, minion, demon });
const plain = (value) => JSON.parse(JSON.stringify(value));
const close = (actual, expected, epsilon = 1e-10) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `Expected ${actual} near ${expected} (tolerance ${epsilon})`);

function model(n = 3, roleCount = 4) {
  return {
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, candidates: [] })),
    roles: Array.from({ length: roleCount }, (_, i) => ({ id: `r${i}`, team: "townsfolk" })),
    counts: counts(n),
    constraints: [],
    factors: [],
  };
}

function bruteForce(input) {
  const assignment = Object.create(null);
  const used = new Set();
  const teamCounts = counts(0);
  const worlds = [];
  const roleMap = new Map(input.roles.map((role) => [role.id, role]));
  function visit(index) {
    if (index === input.players.length) {
      if (Object.keys(teamCounts).some((team) => teamCounts[team] !== input.counts[team])) return;
      for (const constraint of input.constraints ?? []) {
        let matches = 0;
        if (constraint.type === "adjacent-pairs") {
          const n = input.players.length;
          const edges = n === 2 ? [[0, 1]] : Array.from({ length: n > 1 ? n : 0 }, (_, i) => [i, (i + 1) % n]);
          matches = edges.filter(([a, b]) =>
            constraint.roleIds.includes(assignment[input.players[a].id]) &&
            constraint.roleIds.includes(assignment[input.players[b].id])).length;
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
          matches = neighbours.filter((i) => constraint.roleIds.includes(assignment[input.players[i].id])).length;
        } else if (constraint.type === "pair-count") {
          matches = constraint.pairs.filter((pair) => assignment[pair.playerId] === pair.roleId).length;
        } else {
          matches = [...new Set(constraint.players)]
            .filter((player) => constraint.roleIds.includes(assignment[player])).length;
        }
        if (matches < constraint.min || matches > constraint.max) return;
      }
      let weight = 1;
      for (const factor of input.factors ?? []) {
        const matches = factor.scope === "player"
          ? factor.roleIds.includes(assignment[factor.playerId])
          : [...used].some((role) => factor.roleIds.includes(role));
        weight *= matches ? factor.match : factor.miss;
      }
      worlds.push({ assignment: { ...assignment }, weight });
      return;
    }
    const player = input.players[index];
    const candidates = player.candidates.length ? [...new Set(player.candidates)] : [...roleMap.keys()];
    for (const role of candidates) {
      if (used.has(role)) continue;
      const team = roleMap.get(role).team;
      if (teamCounts[team] >= input.counts[team]) continue;
      assignment[player.id] = role;
      used.add(role);
      teamCounts[team]++;
      visit(index + 1);
      teamCounts[team]--;
      used.delete(role);
      delete assignment[player.id];
    }
  }
  visit(0);
  const sum = worlds.reduce((total, world) => total + world.weight, 0);
  const probabilities = Object.create(null);
  const presence = Object.create(null);
  for (const player of input.players) {
    probabilities[player.id] = Object.create(null);
    for (const role of player.candidates.length ? player.candidates : roleMap.keys()) {
      probabilities[player.id][role] = worlds.reduce((total, world) =>
        total + (world.assignment[player.id] === role ? world.weight : 0), 0) / sum;
    }
  }
  for (const role of roleMap.keys()) {
    presence[role] = worlds.reduce((total, world) =>
      total + (Object.values(world.assignment).includes(role) ? world.weight : 0), 0) / sum;
  }
  return { worlds: worlds.length, probabilities, presence };
}

function checkProbabilities(result, expected, epsilon = 1e-10) {
  assert.equal(result.reliable, true);
  for (const [player, roles] of Object.entries(expected.probabilities)) {
    for (const [role, probability] of Object.entries(roles)) {
      close(result.probabilities[player][role] ?? 0, probability, epsilon);
    }
    close(Object.values(result.probabilities[player]).reduce((a, b) => a + b, 0), 1);
  }
  for (const [role, probability] of Object.entries(expected.presence)) {
    close(result.presence[role] ?? 0, probability, epsilon);
  }
}

test("unweighted exact probabilities equal solve combinatorial ratios", () => {
  const input = model();
  const exact = estimate(input, exactOptions);
  const uniform = solve(input, exactOptions);
  assert.equal(exact.method, "exact");
  assert.equal(exact.complete, true);
  assert.equal(exact.draws, 0);
  assert.equal(exact.worlds, uniform.worlds);
  assert.equal(exact.accepted, uniform.worlds);
  close(exact.ess, exact.worlds);
  assert.equal(exact.precision, 0);
  for (const row of Object.values(exact.halfWidth.probabilities)) {
    for (const width of Object.values(row)) close(width, 0);
  }
  for (const width of Object.values(exact.halfWidth.presence)) close(width, 0);
  for (const player of input.players) {
    for (const role of input.roles) {
      close(exact.probabilities[player.id][role.id], uniform.marginals[player.id][role.id] / uniform.worlds);
    }
  }
  checkProbabilities(exact, bruteForce(input));
});

test("exact player and presence factors multiply with a uniform assignment prior", () => {
  const input = model();
  input.factors = [
    { id: "claim", scope: "player", playerId: "p0", roleIds: ["r0"], match: 5, miss: 1 },
    { id: "present", scope: "presence", roleIds: ["r1"], match: 2, miss: 1 },
    { id: "counter", scope: "player", playerId: "p1", roleIds: ["r2", "r3"], match: 0.5, miss: 3 },
  ];
  const result = estimate(input, exactOptions);
  checkProbabilities(result, bruteForce(input));
  assert.equal(result.worlds, 24);
  assert.ok(result.ess < result.worlds);
  assert.equal(result.examples.length, 5);
});

test("presence includes multiple minions and sums to the fixed team count, not one", () => {
  const input = model(4, 6);
  input.roles.forEach((role, index) => { role.team = index < 2 ? "townsfolk" : index < 5 ? "minion" : "demon"; });
  input.counts = counts(1, 0, 2, 1);
  input.factors = [{ id: "presence", scope: "presence", roleIds: ["r2"], match: 5, miss: 1 }];
  const result = estimate(input, exactOptions);
  checkProbabilities(result, bruteForce(input));
  close(result.presence.r2, 10 / 11);
  close(result.presence.r2 + result.presence.r3 + result.presence.r4, 2);
  close(Object.values(result.presence).reduce((a, b) => a + b, 0), 4);
});

test("exact evidence weighting respects hard domains, uniqueness and overlapping constraints", () => {
  const input = model(4, 6);
  input.players[0].candidates = ["r0", "r1", "r2"];
  input.constraints = [
    { id: "one", players: ["p0", "p1"], roleIds: ["r0", "r1"], min: 1, max: 1 },
    { id: "two", players: ["p1", "p2", "p3"], roleIds: ["r2", "r3", "r4"], min: 2, max: 3 },
  ];
  input.factors = [{ id: "claim", scope: "player", playerId: "p1", roleIds: ["r2"], match: 20, miss: 1 }];
  checkProbabilities(estimate(input, exactOptions), bruteForce(input));
});

test("unit multiplier factors leave the distribution unchanged", () => {
  const input = model();
  const before = estimate(input, exactOptions);
  input.factors = [
    { id: "q1", scope: "player", playerId: "p0", roleIds: ["r0"], match: 1, miss: 1 },
    { id: "p1", scope: "presence", roleIds: ["r1"], match: 1, miss: 1 },
  ];
  assert.deepEqual(estimate(input, exactOptions), before);
});

test("zero factors remove weighted support but do not alter hard world counts", () => {
  const input = model();
  input.factors = [{ id: "zero", scope: "player", playerId: "p0", roleIds: ["r0"], match: 0, miss: 1 }];
  const result = estimate(input, exactOptions);
  assert.equal(result.worlds, 24);
  assert.equal(result.accepted, 18);
  assert.equal(result.probabilities.p0.r0, 0);
  checkProbabilities(result, bruteForce(input));
  input.factors.push({ id: "inverse", scope: "player", playerId: "p0", roleIds: ["r0"], match: 1, miss: 0 });
  const zero = estimate(input, exactOptions);
  assert.equal(zero.complete, true);
  assert.equal(zero.worlds, 24);
  assert.equal(zero.accepted, 0);
  assert.equal(zero.reliable, false);
  assert.equal(zero.reason, "zero-weight");
  assert.deepEqual(plain(zero.probabilities), {});
  assert.deepEqual(plain(zero.presence), {});
  assert.equal(zero.contradictions.length, 1);
});

test("log normalization remains stable when all raw weights would underflow or overflow", () => {
  for (const multiplier of [1e-100, 100]) {
    const input = model(1, 2);
    input.factors = Array.from({ length: 100 }, (_, i) => ({
      id: `f${i}`, scope: "player", playerId: "p0", roleIds: ["r0"],
      match: i === 0 ? multiplier / 2 : multiplier, miss: multiplier,
    }));
    const result = estimate(input, exactOptions);
    assert.equal(result.reliable, true);
    close(result.probabilities.p0.r0, 1 / 3, 1e-10);
    close(result.probabilities.p0.r1, 2 / 3, 1e-10);
    assert.ok(Number.isFinite(result.ess));
  }
});

test("proven impossible models and finite-sample failures are distinguished", () => {
  const input = model(4, 4);
  input.players.forEach((player, i) => { player.candidates = i < 3 ? ["r0", "r1"] : ["r2", "r3"]; });
  const exact = estimate(input, exactOptions);
  assert.equal(exact.complete, true);
  assert.equal(exact.worlds, 0);
  assert.equal(exact.reliable, false);
  assert.ok(exact.contradictions.length > 0);
  const sampled = estimate(input, { ...sampleOptions, maxSamples: 1000 });
  assert.equal(sampled.method, "importance");
  assert.equal(sampled.complete, false);
  assert.equal(sampled.draws, 1000);
  assert.equal(sampled.accepted, 0);
  assert.equal(sampled.reason, "no-positive-samples");
  assert.deepEqual(sampled.contradictions, []);
  assert.deepEqual(plain(sampled.probabilities), {});
});

test("importance estimates preserve symmetric role/team marginals", () => {
  const input = model(4, 6);
  input.roles.forEach((role, i) => { role.team = i < 3 ? "townsfolk" : i < 5 ? "minion" : "demon"; });
  input.counts = counts(2, 0, 1, 1);
  const result = estimate(input, sampleOptions);
  assert.equal(result.method, "importance");
  assert.equal(result.complete, false);
  assert.equal(result.draws, sampleOptions.maxSamples);
  assert.equal(result.accepted, result.draws);
  close(result.ess, result.draws, 1e-6);
  assert.ok(result.precision <= (sampleOptions.maxHalfWidth ?? 0.03));
  for (const [player, row] of Object.entries(result.probabilities)) {
    assert.deepEqual(Object.keys(result.halfWidth.probabilities[player]), Object.keys(row));
    for (const width of Object.values(result.halfWidth.probabilities[player])) {
      assert.ok(Number.isFinite(width) && width >= 0 && width <= 1);
    }
  }
  assert.deepEqual(Object.keys(result.halfWidth.presence), Object.keys(result.presence));
  for (const width of Object.values(result.halfWidth.presence)) {
    assert.ok(Number.isFinite(width) && width >= 0 && width <= 1);
  }
  checkProbabilities(result, bruteForce(input), 0.025);
});

test("reported 95% half-widths cover the exact value at roughly the claimed rate", () => {
  const input = model(4, 6);
  input.roles.forEach((role, i) => { role.team = i < 3 ? "townsfolk" : i < 5 ? "minion" : "demon"; });
  input.counts = counts(2, 0, 1, 1);
  const truth = bruteForce(input).probabilities.p1.r1;
  let covered = 0;
  const runs = 200;
  for (let seed = 1; seed <= runs; seed++) {
    const result = estimate(input, {
      maxNodes: 0, maxSamples: 800, sampleTimeMs: 5000, seed, maxHalfWidth: 1,
    });
    assert.equal(result.reliable, true);
    const estimateValue = result.probabilities.p1.r1;
    const width = result.halfWidth.probabilities.p1.r1;
    if (Math.abs(estimateValue - truth) <= width) covered++;
  }
  const coverage = covered / runs;
  console.log(`SNIS half-width empirical coverage: ${(100 * coverage).toFixed(1)}% (${covered}/${runs})`);
  assert.ok(coverage >= 0.9 && coverage <= 1);
});

test("inverse proposal correction handles adaptive asymmetric domains and evidence weights", () => {
  const input = model();
  input.players[0].candidates = ["r0", "r1"];
  input.players[1].candidates = ["r0", "r2"];
  input.factors = [{ id: "e", scope: "player", playerId: "p2", roleIds: ["r3"], match: 5, miss: 1 }];
  const result = estimate(input, sampleOptions);
  checkProbabilities(result, bruteForce(input), 0.025);
});

test("rejected paths count as independent zero-weight draws, without retry-until-success bias", () => {
  const input = model(4, 5);
  input.players[0].candidates = ["r0", "r1"];
  input.players[1].candidates = ["r0", "r2"];
  input.players[2].candidates = ["r0", "r2"];
  input.players[3].candidates = ["r3", "r4"];
  const result = estimate(input, sampleOptions);
  assert.ok(result.accepted > 3000 && result.accepted < 5000);
  assert.equal(result.draws, 8000);
  checkProbabilities(result, bruteForce(input), 0.025);
});

test("importance pruning obeys overlapping hard constraints", () => {
  const input = model(4, 6);
  input.constraints = [
    { id: "one", players: ["p0", "p1"], roleIds: ["r0", "r1"], min: 1, max: 1 },
    { id: "two", players: ["p1", "p2", "p3"], roleIds: ["r2", "r3"], min: 1, max: 2 },
  ];
  input.factors = [{ id: "e", scope: "presence", roleIds: ["r4"], match: 2, miss: 1 }];
  const result = estimate(input, sampleOptions);
  checkProbabilities(result, bruteForce(input), 0.035);
});

test("weighted adjacency and pair-count constraints agree with brute force", () => {
  const input = model(5, 6);
  input.constraints = [
    { id: "chef", type: "adjacent-pairs", roleIds: ["r0", "r1"], min: 1, max: 2 },
    { id: "empath", type: "player-neighbours", playerId: "p0", skipPlayers: ["p1"], roleIds: ["r2"], min: 0, max: 1 },
    { id: "juggle", type: "pair-count", pairs: [{ playerId: "p0", roleId: "r0" }, { playerId: "p3", roleId: "r3" }], min: 1, max: 2 },
  ];
  input.factors = [{ id: "claim", scope: "player", playerId: "p0", roleIds: ["r0"], match: 3, miss: 1 }];
  checkProbabilities(estimate(input, exactOptions), bruteForce(input));
});

test("explain reports signed impacts sorted by absolute effect and budget truncation", () => {
  const input = model(2, 3);
  input.factors = [
    { id: "strong", scope: "player", playerId: "p0", roleIds: ["r0"], match: 9, miss: 1 },
    { id: "weak", scope: "presence", roleIds: ["r2"], match: 2, miss: 1 },
  ];
  const result = explain(input, { ...exactOptions, target: { scope: "player", playerId: "p0", roleId: "r0" }, budget: 10 });
  close(result.baseline.probability, 27 / 34);
  assert.equal(result.impacts[0].id, "strong");
  assert.ok(result.impacts[0].delta < 0);
  assert.ok(Math.abs(result.impacts[0].delta) >= Math.abs(result.impacts[1].delta));
  const truncated = explain(input, { ...exactOptions, target: { scope: "presence", roleId: "r2" }, budget: 1 });
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.impacts.length, 0);
});

test("minimal conflict returns a sufficient greedy subset without claiming global uniqueness", () => {
  const input = model(2, 2);
  input.constraints = [
    { id: "p0-r0", players: ["p0"], roleIds: ["r0"], min: 1, max: 1 },
    { id: "p1-r0", players: ["p1"], roleIds: ["r0"], min: 1, max: 1 },
  ];
  const result = explain(input, { ...exactOptions, target: { scope: "presence", roleId: "r0" }, minimalConflict: true, budget: 10 });
  assert.equal(result.baseline.worlds, 0);
  assert.equal(result.greedySufficientConflict.sufficient, true);
  assert.ok(result.greedySufficientConflict.constraintIds.length > 0);
  assert.equal(estimate(withoutIds(input, result.greedySufficientConflict.constraintIds), exactOptions).worlds > 0, true);
  assert.equal(result.greedySufficientConflict.note, "greedy-sufficient-not-global-minimum");
});

function withoutIds(input, ids) {
  const set = new Set(ids);
  return { ...input, constraints: input.constraints.filter((constraint) => !set.has(constraint.id)) };
}

test("sampling discards the DFS prefix and is repeatable for a fixed seed and draw budget", () => {
  const input = model();
  input.factors = [{ id: "e", scope: "player", playerId: "p0", roleIds: ["r0"], match: 20, miss: 1 }];
  const a = estimate(input, { ...sampleOptions, maxSamples: 3000 });
  const b = estimate(input, { ...sampleOptions, maxSamples: 3000, maxNodes: 100000, maxWorlds: 1 });
  assert.equal(a.worlds, 0);
  assert.equal(b.worlds, 1);
  for (const key of ["probabilities", "presence", "draws", "accepted", "ess", "examples"]) {
    assert.deepEqual(a[key], b[key]);
  }
  assert.deepEqual(a, estimate(input, { ...sampleOptions, maxSamples: 3000 }));
});

test("minimum accepted and ESS thresholds suppress unreliable distributions", () => {
  const small = estimate(model(), { ...sampleOptions, maxSamples: 199 });
  assert.equal(small.accepted, 199);
  assert.equal(small.reliable, false);
  assert.deepEqual(plain(small.probabilities), {});
  assert.deepEqual(plain(small.presence), {});
  const input = model(1, 2);
  input.factors = Array.from({ length: 10 }, (_, i) => ({
    id: `f${i}`, scope: "player", playerId: "p0", roleIds: ["r0"], match: 100, miss: 1,
  }));
  const concentrated = estimate(input, { ...sampleOptions, maxSamples: 300 });
  assert.equal(concentrated.accepted, 300);
  assert.ok(concentrated.ess < 200);
  assert.equal(concentrated.reliable, false);
  assert.equal(concentrated.reason, "insufficient-effective-samples");
  assert.deepEqual(plain(concentrated.probabilities), {});
});

test("precision gate rejects wide 2000-sample estimates that pass count and ESS thresholds", () => {
  const input = model(2, 4);
  input.factors = [{ id: "claim", scope: "player", playerId: "p0", roleIds: ["r0"], match: 20, miss: 1 }];
  const result = estimate(input, {
    maxNodes: 0, maxSamples: 2000, sampleTimeMs: 5000, seed: 4921,
  });
  assert.equal(result.accepted, 2000);
  assert.ok(result.ess >= 200);
  assert.ok(result.precision > 0.03);
  assert.equal(result.reliable, false);
  assert.equal(result.reason, "precision");
  assert.deepEqual(plain(result.probabilities), {});
  assert.deepEqual(plain(result.presence), {});
  assert.deepEqual(plain(result.halfWidth.probabilities), {});
  assert.deepEqual(plain(result.halfWidth.presence), {});
});

test("sampled zero-frequency outcomes are omitted, never emitted as exclusions", () => {
  const input = model(1, 2);
  input.factors = [{ id: "e", scope: "player", playerId: "p0", roleIds: ["r0"], match: 1, miss: 0 }];
  const result = estimate(input, { ...sampleOptions, maxSamples: 2000 });
  assert.equal(result.reliable, true);
  assert.equal(Object.hasOwn(result.probabilities.p0, "r1"), false);
  assert.equal(Object.hasOwn(result.presence, "r1"), false);
  for (const row of Object.values(result.probabilities)) {
    assert.ok(Object.values(row).every((probability) => probability > 0 && probability <= 1));
  }
  assert.deepEqual(result.contradictions, []);
});

test("sampling time is bounded inside large proposal loops", (t) => {
  let clock = 0;
  t.mock.method(globalThis.performance, "now", () => clock++);
  const result = estimate(model(20, 200), {
    maxNodes: 0, timeMs: 0, maxSamples: 100000, sampleTimeMs: 5,
  });
  assert.equal(result.complete, false);
  assert.equal(result.draws, 1);
  assert.equal(result.accepted, 0);
  assert.equal(result.nodes, 1);
  assert.deepEqual(plain(result.probabilities), {});
});

test("estimate shares one absolute deadline across exact search and sampling", (t) => {
  let clock = 0;
  t.mock.method(globalThis.performance, "now", () => clock++);
  const result = estimate(model(20, 200), {
    maxNodes: 2000000, timeMs: 5, maxWorlds: 100000,
    maxSamples: 100000, sampleTimeMs: 5000, deadlineMs: 5,
  });
  assert.equal(result.method, "importance");
  assert.equal(result.complete, false);
  assert.equal(result.draws, 0);
  assert.equal(result.accepted, 0);
  assert.equal(result.reliable, false);
  assert.deepEqual(plain(result.probabilities), {});
});

test("explain stops all impact runs at its global deadline", (t) => {
  const input = model(15, 114);
  input.factors = Array.from({ length: 25 }, (_, i) => ({
    id: `f${i}`, scope: "player", playerId: `p${i % 15}`,
    roleIds: [`r${i}`], match: 2, miss: 1,
  }));
  let clock = 0;
  t.mock.method(globalThis.performance, "now", () => clock++);
  const result = explain(input, {
    target: { scope: "presence", roleId: "r0" },
    budget: 24, deadlineMs: 20,
    maxNodes: 60000, timeMs: 400, maxWorlds: 12000,
    maxSamples: 6000, sampleTimeMs: 600, seed: 41721,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.truncationReason, "deadline");
  assert.ok(result.runs < 24);
  assert.equal(result.impacts.length, result.runs - 1);
});

test("minimal-conflict search consumes the same explain deadline", (t) => {
  const input = model(2, 2);
  input.constraints = [
    { id: "p0-r0", players: ["p0"], roleIds: ["r0"], min: 1, max: 1 },
    { id: "p1-r0", players: ["p1"], roleIds: ["r0"], min: 1, max: 1 },
  ];
  let clock = 0;
  t.mock.method(globalThis.performance, "now", () => clock++);
  const result = explain(input, {
    target: { scope: "presence", roleId: "r0" },
    minimalConflict: true, budget: 50, deadlineMs: 80,
    maxNodes: 2000000, timeMs: 5000, maxWorlds: 100000,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.truncationReason, "deadline");
  assert.ok(result.runs < 50);
  assert.equal(result.greedySufficientConflict?.truncated, true);
  assert.equal(result.greedySufficientConflict?.truncationReason, "deadline");
});

test("factor list deduplication and hostile keys are prototype-safe", () => {
  const input = model(1, 2);
  input.players[0].id = "__proto__";
  input.roles[0].id = "__proto__";
  input.roles[1].id = "constructor";
  input.factors = [{
    id: "__proto__", scope: "player", playerId: "__proto__",
    roleIds: ["__proto__", "__proto__"], match: 5, miss: 1,
  }];
  const result = estimate(input, exactOptions);
  close(result.probabilities.__proto__.__proto__, 5 / 6);
  assert.equal(Object.getPrototypeOf(result.probabilities), null);
  assert.equal(Object.getPrototypeOf(result.probabilities.__proto__), null);
  assert.equal(Object.getPrototypeOf(result.presence), null);
  assert.equal({}.constructor, Object);
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(plain(structuredClone(result)), plain(result));
});

test("excludeFactors exactly matches removing factors and ignores unknown IDs", () => {
  const input = model(4, 6);
  input.players[0].candidates = ["r0", "r1", "r2"];
  input.constraints = [
    { id: "one", players: ["p0", "p1"], roleIds: ["r0", "r1"], min: 1, max: 2 },
  ];
  input.factors = [
    { id: "keep", scope: "player", playerId: "p1", roleIds: ["r2"], match: 5, miss: 1 },
    { id: "drop", scope: "presence", roleIds: ["r3"], match: 20, miss: 1 },
  ];
  const withoutDrop = { ...input, factors: input.factors.filter((factor) => factor.id !== "drop") };
  assert.deepEqual(
    estimate(input, { ...exactOptions, excludeFactors: ["drop", "missing"] }),
    estimate(withoutDrop, exactOptions),
  );
  assert.deepEqual(
    estimate(input, { ...sampleOptions, excludeFactors: ["drop", "missing"] }),
    estimate(withoutDrop, sampleOptions),
  );
  assert.throws(() => estimate(input, { excludeFactors: ["drop", 1] }), Error);
});

test("input assumptions and options are never mutated", () => {
  const input = model();
  input.factors = [{ id: "e", scope: "presence", roleIds: ["r0"], match: 2, miss: 1 }];
  const before = structuredClone(input);
  function freeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  freeze(input);
  estimate(input, Object.freeze({ ...exactOptions }));
  estimate(input, Object.freeze({ ...sampleOptions, maxSamples: 250 }));
  assert.deepEqual(input, before);
});

test("strict factors, roles, options and inherited properties validation", () => {
  const factor = { id: "e", scope: "player", playerId: "p0", roleIds: ["r0"], match: 2, miss: 1 };
  for (const override of [
    { id: "" }, { id: 1 }, { scope: "other" }, { playerId: "missing" },
    { playerId: "__proto__" }, { roleIds: ["missing"] }, { roleIds: ["__proto__"] },
    { roleIds: [null] }, { roleIds: "r0" }, { match: -1 }, { match: 101 },
    { match: Infinity }, { match: NaN }, { match: "2" }, { miss: -1 },
    { miss: Infinity }, { match: 0, miss: 0 },
  ]) {
    const input = model();
    input.factors = [{ ...factor, ...override }];
    assert.throws(() => estimate(input), Error, JSON.stringify(override));
  }
  for (const field of Object.keys(factor)) {
    const input = model();
    input.factors = [{ ...factor }];
    delete input.factors[0][field];
    assert.throws(() => estimate(input), Error);
  }
  for (const factors of [null, {}, [null], [Object.create(factor)], [factor, factor],
    Array.from({ length: 101 }, (_, i) => ({ ...factor, id: String(i) }))]) {
    assert.throws(() => estimate({ ...model(), factors }), Error);
  }
  assert.throws(() => estimate({ ...model(), factors: [{ ...factor, scope: "presence" }] }), Error);
  assert.throws(() => estimate(model(1, 201)), /200/);
  assert.throws(() => estimate({ ...model(), players: [{ id: "p0", candidates: ["missing"] }] }), Error);
  for (const options of [
    null, [], { seed: 1.5 }, { seed: Infinity }, { seed: "1" }, { maxSamples: -1 },
    { maxSamples: 2.2 }, { sampleTimeMs: Infinity }, { sampleTimeMs: -1 },
    { deadlineMs: Infinity }, { deadlineMs: -1 },
    { maxHalfWidth: -0.1 }, { maxHalfWidth: Infinity }, { excludeFactors: [null] },
    { maxWorlds: 0 }, { maxNodes: undefined }, { unknown: 2 }, JSON.parse('{"__proto__":1}'),
  ]) assert.throws(() => estimate(model(), options), Error);
  assert.equal(estimate(model(1, 200), { maxNodes: 0, maxSamples: 0 }).reliable, false);
  assert.equal(estimate(model(), { seed: -1 }).complete, true);
});

test("empty presence role lists always use miss and omitted factors mean unit weights", () => {
  const input = model(1, 2);
  delete input.factors;
  const uniform = estimate(input);
  input.factors = [{ id: "empty", scope: "presence", roleIds: [], match: 20, miss: 1 }];
  assert.deepEqual(estimate(input), uniform);
});

test("worker estimate mode preserves solve fallback and request IDs", async (t) => {
  const url = new URL("../js/inference-worker.js", import.meta.url);
  const worker = new Worker(`
    const { parentPort } = require("node:worker_threads");
    globalThis.self = {
      addEventListener(type, handler) { parentPort.on("message", data => handler({ data })); },
      postMessage(message) { parentPort.postMessage(message); }
    };
    import(${JSON.stringify(url.href)}).then(() => parentPort.postMessage("ready"));
  `, { eval: true });
  t.after(() => worker.terminate());
  assert.deepEqual(await once(worker, "message"), ["ready"]);
  const request = async (data) => {
    const promise = once(worker, "message");
    worker.postMessage(data);
    const [response] = await promise;
    assert.equal(response.id, data.id);
    return response;
  };
  const weighted = await request({ id: "estimate-1", mode: "estimate", input: model() });
  assert.equal(weighted.result.method, "exact");
  assert.equal(weighted.result.reliable, true);
  const normal = await request({ id: "solve-2", input: model() });
  assert.equal(Object.hasOwn(normal.result, "method"), false);
  assert.equal(normal.result.worlds, 24);
  const invalid = await request({ id: "error-3", mode: "estimate", input: { ...model(), factors: null } });
  assert.equal(typeof invalid.error, "string");
});
