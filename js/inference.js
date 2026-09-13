const TEAMS = ["townsfolk", "outsider", "minion", "demon"];
const TEAM_INDEX = new Map(TEAMS.map((team, index) => [team, index]));
const DEFAULTS = { maxNodes: 350000, timeMs: 1200, maxWorlds: 50000, propagate: true, measureTime: false };
const LIMITS = { maxNodes: 2000000, timeMs: 10000, maxWorlds: 500000 };
const MAX_EXAMPLES = 5;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} doit être un objet.`);
  }
  return value;
}

function required(object, key, label) {
  if (!own(object, key)) throw new Error(`${label}.${key} est obligatoire.`);
  return object[key];
}

function list(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} doit être une liste.`);
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} doit être un identifiant texte non vide.`);
  }
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} doit être un entier supérieur ou égal à ${minimum}.`);
  }
  return value;
}

function uniqueReferences(values, index, label) {
  const result = new Set();
  for (const value of list(values, label)) {
    identifier(value, label);
    if (!index.has(value)) throw new Error(`${label} : identifiant inconnu « ${value} ».`);
    result.add(index.get(value));
  }
  return [...result];
}

function parseOptions(options) {
  record(options, "options");
  const parsed = {};
  for (const key of Object.keys(options)) {
    if (!own(DEFAULTS, key)) throw new Error(`Option inconnue « ${key} ».`);
  }
  for (const key of Object.keys(DEFAULTS)) {
    const value = own(options, key) ? options[key] : DEFAULTS[key];
    if (key === "timeMs") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error("options.timeMs doit être un nombre fini positif ou nul.");
      }
    } else if (key === "propagate" || key === "measureTime") {
      if (typeof value !== "boolean") throw new Error(`options.${key} doit être booléen / options.${key} must be boolean.`);
    } else {
      integer(value, `options.${key}`, key === "maxWorlds" ? 1 : 0);
    }
    parsed[key] = own(LIMITS, key) ? Math.min(value, LIMITS[key]) : value;
  }
  return parsed;
}

function parseInput(input) {
  record(input, "input");
  const rawPlayers = list(required(input, "players", "input"), "players");
  if (rawPlayers.length < 1 || rawPlayers.length > 20) {
    throw new Error("Le modèle accepte de 1 à 20 joueurs hors voyageurs.");
  }
  const rawRoles = list(required(input, "roles", "input"), "roles");
  const rawCounts = record(required(input, "counts", "input"), "counts");
  for (const key of Object.keys(rawCounts)) {
    if (!TEAM_INDEX.has(key)) throw new Error(`Équipe inconnue dans counts : « ${key} ».`);
  }
  const counts = TEAMS.map((team) => integer(required(rawCounts, team, "counts"), `counts.${team}`));
  if (counts.reduce((sum, count) => sum + count, 0) !== rawPlayers.length) {
    throw new Error("La somme des effectifs doit correspondre au nombre de joueurs du modèle.");
  }
  const roleIndex = new Map();
  const roles = Array.from(rawRoles, (value, index) => {
    const role = record(value, `roles[${index}]`);
    const id = identifier(required(role, "id", `roles[${index}]`), `roles[${index}].id`);
    if (roleIndex.has(id)) throw new Error(`Identifiant de rôle dupliqué : « ${id} ».`);
    const team = required(role, "team", `roles[${index}]`);
    if (!TEAM_INDEX.has(team)) throw new Error(`Équipe de rôle inconnue : « ${String(team)} ».`);
    roleIndex.set(id, index);
    return { id, team: TEAM_INDEX.get(team) };
  });
  const allRoles = roles.map((_, index) => index);
  const playerIndex = new Map();
  const players = Array.from(rawPlayers, (value, index) => {
    const player = record(value, `players[${index}]`);
    const id = identifier(required(player, "id", `players[${index}]`), `players[${index}].id`);
    if (playerIndex.has(id)) throw new Error(`Identifiant de joueur dupliqué : « ${id} ».`);
    const candidates = uniqueReferences(
      required(player, "candidates", `players[${index}]`),
      roleIndex,
      `players[${index}].candidates`,
    );
    playerIndex.set(id, index);
    return { id, candidates: candidates.length ? candidates.sort((a, b) => a - b) : allRoles };
  });
  const constraintIds = new Set();
  const rawConstraints = own(input, "constraints") ? list(input.constraints, "constraints") : [];
  const constraints = Array.from(rawConstraints, (value, index) => {
    const label = `constraints[${index}]`;
    const constraint = record(value, label);
    const id = identifier(required(constraint, "id", label), `${label}.id`);
    if (constraintIds.has(id)) throw new Error(`Identifiant de contrainte dupliqué : « ${id} ».`);
    constraintIds.add(id);
    const type = own(constraint, "type") ? identifier(constraint.type, `${label}.type`) : "cardinality";
    const min = integer(required(constraint, "min", label), `${label}.min`);
    const max = integer(required(constraint, "max", label), `${label}.max`);
    if (min > max) throw new Error(`${label} : bornes invalides / invalid bounds.`);
    if (type === "cardinality") {
      const scopedPlayers = uniqueReferences(required(constraint, "players", label), playerIndex, `${label}.players`);
      const roleIds = uniqueReferences(required(constraint, "roleIds", label), roleIndex, `${label}.roleIds`);
      if (max > scopedPlayers.length) {
        throw new Error(`${label} : bornes invalides pour ${scopedPlayers.length} joueurs distincts.`);
      }
      return { id, type, players: scopedPlayers, roles: new Set(roleIds), min, max };
    }
    if (type === "adjacent-pairs") {
      const roleIds = uniqueReferences(required(constraint, "roleIds", label), roleIndex, `${label}.roleIds`);
      const edgeCount = players.length < 2 ? 0 : players.length === 2 ? 1 : players.length;
      if (own(constraint, "players")) throw new Error(`${label}.players interdit / forbidden for adjacent-pairs.`);
      if (max > edgeCount) throw new Error(`${label} : bornes invalides pour ${edgeCount} voisinages / invalid adjacency bounds.`);
      const edges = [];
      if (players.length === 2) edges.push([0, 1]);
      else for (let player = 0; player < players.length; player++) edges.push([player, (player + 1) % players.length]);
      return { id, type, edges, roles: new Set(roleIds), min, max };
    }
    if (type === "player-neighbours") {
      const player = uniqueReferences([required(constraint, "playerId", label)], playerIndex, `${label}.playerId`)[0];
      const roleIds = uniqueReferences(required(constraint, "roleIds", label), roleIndex, `${label}.roleIds`);
      const skipPlayers = own(constraint, "skipPlayers")
        ? new Set(uniqueReferences(constraint.skipPlayers, playerIndex, `${label}.skipPlayers`))
        : new Set();
      const neighbours = [];
      if (players.length > 1) {
        for (const step of [-1, 1]) {
          for (let offset = 1; offset < players.length; offset++) {
            const candidate = (player + step * offset + players.length) % players.length;
            if (candidate === player || skipPlayers.has(candidate)) continue;
            if (!neighbours.includes(candidate)) neighbours.push(candidate);
            break;
          }
        }
      }
      if (max > neighbours.length) throw new Error(`${label} : bornes invalides pour ${neighbours.length} voisins / invalid neighbour bounds.`);
      return { id, type, player, neighbours, skipPlayers, roles: new Set(roleIds), min, max };
    }
    if (type === "pair-count") {
      const pairIds = list(required(constraint, "pairs", label), `${label}.pairs`);
      const seenPairs = new Set();
      const pairs = pairIds.map((pair, pairIndex) => {
        const item = record(pair, `${label}.pairs[${pairIndex}]`);
        const player = uniqueReferences([required(item, "playerId", `${label}.pairs[${pairIndex}]`)], playerIndex, `${label}.pairs[${pairIndex}].playerId`)[0];
        const role = uniqueReferences([required(item, "roleId", `${label}.pairs[${pairIndex}]`)], roleIndex, `${label}.pairs[${pairIndex}].roleId`)[0];
        const key = `${player}:${role}`;
        if (seenPairs.has(key)) throw new Error(`${label}.pairs contient un doublon / duplicate pair.`);
        seenPairs.add(key);
        return { player, role };
      });
      if (max > pairs.length) throw new Error(`${label} : bornes invalides pour ${pairs.length} paires / invalid pair bounds.`);
      return { id, type, pairs, min, max };
    }
    throw new Error(`${label}.type inconnu « ${type} » / unknown constraint type.`);
  });
  return { players, roles, counts, constraints };
}

export { parseInput as parseInferenceInput };

export function baseCounts(n) {
  integer(n, "Nombre de joueurs", 5);
  if (n > 15) throw new Error("Les effectifs de base sont définis de 5 à 15 joueurs hors voyageurs.");
  const distributions = [
    [3, 0, 1, 1], [3, 1, 1, 1], [5, 0, 1, 1], [5, 1, 1, 1],
    [5, 2, 1, 1], [7, 0, 2, 1], [7, 1, 2, 1], [7, 2, 2, 1],
    [9, 0, 3, 1], [9, 1, 3, 1], [9, 2, 3, 1],
  ];
  return Object.fromEntries(TEAMS.map((team, index) => [team, distributions[n - 5][index]]));
}

function roleCanMatch(assignment, available, player, roleSet) {
  const role = assignment[player];
  if (role !== -1) return roleSet.has(role) ? "yes" : "no";
  const domain = available[player] ?? [];
  let matches = 0;
  for (const candidate of domain) if (roleSet.has(candidate)) matches++;
  if (matches === 0) return "no";
  if (matches === domain.length) return "forced";
  return "maybe";
}

function pairCanMatch(assignment, available, pair) {
  const assigned = assignment[pair.player];
  if (assigned !== -1) return assigned === pair.role ? "yes" : "no";
  const domain = available[pair.player] ?? [];
  if (!domain.includes(pair.role)) return "no";
  return domain.length === 1 ? "forced" : "maybe";
}

function constraintBounds(constraint, assignment, available, roles, remaining) {
  let lower = 0;
  let upper = 0;
  if (constraint.type === "pair-count") {
    for (const pair of constraint.pairs) {
      const state = pairCanMatch(assignment, available, pair);
      if (state === "yes" || state === "forced") lower++;
      if (state !== "no") upper++;
    }
    return { lower, upper };
  }
  if (constraint.type === "adjacent-pairs") {
    for (const [a, b] of constraint.edges) {
      const left = roleCanMatch(assignment, available, a, constraint.roles);
      const right = roleCanMatch(assignment, available, b, constraint.roles);
      if ((left === "yes" || left === "forced") && (right === "yes" || right === "forced")) lower++;
      if (left !== "no" && right !== "no") upper++;
    }
    return { lower, upper };
  }
  if (constraint.type === "player-neighbours") {
    for (const player of constraint.neighbours) {
      const state = roleCanMatch(assignment, available, player, constraint.roles);
      if (state === "yes" || state === "forced") lower++;
      if (state !== "no") upper++;
    }
    return { lower, upper };
  }
  let assignedMatches = 0;
  let forcedMatches = 0;
  let possibleMatches = 0;
  let unresolvedPlayers = 0;
  let possibleNonMatches = 0;
  const distinctMatches = new Set();
  const distinctNonMatches = new Set();
  const matchingTeams = [0, 0, 0, 0];
  const nonMatchingTeams = [0, 0, 0, 0];
  for (const player of constraint.players) {
    const role = assignment[player];
    if (role !== -1) {
      if (constraint.roles.has(role)) assignedMatches++;
      continue;
    }
    unresolvedPlayers++;
    let matches = 0;
    for (const candidate of available[player] ?? []) {
      if (constraint.roles.has(candidate)) {
        matches++;
        if (!distinctMatches.has(candidate)) {
          distinctMatches.add(candidate);
          matchingTeams[roles[candidate].team]++;
        }
      } else if (!distinctNonMatches.has(candidate)) {
        distinctNonMatches.add(candidate);
        nonMatchingTeams[roles[candidate].team]++;
      }
    }
    if (matches > 0) possibleMatches++;
    if (matches === (available[player] ?? []).length) forcedMatches++;
    else possibleNonMatches++;
  }
  const teamCapacity = matchingTeams.reduce((sum, count, team) => sum + Math.min(count, remaining[team]), 0);
  const nonMatchingCapacity = nonMatchingTeams.reduce((sum, count, team) => sum + Math.min(count, remaining[team]), 0);
  upper = assignedMatches + Math.min(possibleMatches, distinctMatches.size, teamCapacity);
  const nonMatches = Math.min(possibleNonMatches, distinctNonMatches.size, nonMatchingCapacity);
  lower = assignedMatches + Math.max(forcedMatches, unresolvedPlayers - nonMatches);
  return { lower, upper };
}

// These are combinatorial initial-role assignments under explicit assumptions,
// not likelihoods or a simulation of character abilities or alignment changes.
export function solve(input, options = {}) {
  return enumerateAssignments(input, options);
}

// The observer receives transient numeric role indexes in original player order.
// It must consume them synchronously without modifying the assignment.
export function enumerateAssignments(input, options = {}, onWorld) {
  const limits = parseOptions(options);
  const { players, roles, counts, constraints } = parseInput(input);
  const now = () => globalThis.performance?.now() ?? Date.now();
  const deadline = now() + limits.timeMs;
  const marginals = Object.create(null);
  const domains = players.map((player) => {
    const row = Object.create(null);
    for (const index of player.candidates) row[roles[index].id] = 0;
    marginals[player.id] = row;
    return player.candidates.filter((index) => counts[roles[index].team] > 0);
  });
  const examples = [];
  let worlds = 0;
  let nodes = 0;
  let reason = null;
  let rootConflict = null;
  let pruning = { before: 0, after: 0, removed: 0, nodes: 0, timeMs: 0, truncated: false };

  function result(contradictions = []) {
    return {
      complete: reason === null,
      worlds,
      nodes,
      reason,
      // A partial enumeration has no usable marginals, even if worlds is zero.
      marginals: reason === null ? marginals : Object.create(null),
      examples,
      contradictions: reason === null ? contradictions : [],
      pruning,
    };
  }

  const initialConflicts = [];
  const eligibleRoles = new Set(domains.flat());
  if (eligibleRoles.size < players.length) {
    initialConflicts.push(`Seulement ${eligibleRoles.size} rôles candidats distincts pour ${players.length} joueurs.`);
  }
  for (let player = 0; player < players.length; player++) {
    if (domains[player].length === 0) {
      initialConflicts.push(`Aucun rôle candidat compatible avec les effectifs pour « ${players[player].id} ».`);
    }
  }
  for (let team = 0; team < TEAMS.length; team++) {
    let available = 0;
    for (const role of eligibleRoles) if (roles[role].team === team) available++;
    if (available < counts[team]) {
      initialConflicts.push(`Rôles candidats distincts insuffisants pour ${TEAMS[team]} : ${available} disponibles, ${counts[team]} requis.`);
    }
  }
  for (const constraint of constraints) {
    if (constraint.roles?.size === 0 && constraint.min > 0) {
      initialConflicts.push(`La contrainte « ${constraint.id} » exige au moins ${constraint.min} correspondance avec une liste de rôles vide.`);
    }
  }
  if (initialConflicts.length) return result(initialConflicts);

  pruning = { before: domains.reduce((sum, domain) => sum + domain.length, 0), after: 0, removed: 0, nodes: 0, timeMs: 0, truncated: false };
  if (limits.propagate && limits.maxNodes > 0 && limits.timeMs > 0) {
    const started = now();
    const roleIds = roles.map((role) => role.id);
    const teamNames = roles.map((role) => TEAMS[role.team]);
    const rawConstraints = own(input, "constraints") ? input.constraints : [];
    const rawFactors = own(input, "factors") ? input.factors : undefined;
    const deadlinePrune = started + Math.min(250, limits.timeMs / 4);
    for (let player = 0; player < players.length; player++) {
      const kept = [];
      for (const role of domains[player]) {
        if (now() >= deadlinePrune) { pruning.truncated = true; kept.push(role); continue; }
        const probe = {
          players: players.map((p, i) => ({ id: p.id, candidates: i === player ? [roles[role].id] : domains[i].map((r) => roles[r].id) })),
          roles: roleIds.map((id, i) => ({ id, team: teamNames[i] })),
          counts: Object.fromEntries(TEAMS.map((team, i) => [team, counts[i]])),
          constraints: rawConstraints,
        };
        if (rawFactors) probe.factors = rawFactors;
        const check = enumerateAssignments(probe, { maxNodes: Math.min(5000, limits.maxNodes), timeMs: Math.min(100, limits.timeMs), maxWorlds: 1, propagate: false });
        pruning.nodes += check.nodes;
        if (!check.complete) { pruning.truncated = true; kept.push(role); }
        else if (check.worlds > 0) kept.push(role);
        else pruning.removed++;
      }
      domains[player] = kept;
    }
    pruning.timeMs = limits.measureTime ? now() - started : 0;
  }
  pruning.after = domains.reduce((sum, domain) => sum + domain.length, 0);

  const assignment = new Int32Array(players.length).fill(-1);
  const used = new Uint8Array(roles.length);
  const remaining = counts.slice();
  let operations = 0;

  function timedOut() {
    if (now() >= deadline) {
      reason = "time-limit";
      return true;
    }
    return false;
  }

  function conflict(message, depth) {
    if (depth === 0) rootConflict = message;
    return null;
  }

  function choosePlayer(depth) {
    const available = new Array(players.length);
    const possiblePlayers = [0, 0, 0, 0];
    const forcedPlayers = [0, 0, 0, 0];
    const availableRoles = new Set();
    const teamRoleCounts = [0, 0, 0, 0];
    let selected = -1;
    for (let player = 0; player < players.length; player++) {
      if (assignment[player] !== -1) continue;
      const domain = [];
      let teams = 0;
      for (const role of domains[player]) {
        if (++operations % 256 === 0 && timedOut()) return null;
        const team = roles[role].team;
        if (used[role] || remaining[team] === 0) continue;
        domain.push(role);
        teams |= 1 << team;
        if (!availableRoles.has(role)) {
          availableRoles.add(role);
          teamRoleCounts[team]++;
        }
      }
      if (domain.length === 0) {
        return conflict(`Aucun rôle distinct disponible pour « ${players[player].id} » avec ces hypothèses.`, depth);
      }
      available[player] = domain;
      for (let team = 0; team < TEAMS.length; team++) {
        if (teams & (1 << team)) possiblePlayers[team]++;
        if (teams === (1 << team)) forcedPlayers[team]++;
      }
      if (selected === -1 || domain.length < available[selected].length) selected = player;
    }
    if (availableRoles.size < players.length - depth) {
      return conflict("Les domaines restants ne contiennent pas assez de rôles distincts.", depth);
    }
    for (let team = 0; team < TEAMS.length; team++) {
      if (teamRoleCounts[team] < remaining[team] ||
          possiblePlayers[team] < remaining[team] || forcedPlayers[team] > remaining[team]) {
        return conflict(`Les domaines candidats sont incompatibles avec l'effectif ${TEAMS[team]}.`, depth);
      }
    }
    for (const constraint of constraints) {
      if (++operations % 256 === 0 && timedOut()) return null;
      const { lower, upper } = constraintBounds(constraint, assignment, available, roles, remaining);
      if (lower > constraint.max || upper < constraint.min) {
        return conflict(`La contrainte « ${constraint.id} » est incompatible avec les domaines, l'unicité des rôles ou les effectifs.`, depth);
      }
    }
    return { player: selected, domain: selected === -1 ? [] : available[selected] };
  }

  function visit(depth) {
    if (reason !== null) return;
    if (worlds >= limits.maxWorlds) {
      reason = "world-limit";
      return;
    }
    if (nodes >= limits.maxNodes) {
      reason = "node-limit";
      return;
    }
    if (timedOut()) return;
    nodes++;
    const choice = choosePlayer(depth);
    if (choice === null) return;
    if (depth === players.length) {
      worlds++;
      const example = examples.length < MAX_EXAMPLES ? Object.create(null) : null;
      for (let player = 0; player < players.length; player++) {
        const roleId = roles[assignment[player]].id;
        marginals[players[player].id][roleId]++;
        if (example !== null) example[players[player].id] = roleId;
      }
      if (example !== null) examples.push(example);
      if (onWorld) onWorld(assignment);
      return;
    }
    for (const role of choice.domain) {
      const team = roles[role].team;
      assignment[choice.player] = role;
      used[role] = 1;
      remaining[team]--;
      visit(depth + 1);
      remaining[team]++;
      used[role] = 0;
      assignment[choice.player] = -1;
      if (reason !== null) return;
    }
  }

  visit(0);
  return result(worlds === 0 && reason === null
    ? [rootConflict ?? "Aucune affectation ne satisfait l'ensemble des hypothèses et des effectifs. Cela révèle un conflit entre les hypothèses, pas la certitude qu'un joueur ment."]
    : []);
}
