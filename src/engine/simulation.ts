import { mulberry32 } from "./rng";
import type {
  Direction,
  ElevatorSnapshot,
  ElevatorState,
  EngineEvent,
  LevelDef,
  Snapshot,
} from "./types";

/** Fixed simulation timestep, in seconds. The sim always advances in these increments. */
export const DT = 1 / 60;

/** Seconds to travel one floor at constant speed. */
export const FLOOR_TRAVEL_TIME = 1.4;
export const DOOR_OPEN_TIME = 0.5;
export const DOOR_DWELL_TIME = 0.9;
export const DOOR_CLOSE_TIME = 0.5;
/** After a stop serves a call, people left behind re-press after this delay (simulated seconds). */
export const REPRESS_DELAY = 0.5;

const SPEED = 1 / FLOOR_TRAVEL_TIME; // floors per second

interface Passenger {
  id: number;
  spawnT: number;
  dest: number;
  dir: 1 | -1;
  boardT?: number;
}

interface FloorCore {
  upButtonLit: boolean;
  downButtonLit: boolean;
  waiting: Passenger[];
}

interface ElevatorCore {
  y: number;
  state: ElevatorState;
  stateT: number;
  queue: number[];
  pressed: Set<number>;
  riders: Passenger[];
  /** Floor we are currently heading toward (null when not moving). */
  movingToward: number | null;
  lastDir: 1 | -1;
  /** Ensures the "idle" event fires exactly once per idle period. */
  idlePending: boolean;
  goingUpIndicator: boolean;
  goingDownIndicator: boolean;
}

type EventListener = (e: EngineEvent) => void;

/**
 * The simulation world. Pure and deterministic: no wall-clock, no DOM,
 * all randomness flows through a seeded RNG. Safe to run in a worker or in tests.
 *
 * Player code never touches this class directly — the runner exposes a
 * restricted facade (see runner.ts).
 */
export class Simulation {
  readonly floorCount: number;
  readonly elevatorCount: number;
  readonly capacity: number;
  readonly level: LevelDef;

  time = 0;
  delivered = 0;
  totalWait = 0;
  maxWait = 0;

  private rng: () => number;
  private floors: FloorCore[];
  private elevators: ElevatorCore[];
  private listeners = new Set<EventListener>();
  private nextPassengerId = 1;
  /** Pending re-presses: "floor:dir" -> earliest sim time to fire. */
  private pendingRepress = new Map<string, number>();

  constructor(level: LevelDef, seed = 1) {
    this.level = level;
    this.rng = mulberry32(seed);
    this.floorCount = level.floorCount;
    this.elevatorCount = level.elevatorCount;
    this.capacity = level.elevatorCapacity;

    this.floors = Array.from({ length: this.floorCount }, () => ({
      upButtonLit: false,
      downButtonLit: false,
      waiting: [],
    }));
    // Cars start with dark lanterns: until player code declares a service
    // direction, a car answers nobody (rule 2 gates boarding on the lamps).
    this.elevators = Array.from({ length: this.elevatorCount }, () => ({
      y: 0,
      state: "idle" as const,
      stateT: 0,
      queue: [],
      pressed: new Set<number>(),
      riders: [],
      movingToward: null,
      lastDir: 1 as const,
      idlePending: true,
      goingUpIndicator: false,
      goingDownIndicator: false,
    }));
  }

  onEvent(listener: EventListener): void {
    this.listeners.add(listener);
  }

  private emit(e: EngineEvent): void {
    for (const l of this.listeners) l(e);
  }

  // ---------------------------------------------------------------------
  // Mutators used by the player-facing API (via the runner)
  // ---------------------------------------------------------------------

  goToFloor(index: number, floor: number, jumpQueue = false): void {
    const e = this.elevators[index];
    if (!e) return;
    if (!Number.isInteger(floor) || floor < 0 || floor >= this.floorCount) return;

    const atFloor = Math.round(e.y);
    const servingHere =
      atFloor === floor &&
      (e.state === "doors-opening" || e.state === "doors-open" || e.state === "doors-closing");
    if (servingHere) return;

    // Already standing at the requested floor with closed doors: open up again.
    if (atFloor === floor && e.state === "idle") {
      this.arrive(e, index);
      return;
    }

    const existing = e.queue.indexOf(floor);
    if (existing >= 0) {
      if (jumpQueue && existing > 0) {
        e.queue.splice(existing, 1);
        e.queue.unshift(floor);
      }
      return;
    }
    if (jumpQueue) e.queue.unshift(floor);
    else e.queue.push(floor);
  }

  stop(index: number): void {
    const e = this.elevators[index];
    if (!e) return;
    if (e.state === "moving") {
      // Halt at the next floor in the current travel direction.
      const next =
        e.lastDir > 0 ? Math.floor(e.y) + 1 : Math.ceil(e.y) - 1;
      const clamped = Math.min(this.floorCount - 1, Math.max(0, next));
      e.queue = clamped === Math.round(e.y) && e.y % 1 === 0 ? [] : [clamped];
    } else {
      e.queue = [];
    }
  }

  setIndicator(index: number, which: "up" | "down", on: boolean): void {
    const e = this.elevators[index];
    if (!e) return;
    if (which === "up") e.goingUpIndicator = on;
    else e.goingDownIndicator = on;
  }

  // ---------------------------------------------------------------------
  // Read-only accessors used by the player-facing API
  // ---------------------------------------------------------------------

  elevatorSnapshot(index: number): ElevatorSnapshot {
    const e = this.elevators[index];
    return {
      y: e.y,
      state: e.state,
      stateT: e.stateT,
      queue: [...e.queue],
      passengers: e.riders.length,
      riders: e.riders.map((p) => ({ id: p.id, dest: p.dest })),
      capacity: this.capacity,
      pressedFloors: [...e.pressed].sort((a, b) => a - b),
      goingUpIndicator: e.goingUpIndicator,
      goingDownIndicator: e.goingDownIndicator,
    };
  }

  /**
   * The live destination queue for an elevator. The player-facing API hands
   * out this exact array (Elevator Saga semantics): player code may read or
   * edit it directly, and the engine consumes queue[0] each tick, skipping
   * invalid entries.
   */
  queueRef(index: number): number[] {
    return this.elevators[index].queue;
  }

  /**
   * Is the floor's hall call button (up or down) currently lit?
   * Exposed to player code via the Floor API.
   */
  floorButtonLit(floor: number, direction: Direction): boolean {
    const f = this.floors[floor];
    if (!f) return false;
    return direction === "up" ? f.upButtonLit : f.downButtonLit;
  }

  /** Drop invalid entries from the queue in place (called via checkDestinationQueue). */
  sanitizeQueue(index: number): void {
    const e = this.elevators[index];
    const valid = e.queue.filter(
      (f): f is number => Number.isInteger(f) && f >= 0 && f < this.floorCount
    );
    e.queue.length = 0;
    e.queue.push(...valid);
  }

  // ---------------------------------------------------------------------
  // Simulation step
  // ---------------------------------------------------------------------

  step(): void {
    this.time += DT;
    this.processRepresses();

    // Passenger spawns
    for (const s of this.level.spawn(this.time, this.rng, this.floorCount)) {
      this.addPassenger(s.from, s.to);
    }

    for (let i = 0; i < this.elevators.length; i++) {
      this.stepElevator(this.elevators[i], i);
    }
  }

  private addPassenger(from: number, to: number): void {
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      from >= this.floorCount ||
      to < 0 ||
      to >= this.floorCount ||
      from === to
    ) {
      return;
    }
    const dir: 1 | -1 = to > from ? 1 : -1;
    const f = this.floors[from];
    f.waiting.push({ id: this.nextPassengerId++, spawnT: this.time, dest: to, dir });

    // Press the hall button (only fires an event on the rising edge).
    if (dir === 1 && !f.upButtonLit) {
      f.upButtonLit = true;
      this.emit({ type: "hall_call", floor: from, direction: "up" });
    } else if (dir === -1 && !f.downButtonLit) {
      f.downButtonLit = true;
      this.emit({ type: "hall_call", floor: from, direction: "down" });
    }
  }

  private stepElevator(e: ElevatorCore, index: number): void {
    switch (e.state) {
      case "idle": {
        if (e.idlePending) {
          e.idlePending = false;
          this.emit({ type: "idle", elevator: index });
        }
        if (e.queue.length > 0) {
          // Departing: but if matching waiters stand at this very floor,
          // answer them first — real cars open up before they go anywhere.
          if (this.hasBoardersHere(e)) {
            this.arrive(e, index);
          } else {
            e.state = "moving";
            e.idlePending = true;
          }
          break;
        }
        // Parked with nothing queued: still serve waiters our lanterns claim.
        if (this.hasBoardersHere(e)) {
          this.arrive(e, index);
        }
        break;
      }

      case "moving": {
        // Skip invalid entries the player may have left in the queue.
        while (
          e.queue.length > 0 &&
          (!Number.isInteger(e.queue[0]) ||
            e.queue[0] < 0 ||
            e.queue[0] >= this.floorCount)
        ) {
          e.queue.shift();
        }
        const target = e.queue[0];
        if (target === undefined) {
          e.state = "idle";
          e.movingToward = null;
          break;
        }
        const dir: 1 | -1 = target > e.y ? 1 : target < e.y ? -1 : e.lastDir;
        if (target === e.y) {
          this.arrive(e, index);
          break;
        }
        e.lastDir = dir;
        e.movingToward = target;

        const oldY = e.y;
        let newY = oldY + dir * SPEED * DT;
        if ((dir > 0 && newY > target) || (dir < 0 && newY < target)) newY = target;
        e.y = newY;

        // Did we cross an integer floor boundary this tick?
        const oldBand = dir > 0 ? Math.floor(oldY) : Math.ceil(oldY);
        const newBand = dir > 0 ? Math.floor(newY) : Math.ceil(newY);
        if (newBand !== oldBand && newY !== target) {
          this.emit({
            type: "passing_floor",
            elevator: index,
            floor: newBand,
            direction: dir > 0 ? "up" : "down",
          });
        }

        if (e.y === target) {
          e.movingToward = null;
          this.arrive(e, index);
        }
        break;
      }

      case "doors-opening": {
        e.stateT -= DT;
        if (e.stateT <= 0) {
          e.state = "doors-open";
          e.stateT = DOOR_DWELL_TIME;
          this.serveFloor(e, index);
        }
        break;
      }

      case "doors-open": {
        e.stateT -= DT;
        if (e.stateT <= 0) {
          e.state = "doors-closing";
          e.stateT = DOOR_CLOSE_TIME;
        }
        break;
      }

      case "doors-closing": {
        e.stateT -= DT;
        if (e.stateT <= 0) {
          if (e.queue.length > 0) {
            e.state = "moving";
            e.idlePending = true;
          } else {
            e.state = "idle";
            e.idlePending = true;
          }
        }
        break;
      }
    }
  }

  /** Elevator has reached a floor: snap, update queue, begin the door cycle. */
  private arrive(e: ElevatorCore, index: number): void {
    const floor = Math.round(e.y);
    e.y = floor;
    const qi = e.queue.indexOf(floor);
    if (qi >= 0) e.queue.splice(qi, 1);
    e.movingToward = null;
    e.state = "doors-opening";
    e.stateT = DOOR_OPEN_TIME;
    this.emit({ type: "stopped_at", elevator: index, floor });
  }

  /** Doors fully open: unload arrivals, board matching passengers, clear lights. */
  private serveFloor(e: ElevatorCore, index: number): void {
    const floor = Math.round(e.y);
    const f = this.floors[floor];

    // Unload passengers whose destination is this floor.
    const staying: Passenger[] = [];
    for (const p of e.riders) {
      if (p.dest === floor) {
        const wait = (p.boardT ?? this.time) - p.spawnT;
        this.delivered++;
        this.totalWait += wait;
        if (wait > this.maxWait) this.maxWait = wait;
      } else {
        staying.push(p);
      }
    }
    e.riders = staying;

    // The car call for this floor has been served.
    e.pressed.delete(floor);

    // Board waiting passengers whose direction matches the car's declared
    // lamps (it "answers" those calls), longest-waiting first, up to capacity.
    const lampUp = e.goingUpIndicator;
    const lampDown = e.goingDownIndicator;
    let boardedUp = false;
    let boardedDown = false;
    const leftWaiting: Map<1 | -1, number> = new Map();
    const keep: Passenger[] = [];
    for (const p of f.waiting) {
      const wantsUp = p.dir === 1;
      if (
        e.riders.length < this.capacity &&
        (wantsUp ? lampUp : lampDown)
      ) {
        p.boardT = this.time;
        e.riders.push(p);
        e.pressed.add(p.dest);
        if (wantsUp) boardedUp = true;
        else boardedDown = true;
        this.emit({ type: "car_button", elevator: index, floor: p.dest });
      } else {
        keep.push(p);
        leftWaiting.set(p.dir, (leftWaiting.get(p.dir) ?? 0) + 1);
      }
    }
    f.waiting = keep;

    // A completed stop answers the calls its lamps claim: those lights clear
    // (even if nobody of that direction boarded).
    // People still waiting for an answered call re-press the button once the
    // doors have closed, re-registering the call.
    const repressAt =
      this.time + DOOR_DWELL_TIME + DOOR_CLOSE_TIME + REPRESS_DELAY;
    for (const dir of ["up", "down"] as const) {
      const lampOn = dir === "up" ? lampUp : lampDown;
      const boarded = dir === "up" ? boardedUp : boardedDown;
      if (!lampOn) continue; // wrong-direction car doesn't answer this call
      if (dir === "up") f.upButtonLit = false;
      else f.downButtonLit = false;

      const leftover: 1 | -1 = dir === "up" ? 1 : -1;
      const leftCount = leftWaiting.get(leftover) ?? 0;
      if (boarded || leftCount > 0) {
        this.scheduleRepress(floor, dir, repressAt);
      }
    }
  }

  /**
   * Could a passenger waiting at this car's own floor board? True when room
   * remains and the waiter's direction matches the car's declared service
   * (lanterns). Independent of the hall-light state: someone standing right
   * where the car stopped boards even if the call was just answered.
   */
  private hasBoardersHere(e: ElevatorCore): boolean {
    if (e.riders.length >= this.capacity) return false;
    const f = this.floors[Math.round(e.y)];
    return f.waiting.some(
      (p) => (p.dir === 1 ? e.goingUpIndicator : e.goingDownIndicator)
    );
  }

  /** Register (or move earlier) a pending re-press for floor:direction. */
  private scheduleRepress(floor: number, dir: Direction, at: number): void {
    const key = `${floor}:${dir}`;
    const existing = this.pendingRepress.get(key);
    if (existing === undefined || at < existing) this.pendingRepress.set(key, at);
  }

  /** Fire any due re-presses: re-light the button and emit a fresh hall_call. */
  private processRepresses(): void {
    if (this.pendingRepress.size === 0) return;
    for (const [key, at] of this.pendingRepress) {
      if (this.time < at) continue;
      this.pendingRepress.delete(key);
      const [floorS, dirS] = key.split(":");
      const floor = parseInt(floorS, 10);
      const dir: Direction = dirS === "up" ? "up" : "down";
      const f = this.floors[floor];
      if (!f) continue;
      const lit = dir === "up" ? f.upButtonLit : f.downButtonLit;
      const hasWaiter = f.waiting.some(
        (p) => (p.dir === 1) === (dir === "up")
      );
      if (!lit && hasWaiter) {
        if (dir === "up") f.upButtonLit = true;
        else f.downButtonLit = true;
        this.emit({ type: "hall_call", floor, direction: dir });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Snapshot for rendering / grading
  // ---------------------------------------------------------------------

  snapshot(): Snapshot {
    return {
      time: this.time,
      delivered: this.delivered,
      avgWait: this.delivered > 0 ? this.totalWait / this.delivered : 0,
      maxWait: this.maxWait,
      totalWaiting: this.floors.reduce((n, f) => n + f.waiting.length, 0),
      elevators: this.elevators.map((_, i) => this.elevatorSnapshot(i)),
      floors: this.floors.map((f) => ({
        upButtonLit: f.upButtonLit,
        downButtonLit: f.downButtonLit,
        waiting: f.waiting.length,
        waitingIds: f.waiting.map((p) => p.id),
      })),
    };
  }
}
