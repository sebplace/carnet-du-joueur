export class EstimatorSupersededError extends Error {
  constructor(message = "Requête remplacée par une plus récente / Request superseded by a newer one") {
    super(message);
    this.name = "EstimatorSupersededError";
    this.code = "ESTIMATOR_SUPERSEDED";
  }
}

export class EstimatorCancelledError extends Error {
  constructor(message = "Calcul annulé / Calculation cancelled") {
    super(message);
    this.name = "EstimatorCancelledError";
    this.code = "ESTIMATOR_CANCELLED";
  }
}

function defaultCreateWorker(workerUrl) {
  if (typeof Worker !== "function") throw new Error("Worker indisponible / Worker unavailable");
  return new Worker(workerUrl, { type: "module" });
}

function getData(event) {
  return event && typeof event === "object" && "data" in event ? event.data : event;
}

function getErrorMessage(event) {
  return event?.message || event?.error?.message || String(event || "Erreur du worker / Worker error");
}

export function createEstimator({ workerUrl = "./js/inference-worker.js", createWorker = defaultCreateWorker, debounceMs = 250 } = {}) {
  if (!Number.isFinite(debounceMs) || debounceMs < 0) throw new Error("Délai invalide / Invalid delay");
  let worker = null;
  let handlers = null;
  let pending = null;
  let active = null;
  let timer = null;
  let disposed = false;
  let nextId = 0;

  const makeSuperseded = () => new EstimatorSupersededError();
  const makeCancelled = (message) => new EstimatorCancelledError(message);

  function attach(target, event, handler) {
    if (typeof target.addEventListener === "function") {
      target.addEventListener(event, handler);
      return () => target.removeEventListener?.(event, handler);
    }
    if (typeof target.on === "function") {
      target.on(event, handler);
      return () => target.off?.(event, handler) ?? target.removeListener?.(event, handler);
    }
    const property = `on${event}`;
    const previous = target[property];
    target[property] = handler;
    return () => {
      if (target[property] === handler) target[property] = previous ?? null;
    };
  }

  function detachWorker() {
    if (handlers) {
      for (const detach of handlers) detach();
      handlers = null;
    }
  }

  function terminateWorker() {
    if (!worker) return;
    const doomed = worker;
    detachWorker();
    worker = null;
    doomed.terminate?.();
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker(workerUrl, { type: "module" });
    handlers = [
      attach(worker, "message", handleMessage),
      attach(worker, "error", handleFailure),
      attach(worker, "messageerror", handleFailure),
      attach(worker, "exit", (code) => {
        if (code !== 0) handleFailure(new Error(`Worker terminé / Worker exited (${code})`));
      }),
    ];
    return worker;
  }

  function settle(request, method, value) {
    if (request.settled) return;
    request.settled = true;
    request[method](value);
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule(delay = debounceMs) {
    if (disposed || !pending) return;
    clearTimer();
    timer = setTimeout(flush, delay);
  }

  function flush() {
    timer = null;
    if (disposed || active || !pending) return;
    active = pending;
    pending = null;
    const request = active;
    try {
      const target = ensureWorker();
      target.postMessage({
        id: request.id,
        mode: request.mode,
        input: request.input,
        options: request.workerOptions,
        budget: request.budget,
      });
    } catch (error) {
      active = null;
      pending = request;
      terminateWorker();
      if (!disposed) schedule(0);
      else settle(request, "reject", makeCancelled("Estimateur fermé / Estimator disposed"));
    }
  }

  function pumpAfterActive() {
    active = null;
    if (pending) schedule(0);
  }

  function handleMessage(event) {
    const data = getData(event) ?? {};
    if (!active || data.id !== active.id) return;
    const request = active;
    pumpAfterActive();
    if (request.superseded || request.cancelled) return;
    if (data.error) settle(request, "reject", new Error(String(data.error)));
    else settle(request, "resolve", data.result);
  }

  function handleFailure(event) {
    if (disposed) return;
    const retry = active && !active.superseded && !active.cancelled ? active : null;
    active = null;
    terminateWorker();
    if (retry) pending = retry;
    if (pending) schedule(0);
    else ensureWorker();
    console.warn?.(`Calcul relancé / Calculation restarted: ${getErrorMessage(event)}`);
  }

  function supersede(request) {
    if (!request || request.settled) return;
    request.superseded = true;
    settle(request, "reject", makeSuperseded());
  }

  function rejectOpen(error) {
    clearTimer();
    if (pending) settle(pending, "reject", error);
    if (active) settle(active, "reject", error);
    pending = null;
    active = null;
  }

  return {
    get busy() {
      return Boolean(timer !== null || pending || active);
    },
    request(input, options = {}) {
      if (disposed) return Promise.reject(makeCancelled("Estimateur fermé / Estimator disposed"));
      supersede(pending);
      supersede(active);
      const { budget, mode = "estimate", ...workerOptions } = options ?? {};
      return new Promise((resolve, reject) => {
        pending = {
          id: `estimate-${++nextId}`,
          input,
          workerOptions,
          budget,
          mode,
          resolve,
          reject,
          settled: false,
          superseded: false,
          cancelled: false,
        };
        schedule();
      });
    },
    cancel() {
      rejectOpen(makeCancelled());
      terminateWorker();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rejectOpen(makeCancelled("Estimateur fermé / Estimator disposed"));
      terminateWorker();
    },
  };
}
