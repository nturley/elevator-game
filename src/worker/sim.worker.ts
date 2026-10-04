/**
 * Simulation worker.
 *
 * Runs the engine + player code off the UI thread. This is the sandbox:
 * if the player's code infinite-loops, only this worker hangs — the page
 * stays responsive and the UI terminates us (watchdog in useSimulation).
 *
 * Protocol (see messages.ts):
 *   in:  start { code, levelId, seed } / setSpeed / setPaused
 *   out: ready / snapshot (throttled) / finished / error
 */
import { Runner } from "../engine/runner";
import { LEVELS } from "../engine/levels";
import type { FromWorkerMessage, ToWorkerMessage } from "./messages";

const TICK_MS = 1000 / 60;
/** Send a snapshot every N ticks (60/4 = 15 snapshots/sec). */
const SNAPSHOT_EVERY = 4;

let runner: Runner | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let speed = 1;
let paused = false;
let ticks = 0;

// Minimal worker-global typing (avoids DOM/WebWorker lib conflicts).
const ctx = self as unknown as {
  postMessage(message: FromWorkerMessage): void;
  onmessage: ((e: MessageEvent<ToWorkerMessage>) => void) | null;
};

function post(message: FromWorkerMessage): void {
  ctx.postMessage(message);
}

function stopLoop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function loop(): void {
  if (!runner || paused) return;

  for (let i = 0; i < speed && !runner.result; i++) {
    runner.step();
    ticks++;
  }

  if (runner.result) {
    post({ type: "finished", result: runner.result });
    stopLoop();
    runner = null;
    return;
  }

  if (ticks % SNAPSHOT_EVERY < speed) {
    post({ type: "snapshot", snapshot: runner.sim.snapshot() });
  }
}

ctx.onmessage = (e) => {
  const msg = e.data;

  switch (msg.type) {
    case "start": {
      stopLoop();
      runner = null;
      ticks = 0;
      paused = false;
      // Honor the speed the UI had selected before this run began.
      speed = clampSpeed(msg.speed ?? 1);

      const level = LEVELS.find((l) => l.id === msg.levelId);
      if (!level) {
        post({ type: "error", message: `Unknown level ${msg.levelId}` });
        return;
      }

      try {
        runner = new Runner(msg.code, level, msg.seed);
      } catch (err) {
        post({ type: "error", message: String(err) });
        runner = null;
        return;
      }

      if (runner.result) {
        // Code failed during parse/init before the first tick.
        post({ type: "finished", result: runner.result });
        runner = null;
        return;
      }

      post({ type: "ready" });
      timer = setInterval(loop, TICK_MS);
      break;
    }

    case "setSpeed": {
      speed = clampSpeed(msg.speed);
      break;
    }

    case "setPaused": {
      paused = msg.paused;
      break;
    }
  }
};

function clampSpeed(s: number): number {
  return Math.max(1, Math.min(16, Math.floor(s)));
}
