import type { RunResult, Snapshot } from "../engine/types";

/** Messages from the UI thread to the simulation worker. */
export type ToWorkerMessage =
  | { type: "start"; code: string; levelId: number; seed: number; speed?: number }
  | { type: "setSpeed"; speed: number }
  | { type: "setPaused"; paused: boolean };

/** Messages from the simulation worker to the UI thread. */
export type FromWorkerMessage =
  | { type: "ready" }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "finished"; result: RunResult }
  | { type: "error"; message: string };
