import { enumerateAssignments, parseInferenceInput } from "./inference.js";

const DEFAULTS = {
  maxNodes: 100000, timeMs: 700, maxWorlds: 20000,
  maxSamples: 20000, sampleTimeMs: 1200, seed: 2654435769,
  maxHalfWidth: 0.03, excludeFactors: [],
};
const CAPS = {
  maxNodes: 2000000, timeMs: 5000, maxWorlds: 100000,
  maxSamples: 100000, sampleTimeMs: 5000, deadlineMs: 5000,
};
const DEFAULT_EXPLAIN_DEADLINE_MS = 2000;
const Z_95 = 1.96;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const empty = () => Object.create(null);
const now = () => globalThis.performance?.now() ?? Date.now();

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} doit être un objet.`);
  }
}

function optionsFor(options) {
  object(options, "options");
  for (const key of Object.keys(options)) {
    if (!own(DEFAULTS, key) && key !== "deadlineMs") throw new Error(`Option inconnue « ${key} ».`);
  }
  const result = {};
  for (const key of Object.keys(DEFAULTS)) {
    const value = own(options, key) ? options[key] : DEFAULTS[key];
    if (key === "excludeFactors") {
      if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
        throw new Error("options.excludeFactors doit être une liste d'identifiants texte.");
      }
      result[key] = [...value];
      continue;
    }
    if (key === "maxHalfWidth") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("options.maxHalfWidth doit être un nombre fini entre 0 et 1.");
      }
      result[key] = value;
      continue;
    }
    const isTime = key === "timeMs" || key === "sampleTimeMs";
    if (typeof value !== "number" || !Number.isFinite(value) ||
        (!isTime && !Number.isSafeInteger(value)) ||
        (key !== "seed" && value < (key === "maxWorlds" ? 1 : 0))) {
      throw new Error(`Option numérique invalide : ${key}.`);
    }
    result[key] = own(CAPS, key) ? Math.min(value, CAPS[key]) : value;
  }
  const deadlineMs = own(options, "deadlineMs")
    ? options.deadlineMs
    : Math.max(result.timeMs, result.sampleTimeMs);
  if (typeof deadlineMs !== "number" || !Number.isFinite(deadlineMs) || deadlineMs < 0) {
    throw new Error("Option numérique invalide : deadlineMs.");
  }
  result.deadlineMs = Math.min(deadlineMs, CAPS.deadlineMs);
  return result;
}

function factorsFor(input, model, excludedIds = new Set()) {
  const factors = own(input, "factors") ? input.factors : [];
  if (!Array.isArray(factors) || factors.length > 100) {
    throw new Error("factors doit être une liste contenant au maximum 100 facteurs.");
  }
  const players = new Map(model.players.map((player, index) => [player.id, index]));
  const roles = new Map(model.roles.map((role, index) => [role.id, index]));
  const ids = new Set();
  return Array.from(factors, (factor, index) => {
    object(factor, `factors[${index}]`);
    if (!own(factor, "id") || typeof factor.id !== "string" || !factor.id.trim()) {
      throw new Error(`factors[${index}].id doit être un identifiant texte non vide.`);
    }
    if (excludedIds.has(factor.id)) return null;
    if (ids.has(factor.id)) throw new Error(`Identifiant de facteur dupliqué : « ${factor.id} ».`);
    ids.add(factor.id);
    if (!own(factor, "scope") || !["player", "presence"].includes(factor.scope)) {
      throw new Error(`Portée de facteur invalide : « ${factor.id} ».`);
    }
    if (factor.scope === "player" && (!own(factor, "playerId") || !players.has(factor.playerId))) {
      throw new Error(`Joueur inconnu pour le facteur « ${factor.id} ».`);
    }
    if (factor.scope === "presence" && own(factor, "playerId")) {
      throw new Error(`Le facteur de présence « ${factor.id} » ne doit pas cibler un joueur.`);
    }
    if (!own(factor, "roleIds") || !Array.isArray(factor.roleIds)) {
      throw new Error(`Liste de rôles invalide pour le facteur « ${factor.id} ».`);
    }
    const roleSet = new Set();
    for (const roleId of factor.roleIds) {
      if (!roles.has(roleId)) throw new Error(`Rôle inconnu pour le facteur « ${factor.id} ».`);
      roleSet.add(roles.get(roleId));
    }
    for (const key of ["match", "miss"]) {
      if (!own(factor, key) || typeof factor[key] !== "number" ||
          !Number.isFinite(factor[key]) || factor[key] < 0 || factor[key] > 100) {
        throw new Error(`Le multiplicateur ${key} de « ${factor.id} » doit être compris entre 0 et 100.`);
      }
    }
    if (factor.match === 0 && factor.miss === 0) {
      throw new Error(`Le facteur « ${factor.id} » doit avoir au moins un multiplicateur positif.`);
    }
    return {
      player: factor.scope === "player" ? players.get(factor.playerId) : -1,
      roles: roleSet, match: Math.log(factor.match), miss: Math.log(factor.miss),
    };
  }).filter(Boolean);
}

function logFactorWeight(assignment, factors) {
  let value = 0;
  for (const factor of factors) {
    const matched = factor.player === -1
      ? assignment.some((role) => factor.roles.has(role))
      : factor.roles.has(assignment[factor.player]);
    value += matched ? factor.match : factor.miss;
    if (value === -Infinity) return value;
  }
  return value;
}

function accumulator(model) {
  const { players, roles } = model;
  const cells = new Float64Array(players.length * roles.length);
  const cellSquares = new Float64Array(players.length * roles.length);
  const present = new Float64Array(roles.length);
  const presentSquares = new Float64Array(roles.length);
  const examples = [];
  let maximum = -Infinity;
  let sum = 0;
  let squares = 0;
  let accepted = 0;

  function add(assignment, logWeight) {
    if (logWeight === -Infinity) return;
    accepted++;
    if (logWeight > maximum) {
      const scale = Math.exp(maximum - logWeight);
      sum *= scale;
      squares *= scale * scale;
      for (let i = 0; i < cells.length; i++) cells[i] *= scale;
      for (let i = 0; i < cellSquares.length; i++) cellSquares[i] *= scale * scale;
      for (let i = 0; i < present.length; i++) present[i] *= scale;
      for (let i = 0; i < presentSquares.length; i++) presentSquares[i] *= scale * scale;
      maximum = logWeight;
    }
    const weight = Math.exp(logWeight - maximum);
    const weightSquared = weight * weight;
    sum += weight;
    squares += weightSquared;
    const example = examples.length < 5 ? empty() : null;
    for (let player = 0; player < players.length; player++) {
      const role = assignment[player];
      cells[player * roles.length + role] += weight;
      cellSquares[player * roles.length + role] += weightSquared;
      // Role uniqueness makes occurrence probability equal to presence probability.
      present[role] += weight;
      presentSquares[role] += weightSquared;
      if (example !== null) example[players[player].id] = roles[role].id;
    }
    if (example !== null) examples.push(example);
  }

  function distribution(exact) {
    const probabilities = empty();
    const presence = empty();
    const halfWidthProbabilities = empty();
    const halfWidthPresence = empty();
    const probability = (weight) => Math.min(1, Math.max(0, weight / sum));
    let precision = exact ? 0 : Number.POSITIVE_INFINITY;
    const halfWidth = (weight, squaredHits) => {
      if (exact) return 0;
      const p = probability(weight);
      const variance = sum > 0
        ? (squaredHits * (1 - p) * (1 - p) + (squares - squaredHits) * p * p) / (sum * sum)
        : Number.POSITIVE_INFINITY;
      return Z_95 * Math.sqrt(Math.max(0, variance));
    };
    const includeWidth = (width) => {
      if (!exact) precision = Math.max(precision === Number.POSITIVE_INFINITY ? 0 : precision, width);
    };
    for (let player = 0; player < players.length; player++) {
      const row = empty();
      const widthRow = empty();
      for (const role of players[player].candidates) {
        const weight = cells[player * roles.length + role];
        // Unobserved outcomes are omitted in sampled output, never ruled out.
        if (exact || weight > 0) {
          const width = halfWidth(weight, cellSquares[player * roles.length + role]);
          row[roles[role].id] = probability(weight);
          widthRow[roles[role].id] = width;
          includeWidth(width);
        }
      }
      probabilities[players[player].id] = row;
      halfWidthProbabilities[players[player].id] = widthRow;
    }
    for (let role = 0; role < roles.length; role++) {
      if (exact || present[role] > 0) {
        const width = halfWidth(present[role], presentSquares[role]);
        presence[roles[role].id] = probability(present[role]);
        halfWidthPresence[roles[role].id] = width;
        includeWidth(width);
      }
    }
    const halfWidthMaps = empty();
    halfWidthMaps.probabilities = halfWidthProbabilities;
    halfWidthMaps.presence = halfWidthPresence;
    return { probabilities, presence, halfWidth: halfWidthMaps, precision };
  }

  return {
    add, distribution, examples,
    get accepted() { return accepted; },
    get ess() { return squares > 0 ? Math.min(accepted, sum * sum / squares) : 0; },
  };
}

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function roleState(assignment, available, player, roleSet) {
  const assigned = assignment[player];
  if (assigned !== -1) return roleSet.has(assigned) ? "yes" : "no";
  const domain = available[player] ?? [];
  let matches = 0;
  for (const role of domain) if (roleSet.has(role)) matches++;
  if (matches === 0) return "no";
  return matches === domain.length ? "forced" : "maybe";
}

function bounds(constraint, assignment, available) {
  let lower = 0;
  let upper = 0;
  if (constraint.type === "pair-count") {
    for (const pair of constraint.pairs) {
      const assigned = assignment[pair.player];
      if (assigned !== -1) {
        if (assigned === pair.role) lower++, upper++;
      } else if ((available[pair.player] ?? []).includes(pair.role)) {
        upper++;
        if ((available[pair.player] ?? []).length === 1) lower++;
      }
    }
  } else if (constraint.type === "adjacent-pairs") {
    for (const [a, b] of constraint.edges) {
      const left = roleState(assignment, available, a, constraint.roles);
      const right = roleState(assignment, available, b, constraint.roles);
      if ((left === "yes" || left === "forced") && (right === "yes" || right === "forced")) lower++;
      if (left !== "no" && right !== "no") upper++;
    }
  } else if (constraint.type === "player-neighbours") {
    for (const player of constraint.neighbours) {
      const state = roleState(assignment, available, player, constraint.roles);
      if (state === "yes" || state === "forced") lower++;
      if (state !== "no") upper++;
    }
  } else {
    for (const player of constraint.players) {
      const state = roleState(assignment, available, player, constraint.roles);
      if (state === "yes" || state === "forced") lower++;
      if (state !== "no") upper++;
    }
  }
  return { lower, upper };
}

function sample(model, factors, limits, totals, sharedDeadline) {
  const sampleDeadline = now() + limits.sampleTimeMs;
  const deadline = Math.min(sharedDeadline, sampleDeadline);
  const deadlineReason = sharedDeadline <= sampleDeadline ? "deadline-limit" : "sample-time-limit";
  const random = randomSource(limits.seed);
  const { players, roles, counts, constraints } = model;
  const assignment = new Int32Array(players.length);
  const used = new Uint8Array(roles.length);
  const remaining = new Int32Array(4);
  let draws = 0;
  let nodes = 0;
  let operations = 0;
  let expired = false;
  const checkTime = () => {
    if (now() >= deadline) expired = true;
    return expired;
  };
  const tick = () => ++operations % 128 === 0 && checkTime();

  function proposal(depth) {
    const available = new Array(players.length);
    const teamSizes = new Array(players.length);
    const possible = [0, 0, 0, 0];
    const forced = [0, 0, 0, 0];
    const union = new Uint8Array(roles.length);
    const unionTeams = [0, 0, 0, 0];
    let selected = -1;
    for (let player = 0; player < players.length; player++) {
      if (assignment[player] !== -1) continue;
      const domain = [];
      const teamSize = [0, 0, 0, 0];
      for (const role of players[player].candidates) {
        if (tick()) return null;
        const team = roles[role].team;
        if (used[role] || remaining[team] === 0) continue;
        domain.push(role);
        teamSize[team]++;
        if (!union[role]) {
          union[role] = 1;
          unionTeams[team]++;
        }
      }
      if (domain.length === 0) return null;
      available[player] = domain;
      teamSizes[player] = teamSize;
      let teamKinds = 0;
      let onlyTeam = -1;
      for (let team = 0; team < 4; team++) {
        if (teamSize[team]) {
          possible[team]++;
          teamKinds++;
          onlyTeam = team;
        }
      }
      if (teamKinds === 1) forced[onlyTeam]++;
      if (selected === -1 || domain.length < available[selected].length) selected = player;
    }
    if (unionTeams.reduce((sum, count) => sum + count, 0) < players.length - depth) return null;
    for (let team = 0; team < 4; team++) {
      if (unionTeams[team] < remaining[team] || possible[team] < remaining[team] ||
          forced[team] > remaining[team]) return null;
    }
    for (let index = 0; index < constraints.length; index++) {
      if (tick()) return null;
      const constraint = constraints[index];
      const { lower, upper } = bounds(constraint, assignment, available);
      if (lower > constraint.max || upper < constraint.min) return null;
    }

    const size = teamSizes[selected];
    let capacity = 0;
    for (let team = 0; team < 4; team++) if (size[team]) capacity += remaining[team];
    let target = random() * capacity;
    let selectedTeam = -1;
    for (let team = 0; team < 4; team++) {
      if (!size[team]) continue;
      selectedTeam = team;
      target -= remaining[team];
      if (target < 0) break;
    }
    let targetRole = Math.floor(random() * size[selectedTeam]);
    let selectedRole = -1;
    for (const role of available[selected]) {
      if (roles[role].team === selectedTeam && targetRole-- === 0) {
        selectedRole = role;
        break;
      }
    }
    return {
      player: selected, role: selectedRole,
      logProposal: Math.log(remaining[selectedTeam]) - Math.log(capacity) - Math.log(size[selectedTeam]),
    };
  }

  while (draws < limits.maxSamples && !checkTime()) {
    // Every attempt is a draw, including rejected or zero-weight paths.
    draws++;
    assignment.fill(-1);
    used.fill(0);
    remaining.set(counts);
    if (expired) break;
    let logProposal = 0;
    let valid = true;
    for (let depth = 0; depth < players.length; depth++) {
      nodes++;
      const choice = proposal(depth);
      if (choice === null) {
        valid = false;
        break;
      }
      assignment[choice.player] = choice.role;
      used[choice.role] = 1;
      remaining[roles[choice.role].team]--;
      logProposal += choice.logProposal;
    }
    if (expired) break;
    if (valid) {
      for (let index = 0; index < constraints.length; index++) {
        if (tick()) { valid = false; break; }
        const exact = bounds(constraints[index], assignment, []);
        if (exact.lower < constraints[index].min || exact.upper > constraints[index].max || exact.lower !== exact.upper) {
          valid = false;
          break;
        }
      }
    }
    if (valid && !expired) totals.add(assignment, logFactorWeight(assignment, factors) - logProposal);
  }
  return { draws, nodes, reason: expired ? deadlineReason : "sample-limit" };
}

// Uniform prior on complete valid assignments, reweighted only by user factors.
// Importance results are estimates under these assumptions, not real likelihoods.
export function estimate(input, options = {}) {
  const started = now();
  const limits = optionsFor(options);
  const deadline = started + limits.deadlineMs;
  object(input, "input");
  if (Array.isArray(input.roles) && input.roles.length > 200) {
    throw new Error("Le modèle probabiliste accepte au maximum 200 rôles.");
  }
  const model = parseInferenceInput(input);
  const factors = factorsFor(input, model, new Set(limits.excludeFactors));
  let totals = accumulator(model);
  const exact = enumerateAssignments(input, {
    maxNodes: limits.maxNodes,
    timeMs: Math.min(limits.timeMs, Math.max(0, deadline - now())),
    maxWorlds: limits.maxWorlds,
  }, (assignment) => totals.add(assignment, logFactorWeight(assignment, factors)));
  if (exact.complete) {
    const reliable = totals.accepted > 0;
    const zeroWeight = exact.worlds > 0 && !reliable;
    const distribution = reliable ? totals.distribution(true) : {
      probabilities: empty(), presence: empty(),
      halfWidth: Object.assign(empty(), { probabilities: empty(), presence: empty() }),
      precision: 0,
    };
    return {
      method: "exact", complete: true, worlds: exact.worlds, nodes: exact.nodes,
      draws: 0, accepted: totals.accepted, ess: totals.ess, reliable,
      ...distribution,
      reason: zeroWeight ? "zero-weight" : null,
      contradictions: zeroWeight
        ? ["Toutes les affectations compatibles ont un poids nul. Les multiplicateurs choisis ne définissent aucune distribution."]
        : exact.contradictions,
      examples: totals.examples,
    };
  }

  // Discard all DFS-prefix statistics before drawing independent importance samples.
  totals = accumulator(model);
  const sampled = sample(model, factors, limits, totals, deadline);
  const distribution = totals.accepted > 0 ? totals.distribution(false) : {
    probabilities: empty(), presence: empty(),
    halfWidth: Object.assign(empty(), { probabilities: empty(), presence: empty() }),
    precision: Number.POSITIVE_INFINITY,
  };
  const enoughSamples = totals.accepted >= 200 && totals.ess >= 200;
  const reliable = enoughSamples && distribution.precision <= limits.maxHalfWidth;
  const emptyHalfWidth = Object.assign(empty(), { probabilities: empty(), presence: empty() });
  return {
    method: "importance", complete: false, worlds: exact.worlds, nodes: exact.nodes + sampled.nodes,
    draws: sampled.draws, accepted: totals.accepted, ess: totals.ess, reliable,
    ...(reliable ? distribution : {
      probabilities: empty(), presence: empty(), halfWidth: emptyHalfWidth, precision: distribution.precision,
    }),
    reason: reliable ? sampled.reason
      : totals.accepted > 0
        ? enoughSamples && distribution.precision > limits.maxHalfWidth
          ? "precision"
          : "insufficient-effective-samples"
        : "no-positive-samples",
    contradictions: [], examples: totals.examples,
  };
}
function targetValue(result, target) {
  if (target.scope === "presence") return result.presence?.[target.roleId] ?? 0;
  return result.probabilities?.[target.playerId]?.[target.roleId] ?? 0;
}

function explainOptions(options) {
  object(options, "options");
  if (!own(options, "target")) throw new Error("options.target est obligatoire / options.target is required.");
  const target = options.target;
  object(target, "options.target");
  if (target.scope !== "player" && target.scope !== "presence") {
    throw new Error("options.target.scope doit valoir player ou presence / must be player or presence.");
  }
  if (typeof target.roleId !== "string" || !target.roleId.trim()) {
    throw new Error("options.target.roleId est obligatoire / roleId is required.");
  }
  if (target.scope === "player" && (typeof target.playerId !== "string" || !target.playerId.trim())) {
    throw new Error("options.target.playerId est obligatoire / playerId is required.");
  }
  const budget = own(options, "budget") ? options.budget : 50;
  if (!Number.isSafeInteger(budget) || budget < 1) throw new Error("options.budget doit être un entier positif / must be a positive integer.");
  const minimalConflict = own(options, "minimalConflict") ? options.minimalConflict : false;
  if (typeof minimalConflict !== "boolean") throw new Error("options.minimalConflict doit être booléen / must be boolean.");
  const deadlineMs = own(options, "deadlineMs") ? options.deadlineMs : DEFAULT_EXPLAIN_DEADLINE_MS;
  if (typeof deadlineMs !== "number" || !Number.isFinite(deadlineMs) || deadlineMs < 0) {
    throw new Error("options.deadlineMs doit être un nombre fini positif ou nul / must be a finite non-negative number.");
  }
  const estimateOptions = {};
  for (const [key, value] of Object.entries(options)) {
    if (key !== "target" && key !== "budget" && key !== "minimalConflict" && key !== "deadlineMs") estimateOptions[key] = value;
  }
  return {
    target, budget, minimalConflict,
    deadlineMs: Math.min(deadlineMs, CAPS.deadlineMs),
    estimateOptions,
  };
}

function withoutConstraint(input, ids) {
  return { ...input, constraints: (input.constraints ?? []).filter((constraint) => !ids.has(constraint.id)) };
}

function findGreedySufficientConflict(input, estimateOptions, budget, deadline) {
  const constraints = input.constraints ?? [];
  const removed = new Set();
  let runs = 0;
  let truncated = false;
  let truncationReason = null;
  const stop = (reason) => {
    truncated = true;
    truncationReason ??= reason;
    return null;
  };
  const hasWorld = (ids) => {
    if (now() >= deadline) return stop("deadline");
    if (runs >= budget) return stop("budget");
    runs++;
    const result = estimate(withoutConstraint(input, ids), {
      ...estimateOptions,
      deadlineMs: Math.max(0, deadline - now()),
    });
    const possible = result.complete && result.worlds > 0 && result.accepted > 0;
    if (now() >= deadline) {
      stop("deadline");
      return possible ? true : null;
    }
    return possible;
  };
  for (const constraint of constraints) {
    const possible = hasWorld(removed);
    if (possible === null || possible) break;
    removed.add(constraint.id);
  }
  const initial = truncated ? null : hasWorld(removed);
  let sufficient = initial === true;
  if (sufficient) {
    for (const id of [...removed]) {
      const trial = new Set(removed);
      trial.delete(id);
      const possible = hasWorld(trial);
      if (possible === null) break;
      if (possible) removed.delete(id);
    }
    if (!truncated) sufficient = hasWorld(removed) === true;
  }
  return {
    constraintIds: [...removed], sufficient, runs, truncated, truncationReason,
    note: "greedy-sufficient-not-global-minimum",
  };
}

export function explain(input, options = {}) {
  const started = now();
  const parsed = explainOptions(options);
  const deadline = started + parsed.deadlineMs;
  const model = parseInferenceInput(input);
  const playerIds = new Set(model.players.map((player) => player.id));
  const roleIds = new Set(model.roles.map((role) => role.id));
  if (!roleIds.has(parsed.target.roleId)) throw new Error("Rôle cible inconnu / Unknown target role.");
  if (parsed.target.scope === "player" && !playerIds.has(parsed.target.playerId)) {
    throw new Error("Joueur cible inconnu / Unknown target player.");
  }
  const baseline = estimate(input, {
    ...parsed.estimateOptions,
    deadlineMs: Math.max(0, deadline - now()),
  });
  const baseProbability = targetValue(baseline, parsed.target);
  const impacts = [];
  let runs = 1;
  let truncated = false;
  let truncationReason = null;
  const stop = (reason) => {
    truncated = true;
    truncationReason ??= reason;
    return false;
  };
  const canRun = () => {
    if (now() >= deadline) return stop("deadline");
    if (runs >= parsed.budget) return stop("budget");
    return true;
  };
  const run = (kind, id, candidate, estimateOptions = parsed.estimateOptions) => {
    if (!canRun()) return;
    runs++;
    const result = estimate(candidate, {
      ...estimateOptions,
      deadlineMs: Math.max(0, deadline - now()),
    });
    const probability = targetValue(result, parsed.target);
    impacts.push({ kind, id, probability, delta: probability - baseProbability, reliable: result.reliable, reason: result.reason });
    if (now() >= deadline) stop("deadline");
  };
  for (const factor of input.factors ?? []) {
    const opts = { ...parsed.estimateOptions, excludeFactors: [...(parsed.estimateOptions.excludeFactors ?? []), factor.id] };
    run("factor", factor.id, input, opts);
    if (truncated) break;
  }
  for (const constraint of truncated ? [] : input.constraints ?? []) {
    run("constraint", constraint.id, withoutConstraint(input, new Set([constraint.id])));
    if (truncated) break;
  }
  impacts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const result = {
    target: { ...parsed.target },
    baseline: { probability: baseProbability, reliable: baseline.reliable, reason: baseline.reason, worlds: baseline.worlds, accepted: baseline.accepted },
    impacts,
    budget: parsed.budget,
    runs,
    truncated,
    truncationReason,
  };
  if (parsed.minimalConflict && baseline.complete && (baseline.worlds === 0 || baseline.accepted === 0)) {
    const remaining = parsed.budget - runs;
    if (now() >= deadline) stop("deadline");
    else if (remaining < 1) stop("budget");
    else {
      result.greedySufficientConflict = findGreedySufficientConflict(
        input, parsed.estimateOptions, remaining, deadline,
      );
      if (result.greedySufficientConflict.truncated) {
        stop(result.greedySufficientConflict.truncationReason);
      }
      result.runs += result.greedySufficientConflict.runs;
    }
    result.truncated = truncated;
    result.truncationReason = truncationReason;
  }
  return result;
}
