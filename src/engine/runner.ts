import { Simulation, DT } from "./simulation";
import type {
  Direction,
  EngineEvent,
  LevelDef,
  RunResult,
} from "./types";

/**
 * The shape of the player's submitted program.
 *
 * Players submit an object literal like:
 *   { init(elevators, floors) { ... }, update(dt, elevators, floors) { ... } }
 */
interface PlayerProgram {
  init?: (elevators: ElevatorAPI[], floors: FloorAPI[]) => void;
  update?: (dt: number, elevators: ElevatorAPI[], floors: FloorAPI[]) => void;
}

type Handler = (...args: unknown[]) => void;

/** Elevator-facing API exposed to player code. Backed by the simulation, but restricted. */
export interface ElevatorAPI {
  /** Queue a floor to visit. With jumpQueue, it becomes the immediate destination. */
  goToFloor(floor: number, jumpQueue?: boolean): void;
  /** Clear the destination queue; stop at the next floor if moving. */
  stop(): void;
  /** Current position in floor units (fractional while moving). */
  currentFloor(): number;
  /** Floors passengers inside the car have pressed. */
  getPressedFloors(): number[];
  /** Occupancy from 0 (empty) to 1 (full). */
  loadFactor(): number;
  /** Direction of the immediate destination. */
  destinationDirection(): "up" | "down" | "stopped";
  /** The destination queue. Edit directly, then call checkDestinationQueue(). */
  destinationQueue: number[];
  /** Re-validate destinationQueue after editing it directly. */
  checkDestinationQueue(): void;
  maxPassengerCount(): number;
  /**
   * With an argument: declare this car as serving up traffic. Without:
   * read the current state. Either way returns the current boolean.
   */
  goingUpIndicator(on?: boolean): boolean;
  goingDownIndicator(on?: boolean): boolean;
  on(event: string, handler: Handler): void;
}

export interface FloorAPI {
  floorNum(): number;
  /** Is this floor's "up" hall call currently lit? */
  upButtonLit(): boolean;
  /** Is this floor's "down" hall call currently lit? */
  downButtonLit(): boolean;
  on(event: string, handler: Handler): void;
}

/** Max wall-clock milliseconds a single player callback may take before we abort. */
const HANDLER_TIME_BUDGET_MS = 1000;

/**
 * Parses player code, binds it to a Simulation, and steps the world.
 * Runs identically in a Web Worker (live game) and in tests (headless).
 */
export class Runner {
  readonly sim: Simulation;
  readonly level: LevelDef;
  result: RunResult | null = null;

  private handlers = new Map<string, Handler[]>();
  /** Player-facing APIs; public for tests. */
  readonly elevators: ElevatorAPI[];
  readonly floors: FloorAPI[];
  private updateFn: PlayerProgram["update"];

  constructor(code: string, level: LevelDef, seed = 1) {
    this.level = level;
    this.sim = new Simulation(level, seed);

    this.elevators = Array.from({ length: level.elevatorCount }, (_, i) =>
      this.makeElevatorAPI(i)
    );
    this.floors = Array.from({ length: level.floorCount }, (_, n) =>
      this.makeFloorAPI(n)
    );

    this.sim.onEvent((e) => this.dispatch(e));

    let program: PlayerProgram;
    try {
      program = parseProgram(code);
    } catch (err) {
      this.fail(`Could not parse your code: ${(err as Error).message}`);
      return;
    }

    this.updateFn = program.update;
    try {
      this.guard("init", () => program.init?.(this.elevators, this.floors));
    } catch (err) {
      this.fail(errorMessage("init", err));
      return;
    }
  }

  /** Advance the world by one tick, then run the player's update() and check goals. */
  step(): void {
    if (this.result) return;

    try {
      this.sim.step(); // engine events dispatch synchronously to player handlers
    } catch (err) {
      this.fail(errorMessage("an event handler", err));
      return;
    }

    if (this.updateFn) {
      try {
        this.guard("update", () =>
          this.updateFn!(DT, this.elevators, this.floors)
        );
      } catch (err) {
        this.fail(errorMessage("update", err));
        return;
      }
    }

    this.checkGoals();
  }

  /** Run until the run ends or maxTicks is reached. Intended for tests and tooling. */
  runToEnd(maxTicks = 60 * 60 * 10): RunResult {
    let ticks = 0;
    while (!this.result && ticks < maxTicks) {
      this.step();
      ticks++;
    }
    if (!this.result) this.fail("Simulation did not terminate");
    return this.result!;
  }

  // ---------------------------------------------------------------------

  private checkGoals(): void {
    const { goals, timeLimitSeconds } = this.level;
    const sim = this.sim;

    // Levels with only delivery quotas end the moment the quota is hit.
    // Levels that also judge wait times run to the time limit.
    const onlyDeliverGoals = goals.every((g) => g.kind === "deliver");
    if (onlyDeliverGoals) {
      for (const g of goals) {
        if (g.kind === "deliver" && sim.delivered >= g.count) {
          this.finish(
            true,
            `Delivered ${g.count} passengers in ${sim.time.toFixed(1)}s!`
          );
          return;
        }
      }
    }

    if (sim.time >= timeLimitSeconds) {
      const failures: string[] = [];
      for (const g of goals) {
        switch (g.kind) {
          case "deliver":
            if (sim.delivered < g.count)
              failures.push(
                `Only delivered ${sim.delivered}/${g.count} passengers`
              );
            break;
          case "avgWaitUnder": {
            const avg = sim.delivered > 0 ? sim.totalWait / sim.delivered : 0;
            if (avg > g.seconds)
              failures.push(
                `Average wait was ${avg.toFixed(1)}s (limit ${g.seconds}s)`
              );
            break;
          }
          case "maxWaitUnder":
            if (sim.maxWait > g.seconds)
              failures.push(
                `Longest wait was ${sim.maxWait.toFixed(1)}s (limit ${g.seconds}s)`
              );
            break;
        }
      }
      if (failures.length === 0) {
        this.finish(true, "All goals met. Nice work!");
      } else {
        this.finish(false, failures.join(". "));
      }
    }
  }

  private dispatch(e: EngineEvent): void {
    switch (e.type) {
      case "idle":
        this.fire(`elevator:${e.elevator}:idle`);
        break;
      case "car_button":
        this.fire(`elevator:${e.elevator}:floor_button_pressed`, e.floor);
        break;
      case "passing_floor":
        this.fire(
          `elevator:${e.elevator}:passing_floor`,
          e.floor,
          e.direction
        );
        break;
      case "stopped_at":
        this.fire(`elevator:${e.elevator}:stopped_at_floor`, e.floor);
        break;
      case "hall_call":
        this.fire(
          `floor:${e.floor}:${e.direction}_button_pressed`
        );
        break;
    }
  }

  private fire(key: string, ...args: unknown[]): void {
    const list = this.handlers.get(key);
    if (!list) return;
    for (const h of list) {
      this.guard(key, () => h(...args));
    }
  }

  /** Run a player callback with a wall-clock time budget (catches pathological code). */
  private guard(where: string, fn: () => void): void {
    const start = performance.now();
    fn();
    if (performance.now() - start > HANDLER_TIME_BUDGET_MS) {
      throw new Error(
        `Handler "${where}" took over ${HANDLER_TIME_BUDGET_MS}ms — is it stuck in a loop?`
      );
    }
  }

  private makeElevatorAPI(index: number): ElevatorAPI {
    const sim = this.sim;
    const self = this;
    return {
      goToFloor(floor, jumpQueue) {
        sim.goToFloor(index, floor, jumpQueue === true);
      },
      stop() {
        sim.stop(index);
      },
      currentFloor: () => sim.elevatorSnapshot(index).y,
      getPressedFloors: () => sim.elevatorSnapshot(index).pressedFloors,
      loadFactor() {
        const s = sim.elevatorSnapshot(index);
        return s.passengers / s.capacity;
      },
      destinationDirection() {
        const s = sim.elevatorSnapshot(index);
        const next = s.queue[0];
        if (next === undefined) return "stopped";
        return next > s.y ? "up" : next < s.y ? "down" : "stopped";
      },
      // The engine's live queue: direct edits are honored (Elevator Saga style).
      destinationQueue: sim.queueRef(index),
      checkDestinationQueue() {
        sim.sanitizeQueue(index);
      },
      maxPassengerCount: () => sim.elevatorSnapshot(index).capacity,
      goingUpIndicator(on) {
        if (on !== undefined) sim.setIndicator(index, "up", !!on);
        return sim.elevatorSnapshot(index).goingUpIndicator;
      },
      goingDownIndicator(on) {
        if (on !== undefined) sim.setIndicator(index, "down", !!on);
        return sim.elevatorSnapshot(index).goingDownIndicator;
      },
      on(event, handler) {
        if (typeof handler !== "function") return;
        const key = `elevator:${index}:${event}`;
        const list = self.handlers.get(key) ?? [];
        list.push(handler);
        self.handlers.set(key, list);
      },
    };
  }

  private makeFloorAPI(floorNum: number): FloorAPI {
    const sim = this.sim;
    const self = this;
    return {
      floorNum: () => floorNum,
      upButtonLit: () => sim.floorButtonLit(floorNum, "up"),
      downButtonLit: () => sim.floorButtonLit(floorNum, "down"),
      on(event, handler) {
        if (typeof handler !== "function") return;
        const key = `floor:${floorNum}:${event}`;
        const list = self.handlers.get(key) ?? [];
        list.push(handler);
        self.handlers.set(key, list);
      },
    };
  }

  private finish(success: boolean, reason: string, error?: string): void {
    if (this.result) return;
    this.result = { success, reason, error, snapshot: this.sim.snapshot() };
  }

  private fail(error: string): void {
    this.finish(false, "Your code encountered an error.", error);
  }
}

// -------------------------------------------------------------------------

/** Parse the player's submission into a program object. */
function parseProgram(code: string): PlayerProgram {
  // Preferred form: an object literal `{ init(){...}, update(){...} }`.
  let factory: () => unknown;
  try {
    factory = new Function(`"use strict";\nreturn (\n${code}\n);`) as () => unknown;
  } catch {
    // Fallback: treat the submission as a function body that returns the object.
    factory = new Function(`"use strict";\n${code}`) as () => unknown;
  }
  const program = factory();
  if (program === null || typeof program !== "object") {
    throw new Error(
      "Your code must evaluate to an object with init() and/or update() functions."
    );
  }
  const p = program as PlayerProgram;
  if (p.init !== undefined && typeof p.init !== "function") {
    throw new Error("init must be a function.");
  }
  if (p.update !== undefined && typeof p.update !== "function") {
    throw new Error("update must be a function.");
  }
  if (!p.init && !p.update) {
    throw new Error("Provide at least an init() or update() function.");
  }
  return p;
}

function errorMessage(where: string, err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return `Error in ${where}: ${msg}`;
}

// Re-export for convenience
export type { Direction };
