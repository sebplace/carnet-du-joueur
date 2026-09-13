import test from "node:test";
import assert from "node:assert/strict";
import { createEstimator, EstimatorCancelledError, EstimatorSupersededError } from "../js/estimator-client.js";

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeWorker {
  static instances = [];
  constructor() {
    this.messages = [];
    this.terminated = false;
    this.listeners = new Map();
    FakeWorker.instances.push(this);
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? new Set();
    list.add(handler);
    this.listeners.set(type, list);
  }
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((sum, list) => sum + list.size, 0);
  }
  postMessage(message) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(type, data) {
    for (const handler of this.listeners.get(type) ?? []) handler({ data, message: data?.message });
  }
  respond(index = 0, result = { ok: true }) {
    this.emit("message", { id: this.messages[index].id, result });
  }
  fail(message = "boom") {
    this.emit("error", { message });
  }
}

function makeClient(options = {}) {
  FakeWorker.instances = [];
  return createEstimator({ createWorker: () => new FakeWorker(), debounceMs: 0, ...options });
}

test("last request wins and superseded requests settle distinctly", async () => {
  const client = makeClient({ debounceMs: 10 });
  const first = client.request({ value: 1 }).catch((error) => error);
  const second = client.request({ value: 2 });
  const superseded = await first;
  assert.ok(superseded instanceof EstimatorSupersededError);
  assert.equal(superseded.code, "ESTIMATOR_SUPERSEDED");
  await delay(20);
  assert.equal(FakeWorker.instances.length, 1);
  assert.equal(FakeWorker.instances[0].messages.length, 1);
  assert.deepEqual(FakeWorker.instances[0].messages[0].input, { value: 2 });
  FakeWorker.instances[0].respond(0, { result: 2 });
  assert.deepEqual(await second, { result: 2 });
});

test("worker error restarts automatically without losing newest request", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const client = makeClient();
    const promise = client.request({ value: "retry" });
    await delay();
    assert.equal(FakeWorker.instances.length, 1);
    FakeWorker.instances[0].fail("crash");
    await delay();
    assert.equal(FakeWorker.instances.length, 2);
    assert.equal(FakeWorker.instances[0].terminated, true);
    assert.equal(FakeWorker.instances[1].messages.length, 1);
    assert.deepEqual(FakeWorker.instances[1].messages[0].input, { value: "retry" });
    FakeWorker.instances[1].respond(0, { ok: "after restart" });
    assert.deepEqual(await promise, { ok: "after restart" });
    client.dispose();
  } finally {
    console.warn = warn;
  }
});

test("cancel rejects active work and terminates the worker", async () => {
  const client = makeClient();
  const promise = client.request({ value: 1 }).catch((error) => error);
  await delay();
  assert.equal(client.busy, true);
  client.cancel();
  const error = await promise;
  assert.ok(error instanceof EstimatorCancelledError);
  assert.equal(FakeWorker.instances[0].terminated, true);
  assert.equal(client.busy, false);
});

test("dispose rejects work, terminates once, and refuses future requests", async () => {
  const client = makeClient();
  const promise = client.request({ value: 1 }).catch((error) => error);
  await delay();
  const worker = FakeWorker.instances[0];
  client.dispose();
  const error = await promise;
  assert.ok(error instanceof EstimatorCancelledError);
  assert.equal(worker.terminated, true);
  assert.equal(worker.listenerCount(), 0);
  await assert.rejects(() => client.request({ value: 2 }), EstimatorCancelledError);
});

test("debounce collapses a burst into one computation and passes budget hints", async () => {
  const client = makeClient({ debounceMs: 15 });
  const rejected = [];
  for (let i = 0; i < 5; i++) {
    client.request({ value: i }, { maxNodes: 100 + i, budget: { hidden: i === 4, battery: "low" } })
      .catch((error) => rejected.push(error.code));
  }
  await delay(30);
  const worker = FakeWorker.instances[0];
  assert.equal(worker.messages.length, 1);
  assert.deepEqual(worker.messages[0].input, { value: 4 });
  assert.deepEqual(worker.messages[0].options, { maxNodes: 104 });
  assert.deepEqual(worker.messages[0].budget, { hidden: true, battery: "low" });
  assert.equal(rejected.length, 4);
  assert.ok(rejected.every((code) => code === "ESTIMATOR_SUPERSEDED"));
  worker.respond(0, { done: true });
});

test("deadlineMs stays in worker options while budget remains top-level", async () => {
  const client = makeClient({ debounceMs: 0 });
  const promise = client.request(
    { value: 1 },
    { mode: "explain", deadlineMs: 2000, budget: 24 },
  );
  await delay();
  const worker = FakeWorker.instances[0];
  assert.deepEqual(worker.messages[0].options, { deadlineMs: 2000 });
  assert.equal(worker.messages[0].budget, 24);
  worker.respond(0, { done: true });
  await promise;
});

test("dispose leaves no listeners or worker leak", async () => {
  const client = makeClient();
  const promise = client.request({ value: 1 }).catch((error) => error);
  await delay();
  const worker = FakeWorker.instances[0];
  assert.ok(worker.listenerCount() > 0);
  client.dispose();
  await promise;
  assert.equal(worker.terminated, true);
  assert.equal(worker.listenerCount(), 0);
  assert.equal(client.busy, false);
});
