const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const NOOP = Object.freeze({ type: "noop" });

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function jsonBytes(value) {
  return JSON.stringify(value).length;
}

function signature(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${hash >>> 0}`;
}

function assertSafe(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) fail("Structure cyclique dans l'historique / Cyclic history structure");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertSafe(item, seen);
    seen.delete(value);
    return;
  }
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) fail("Clé dangereuse dans l'historique / Unsafe history key");
    assertSafe(value[key], seen);
  }
  seen.delete(value);
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function idArray(value) {
  if (!Array.isArray(value)) return null;
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    if (!isObject(item) || typeof item.id !== "string" || seen.has(item.id)) return null;
    seen.add(item.id);
    ids.push(item.id);
  }
  return ids;
}

function inverseDiff(before, after) {
  if (same(before, after)) return NOOP;
  if (Array.isArray(before) && Array.isArray(after)) {
    const beforeIds = idArray(before);
    const afterIds = idArray(after);
    if (beforeIds && afterIds) return arrayByIdDiff(before, after, beforeIds);
    return { type: "replace", value: clone(before) };
  }
  if (isObject(before) && isObject(after)) return objectDiff(before, after);
  return { type: "replace", value: clone(before) };
}

function objectDiff(before, after) {
  const ops = [];
  for (const key of Object.keys(after)) {
    if (!(key in before)) ops.push({ op: "delete", key });
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      ops.push({ op: "set", key, value: clone(before[key]) });
      continue;
    }
    const patch = inverseDiff(before[key], after[key]);
    if (patch.type !== "noop") ops.push({ op: "patch", key, patch });
  }
  return ops.length ? { type: "object", ops } : NOOP;
}

function arrayByIdDiff(before, after, beforeIds) {
  const afterById = new Map(after.map((item) => [item.id, item]));
  const items = [];
  for (const item of before) {
    const afterItem = afterById.get(item.id);
    if (!afterItem) {
      items.push({ id: item.id, value: clone(item) });
      continue;
    }
    const patch = inverseDiff(item, afterItem);
    items.push(patch.type === "noop" ? { id: item.id } : { id: item.id, patch });
  }
  return { type: "arrayById", order: [...beforeIds], items };
}

function applyPatch(current, patch) {
  if (patch.type === "noop") return clone(current);
  if (patch.type === "replace") return clone(patch.value);
  assertSafe(current);
  if (patch.type === "object") {
    if (!isObject(current)) fail("Historique incompatible / Incompatible history");
    const result = clone(current);
    for (const op of patch.ops) {
      if (UNSAFE_KEYS.has(op.key)) fail("Clé dangereuse dans l'historique / Unsafe history key");
      if (op.op === "delete") delete result[op.key];
      else if (op.op === "set") result[op.key] = clone(op.value);
      else if (op.op === "patch") result[op.key] = applyPatch(result[op.key], op.patch);
      else fail("Opération d'historique invalide / Invalid history operation");
    }
    return result;
  }
  if (patch.type === "arrayById") {
    if (!Array.isArray(current)) fail("Historique incompatible / Incompatible history");
    const currentById = new Map();
    for (const item of current) {
      if (!isObject(item) || typeof item.id !== "string" || currentById.has(item.id)) {
        fail("Historique incompatible / Incompatible history");
      }
      currentById.set(item.id, item);
    }
    return patch.items.map((item) => {
      if (item.value !== undefined) return clone(item.value);
      const currentItem = currentById.get(item.id);
      if (!currentItem) fail("Historique incompatible / Incompatible history");
      return item.patch ? applyPatch(currentItem, item.patch) : clone(currentItem);
    });
  }
  fail("Patch d'historique invalide / Invalid history patch");
}

function candidate(entry, current) {
  if (entry.kind === "snapshot") {
    return { state: clone(entry.snapshot), metadata: { ...entry.metadata, usedSnapshot: true } };
  }
  assertSafe(current);
  if (signature(current) === entry.afterSignature) {
    return { state: applyPatch(current, entry.patch), metadata: { ...entry.metadata, usedSnapshot: false } };
  }
  if (entry.anchor) {
    return { state: clone(entry.anchor), metadata: { ...entry.metadata, usedSnapshot: true } };
  }
  fail("État divergent : annulation refusée / Divergent state: undo refused");
}

export function createHistory({ limit = 12, snapshotEvery = 8 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) fail("Limite d'historique invalide / Invalid history limit");
  if (!Number.isInteger(snapshotEvery) || snapshotEvery < 1) fail("Fréquence d'instantané invalide / Invalid snapshot frequency");
  const entries = [];
  let sequence = 0;

  function trim() {
    while (entries.length > limit) entries.shift();
  }

  return {
    record(before, after) {
      assertSafe(before);
      assertSafe(after);
      sequence += 1;
      const full = clone(before);
      const patch = inverseDiff(before, after);
      const patchEntry = {
        kind: "patch",
        patch,
        anchor: sequence % snapshotEvery === 0 ? full : undefined,
        afterSignature: signature(after),
        metadata: { fallback: false, reason: "", bytes: 0, fullBytes: jsonBytes(full) },
      };
      patchEntry.metadata.bytes = jsonBytes(patchEntry);
      let entry = patchEntry;
      if (patchEntry.metadata.bytes >= patchEntry.metadata.fullBytes && !patchEntry.anchor) {
        entry = {
          kind: "snapshot",
          snapshot: full,
          metadata: {
            fallback: true,
            reason: "Instantané plus sûr ou plus compact / Snapshot safer or smaller",
            bytes: jsonBytes(full),
            fullBytes: jsonBytes(full),
          },
        };
      }
      entries.push(entry);
      trim();
      return { ...entry.metadata, stored: entry.kind };
    },
    undo(current, { commit = true } = {}) {
      if (!entries.length) fail("Rien à annuler / Nothing to undo");
      const result = candidate(entries[entries.length - 1], current);
      if (commit) entries.pop();
      return result;
    },
    peek(current) {
      if (!entries.length) fail("Rien à annuler / Nothing to undo");
      return candidate(entries[entries.length - 1], current);
    },
    commit() {
      if (!entries.length) fail("Rien à annuler / Nothing to undo");
      entries.pop();
    },
    canUndo() {
      return entries.length > 0;
    },
    size() {
      return entries.length;
    },
    clear() {
      entries.length = 0;
    },
    bytes() {
      return entries.reduce((total, entry) => total + jsonBytes(entry), 0);
    },
  };
}
