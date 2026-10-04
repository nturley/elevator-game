/** Shared types for the elevator simulation engine. */

export type Direction = "up" | "down";

/** Events emitted by the engine; the runner translates these into player-code callbacks. */
export type EngineEvent =
  | { type: "idle"; elevator: number }
  | { type: "car_button"; elevator: number; floor: number }
  | { type: "passing_floor"; elevator: number; floor: number; direction: Direction }
  | { type: "stopped_at"; elevator: number; floor: number }
  | { type: "hall_call"; floor: number; direction: Direction };

export type ElevatorState =
  | "idle"
  | "moving"
  | "doors-opening"
  | "doors-open"
  | "doors-closing";

export interface RiderInfo {
  id: number;
  dest: number;
}

export interface ElevatorSnapshot {
  /** Vertical position in floor units (fractional while moving). */
  y: number;
  state: ElevatorState;
  /** Seconds remaining in the current door phase (0 when idle/moving). */
  stateT: number;
  queue: number[];
  passengers: number;
  /** Passengers currently riding, in boarding order. */
  riders: RiderInfo[];
  capacity: number;
  pressedFloors: number[];
  goingUpIndicator: boolean;
  goingDownIndicator: boolean;
}

export interface FloorSnapshot {
  upButtonLit: boolean;
  downButtonLit: boolean;
  waiting: number;
  /** Ids of waiting passengers, in queue order (longest-waiting first). */
  waitingIds: number[];
}

export interface Snapshot {
  time: number;
  delivered: number;
  avgWait: number;
  maxWait: number;
  totalWaiting: number;
  elevators: ElevatorSnapshot[];
  floors: FloorSnapshot[];
}

export interface RunResult {
  success: boolean;
  reason: string;
  /** Set when the player's code threw an error or was stopped for misbehaving. */
  error?: string;
  snapshot: Snapshot;
}

export interface SpawnRequest {
  from: number;
  to: number;
}

/**
 * Called once per tick by the engine. Returns passengers to spawn at time `t`.
 * Must be deterministic for a given `rng` sequence.
 */
export type SpawnFn = (
  t: number,
  rng: () => number,
  floorCount: number
) => SpawnRequest[];

export type Goal =
  /** Win immediately (and at time limit, fail if not reached). */
  | { kind: "deliver"; count: number }
  /** Judged at the time limit: average wait of delivered passengers. */
  | { kind: "avgWaitUnder"; seconds: number }
  /** Judged at the time limit: worst wait of any delivered passenger. */
  | { kind: "maxWaitUnder"; seconds: number };

export interface LevelDef {
  id: number;
  name: string;
  description: string;
  hint?: string;
  floorCount: number;
  elevatorCount: number;
  elevatorCapacity: number;
  timeLimitSeconds: number;
  spawn: SpawnFn;
  goals: Goal[];
  starterCode?: string;
}

export function goalText(goal: Goal): string {
  switch (goal.kind) {
    case "deliver":
      return `Transport ${goal.count} passengers before time runs out`;
    case "avgWaitUnder":
      return `Average wait time under ${goal.seconds}s`;
    case "maxWaitUnder":
      return `No passenger waits more than ${goal.seconds}s`;
  }
}
