import { solve } from "./inference.js";
import { estimate, explain } from "./probability.js";

const modes = { estimate, explain, solve };

self.addEventListener("message", (event) => {
  const { id, input, options, mode, budget } = event.data ?? {};
  try {
    const run = modes[mode] ?? solve;
    const opts = budget === undefined ? options : { ...options, budget };
    self.postMessage({ id, result: run(input, opts) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
