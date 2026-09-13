import test from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../js/history.js";

function game(size = 8) {
  const players = Array.from({ length: size }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    alive: true,
    ghost: true,
    traveller: i >= 15,
    trust: "unknown",
  }));
  return {
    version: 4,
    id: "game",
    title: "Late game",
    script: { name: "Script", roleIds: ["chef", "imp", "monk"], customRoles: [], warnings: [] },
    players,
    archivedPlayers: [],
    rosterReviewRequired: false,
    day: 1,
    phase: "day",
    claims: Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      playerId: players[i % players.length].id,
      roleIds: [i % 2 ? "chef" : "imp"],
      sourceId: "",
      visibility: "public",
      note: i === 0 ? "" : `claim ${i}`,
      weight: 1,
      day: 1,
      phase: "day",
    })),
    events: Array.from({ length: 40 }, (_, i) => ({
      id: `e${i}`,
      type: "note",
      text: `event ${i}`,
      playerIds: [players[i % players.length].id],
      sourceId: "",
      roleId: "",
      value: "",
      day: 1,
      phase: "day",
      aliveSnapshot: players.map((p) => p.id),
      ballot: [],
      outcome: "unknown",
      complete: false,
      influence: { roleIds: [], multiplier: 1, demonOnly: false, stable: false },
    })),
    scenarios: [{
      id: "s1",
      name: "Hypothesis",
      counts: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
      domains: {},
      constraints: [],
      notes: "",
    }],
    activeScenario: "s1",
    myId: players[0].id,
    myRole: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    estimateConsent: true,
  };
}

const copy = (value) => JSON.parse(JSON.stringify(value));
const fullBytes = (states) => states.reduce((sum, state) => sum + JSON.stringify(state).length, 0);

test("undo round-trips realistic insertions removals reorders deletions nulls and empty values", () => {
  const before = game();
  before.scenarios[0].domains[before.players[0].id] = ["chef"];
  before.scenarios[0].notes = "";
  const after = copy(before);
  after.players = [after.players[2], after.players[0], after.players[1], ...after.players.slice(3)];
  after.players.splice(4, 1);
  after.players.push({ id: "p-new", name: "", alive: false, ghost: false, traveller: false, trust: "suspect" });
  after.claims.splice(1, 1);
  after.claims.unshift({ ...after.claims[2], id: "c-new", note: "", sourceId: null });
  after.events[3].influence.roleIds = ["imp"];
  after.events[3].value = "";
  after.events[5].text = "changed";
  delete after.scenarios[0].domains[before.players[0].id];
  after.scenarios[0].notes = null;

  const history = createHistory({ limit: 12, snapshotEvery: 5 });
  const meta = history.record(before, after);
  const undone = history.undo(after);

  assert.equal(meta.fallback, false);
  assert.deepEqual(undone.state, before);
  assert.equal(history.canUndo(), false);
});

test("periodic snapshot prevents drift over a long chain", () => {
  const history = createHistory({ limit: 20, snapshotEvery: 3 });
  let current = game();
  const states = [copy(current)];
  for (let i = 1; i <= 6; i++) {
    const next = copy(current);
    next.day = i + 1;
    next.events[0].text = `step ${i}`;
    history.record(current, next);
    current = next;
    states.push(copy(current));
  }
  const corrupted = copy(current);
  corrupted.events[0].text = "corrupted after-state";
  const undone = history.undo(corrupted);
  assert.equal(undone.metadata.usedSnapshot, true);
  assert.deepEqual(undone.state, states.at(-2));
});

test("history limit is respected and clear resets state", () => {
  const history = createHistory({ limit: 3, snapshotEvery: 10 });
  let current = game();
  for (let i = 0; i < 7; i++) {
    const next = copy(current);
    next.title = `Game ${i}`;
    history.record(current, next);
    current = next;
  }
  assert.equal(history.size(), 3);
  assert.equal(history.canUndo(), true);
  history.clear();
  assert.equal(history.size(), 0);
  assert.equal(history.bytes(), 0);
});

test("compact history reports real memory savings against full snapshots", (t) => {
  const history = createHistory({ limit: 12, snapshotEvery: 50 });
  let current = game(20);
  current.claims = Array.from({ length: 1000 }, (_, i) => ({ ...current.claims[i % 20], id: `claim${i}`, note: `note ${i}` }));
  current.events = Array.from({ length: 2000 }, (_, i) => ({ ...current.events[i % 40], id: `event${i}`, text: `event text ${i}` }));
  const full = [];
  for (let i = 0; i < 12; i++) {
    const next = copy(current);
    next.events[i].text = `changed event ${i}`;
    full.push(copy(current));
    history.record(current, next);
    current = next;
  }
  const compactBytes = history.bytes();
  const snapshotBytes = fullBytes(full);
  assert.ok(compactBytes > 0, "compact byte estimate should be a real number");
  assert.ok(snapshotBytes > 0, "snapshot byte estimate should be a real number");
  assert.ok(compactBytes < snapshotBytes / 5, `compact=${compactBytes} full=${snapshotBytes}`);
  t.diagnostic(`history compact bytes=${compactBytes}; full snapshot bytes=${snapshotBytes}; saving=${Math.round(100 - (compactBytes / snapshotBytes) * 100)}%`);
});

test("prototype-unsafe keys are rejected before storage or replay", () => {
  const history = createHistory();
  const before = JSON.parse('{"safe":1,"__proto__":{"polluted":true}}');
  assert.throws(() => history.record(before, { safe: 2 }), /dangereuse|unsafe/i);
  assert.equal({}.polluted, undefined);
});

test("D4: undo({commit:false}) does not consume the entry until commit() confirms persistence", () => {
  const history = createHistory({ limit: 12, snapshotEvery: 50 });
  const s0 = game();
  const s1 = copy(s0);
  s1.title = "One";
  history.record(s0, s1);
  const first = history.undo(s1, { commit: false });
  assert.deepEqual(first.state, s0);
  assert.equal(history.size(), 1);
  const retry = history.undo(s1, { commit: false });
  assert.deepEqual(retry.state, s0);
  assert.equal(history.size(), 1);
  history.commit();
  assert.equal(history.size(), 0);
});

test("D4: an undo whose recorded after-state no longer matches is refused, not fabricated", () => {
  const history = createHistory({ limit: 12, snapshotEvery: 50 });
  const s0 = game();
  s0.title = "S0";
  const s1 = copy(s0);
  s1.title = "S1";
  s1.day = 2;
  history.record(s0, s1);
  const s2 = copy(s1);
  s2.events[0].text = "diverged";
  assert.throws(() => history.undo(s2), /divergent/i);
  assert.equal(history.size(), 1);
});
