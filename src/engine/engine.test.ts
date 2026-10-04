import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng";
import { Runner } from "./runner";
import { LEVELS } from "./levels";
import {
  BATCHING_SOLUTION,
  IDLE_SOLUTION,
  NAIVE_SOLUTION,
  ZONE_SOLUTION,
} from "./probeSolutions";
import type { EngineEvent, LevelDef } from "./types";
import { Simulation, DT } from "./simulation";

/** A level with fully scripted spawns for precise engine tests. */
function testLevel(overrides: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 999,
    name: "Test",
    description: "",
    floorCount: 4,
    elevatorCount: 1,
    elevatorCapacity: 4,
    timeLimitSeconds: 60,
    spawn: () => [],
    goals: [{ kind: "deliver", count: 1 }],
    ...overrides,
  };
}

function collectEvents(sim: Simulation): EngineEvent[] {
  const events: EngineEvent[] = [];
  sim.onEvent((e) => events.push(e));
  return events;
}

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it("differs across seeds and stays in [0, 1)", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).not.toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("simulation core", () => {
  it("fires a hall_call event and lights the button when a passenger spawns", () => {
    const level = testLevel({
      spawn: (t) => (t < DT * 2 ? [{ from: 1, to: 3 }] : []),
    });
    const sim = new Simulation(level, 1);
    const events = collectEvents(sim);
    sim.step();
    sim.step();
    expect(events).toContainEqual({
      type: "hall_call",
      floor: 1,
      direction: "up",
    });
    expect(sim.snapshot().floors[1].upButtonLit).toBe(true);
  });

  it("fires idle once, moves to a floor on goToFloor, and opens doors", () => {
    const sim = new Simulation(testLevel(), 1);
    const events = collectEvents(sim);

    sim.step(); // triggers initial idle
    expect(events.filter((e) => e.type === "idle")).toHaveLength(1);

    sim.goToFloor(0, 2);
    let sawStopped = false;
    for (let i = 0; i < 60 * 10 && !sawStopped; i++) {
      sim.step();
      if (events.some((e) => e.type === "stopped_at" && e.floor === 2)) {
        sawStopped = true;
      }
    }
    expect(sawStopped).toBe(true);
    expect(sim.elevatorSnapshot(0).state).not.toBe("idle");
  });

  it("picks up a waiting passenger and delivers them, updating metrics", () => {
    const level = testLevel({
      spawn: (t) => (t < DT * 2 ? [{ from: 0, to: 2 }] : []),
    });
    const sim = new Simulation(level, 1);
    collectEvents(sim);
    sim.setIndicator(0, "up", true); // declare service before anyone boards

    // Elevator starts idle at floor 0 — exactly where the passenger spawns.
    sim.goToFloor(0, 0); // open doors here
    for (let i = 0; i < 60 * 30 && sim.delivered === 0; i++) {
      sim.step();
      // A tiny scripted controller: head to pressed floors.
      const pressed = sim.elevatorSnapshot(0).pressedFloors;
      if (pressed.length > 0) sim.goToFloor(0, pressed[0]);
    }
    expect(sim.delivered).toBe(1);
    expect(sim.snapshot().avgWait).toBeGreaterThanOrEqual(0);
  });

  it("clears the hall light once a passenger of that direction boards", () => {
    const level = testLevel({
      spawn: (t) => (t < DT * 2 ? [{ from: 1, to: 3 }] : []),
    });
    const sim = new Simulation(level, 1);
    sim.setIndicator(0, "up", true); // declare service before anyone boards
    sim.step();
    sim.step();
    expect(sim.snapshot().floors[1].upButtonLit).toBe(true);

    sim.goToFloor(0, 1);
    for (let i = 0; i < 60 * 10; i++) sim.step();

    expect(sim.snapshot().floors[1].upButtonLit).toBe(false);
    expect(sim.elevatorSnapshot(0).passengers).toBe(1);
    expect(sim.elevatorSnapshot(0).riders.map((r) => r.dest)).toEqual([3]);
  });

  it("honors direct destinationQueue edits (Elevator Saga semantics)", () => {
    const sim = new Simulation(testLevel(), 1);
    sim.step();
    const q = sim.queueRef(0);
    q.push(3, 1); // player edits the raw array without checkDestinationQueue
    let maxY = 0;
    for (let i = 0; i < 60 * 20; i++) {
      sim.step();
      maxY = Math.max(maxY, sim.elevatorSnapshot(0).y);
    }
    expect(maxY).toBeGreaterThan(2.5); // it went to floor 3 first
  });
});

describe("runner: player code binding", () => {
  it("reports parse errors as failed results", () => {
    const r = new Runner("this is not javascript {{{", testLevel());
    expect(r.result).not.toBeNull();
    expect(r.result!.success).toBe(false);
    expect(r.result!.error).toMatch(/parse/i);
  });

  it("an idle car boards matching waiters at its floor before departing", () => {
    // Up-waiter at the lobby; player declares up and queues floor 2 in the
    // idle handler. The car must open up and take them at floor 0 first.
    const level = testLevel({
      spawn: (t) => (t < DT * 2 ? [{ from: 0, to: 2 }] : []),
    });
    const sim = new Simulation(level, 1);
    collectEvents(sim);
    sim.step();
    sim.step(); // passenger waiting at floor 0, car idle there

    sim.setIndicator(0, "up", true);
    sim.setIndicator(0, "down", false);
    sim.goToFloor(0, 2); // heading up, nobody served at home yet

    let boardedBeforeLeaving = false;
    let delivered = false;
    for (let i = 0; i < 60 * 15 && !delivered; i++) {
      sim.step();
      const s = sim.elevatorSnapshot(0);
      if (s.passengers === 1 && Math.round(s.y) === 0) {
        boardedBeforeLeaving = true;
      }
      if (sim.delivered === 1) delivered = true;
    }
    expect(boardedBeforeLeaving).toBe(true);
    expect(delivered).toBe(true);
  });

  it("exposes hall button states through the floor API", () => {
    const level = testLevel({
      spawn: (t) => (t < DT * 2 ? [{ from: 1, to: 3 }] : []),
    });
    const r = new Runner(IDLE_SOLUTION, level);
    const f = r.floors[1];
    expect(f.upButtonLit()).toBe(false);
    r.step();
    r.step();
    expect(f.upButtonLit()).toBe(true);
    expect(f.downButtonLit()).toBe(false);
  });

  it("elevator lanterns are readable and writable", () => {
    const r = new Runner(IDLE_SOLUTION, testLevel());
    // Cars start with dark lanterns until player code declares them.
    expect(r.elevators[0].goingUpIndicator()).toBe(false);
    expect(r.elevators[0].goingDownIndicator()).toBe(false);
    r.elevators[0].goingDownIndicator(true);
    expect(r.elevators[0].goingDownIndicator()).toBe(true);
    expect(r.elevators[0].goingUpIndicator()).toBe(false);
    expect(r.elevators[0].goingUpIndicator(true)).toBe(true);
  });

  it("only boards passengers matching the car's declared lamps (rule 2)", () => {
    // An up-waiter at floor 0 while the car refuses to serve up traffic.
    const level = testLevel({
      spawn: (t) => (t < DT * 2 ? [{ from: 0, to: 3 }] : []),
    });
    const sim = new Simulation(level, 1);
    sim.step();
    sim.step();
    sim.setIndicator(0, "up", false);
    sim.setIndicator(0, "down", false);
    sim.goToFloor(0, 0); // open doors at the lobby
    for (let i = 0; i < 60 * 3; i++) sim.step();

    expect(sim.elevatorSnapshot(0).passengers).toBe(0);
    expect(sim.snapshot().floors[0].waiting).toBe(1);
  });

  it("a stop answers the calls its lamps claim, even if nobody boards (rule 1+2)", () => {
    // Two waiters on floor 2: one up, one down. Car serves up only.
    const level = testLevel({
      floorCount: 4,
      spawn: (t) =>
        t < DT * 2 ? [{ from: 2, to: 3 }, { from: 2, to: 0 }] : [],
    });
    const sim = new Simulation(level, 1);
    sim.step();
    sim.step();
    sim.setIndicator(0, "up", true);
    sim.setIndicator(0, "down", false); // up counts as answered, down does not
    sim.goToFloor(0, 2);
    for (let i = 0; i < 60 * 6; i++) sim.step(); // travel (2.8s) + full door cycle

    expect(sim.elevatorSnapshot(0).passengers).toBe(1);
    expect(sim.snapshot().floors[2].upButtonLit).toBe(false);
    expect(sim.snapshot().floors[2].downButtonLit).toBe(true); // not answered
  });

  it("people left behind by a full car re-press the button (rule 3)", () => {
    // Capacity 1: of two up-waiters at floor 0, one boards, one re-presses.
    const level = testLevel({
      elevatorCapacity: 1,
      spawn: (t) => (t < DT * 2 ? [{ from: 0, to: 2 }, { from: 0, to: 1 }] : []),
    });
    const sim = new Simulation(level, 1);
    const events: EngineEvent[] = [];
    sim.onEvent((e) => events.push(e));
    sim.setIndicator(0, "up", true);
    sim.step();
    sim.step();

    const hallCallsBefore = events.filter(
      (e) => e.type === "hall_call" && e.floor === 0
    ).length;
    // Open doors: passenger 1 boards, the light clears, a re-press is armed.
    sim.goToFloor(0, 0);
    for (let i = 0; i < 60 * 3; i++) sim.step(); // ~2s after doors close

    // Initial hall_call (from addPassenger) + the fresh re-press.
    const hallCalls = events.filter(
      (e) => e.type === "hall_call" && e.floor === 0
    ).length;
    expect(hallCalls).toBeGreaterThan(hallCallsBefore);
    expect(sim.snapshot().floors[0].upButtonLit).toBe(true);
    expect(sim.elevatorSnapshot(0).passengers).toBe(1);
  });

  it("does not re-press when another car already picked the leftovers up", () => {
    const level = testLevel({
      elevatorCapacity: 1,
      spawn: (t) => (t < DT * 2 ? [{ from: 0, to: 2 }, { from: 0, to: 1 }] : []),
    });
    const sim = new Simulation(level, 1);
    const events: EngineEvent[] = [];
    sim.onEvent((e) => events.push(e));
    sim.setIndicator(0, "up", true);
    sim.step();
    sim.step();

    sim.goToFloor(0, 0); // car takes one; leftover re-press scheduled
    for (let i = 0; i < 60 * 0.5; i++) sim.step();
    // A second car (if any) or new capacity wouldn't exist in a 1-car level,
    // so empty the single car at floor 1 and let it return.
    sim.goToFloor(0, 1);
    for (let i = 0; i < 60; i++) sim.step();
    sim.goToFloor(0, 0); // back to lobby, boards the leftover
    for (let i = 0; i < 60 * 0.4; i++) sim.step();
    const reLit = sim.snapshot().floors[0].upButtonLit;
    // The remaining waiter is gone; nothing should re-light the button.
    expect(reLit).toBe(false);
    expect(events.filter((e) => e.type === "hall_call" && e.floor === 0).length)
      .toBe(1);
  });

  it("reports runtime errors from event handlers", () => {
    const code = `{
      init: function(elevators) {
        elevators[0].on("idle", function() { throw new Error("boom"); });
      }
    }`;
    const r = new Runner(code, testLevel());
    r.step();
    expect(r.result).not.toBeNull();
    expect(r.result!.error).toMatch(/boom/);
  });

  it("rejects programs without init or update", () => {
    const r = new Runner("({})", testLevel());
    expect(r.result!.error).toMatch(/init.*update/i);
  });

  it("delivers a passenger via the player API end-to-end", () => {
    const code = `{
      init: function(elevators, floors) {
        var e = elevators[0];
        e.goingUpIndicator(true);
        e.goingDownIndicator(true);
        e.on("floor_button_pressed", function(f) { e.goToFloor(f); });
        floors.forEach(function(f) {
          f.on("up_button_pressed", function() { e.goToFloor(f.floorNum()); });
          f.on("down_button_pressed", function() { e.goToFloor(f.floorNum()); });
        });
      }
    }`;
    const level = testLevel({
      spawn: (t) => (t < DT * 2 ? [{ from: 2, to: 0 }] : []),
    });
    const r = new Runner(code, level);
    const result = r.runToEnd(60 * 60);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.snapshot.delivered).toBe(1);
  });
});

describe("levels", () => {

  it("level 1 is not beatable by doing nothing", () => {
    const r = new Runner(IDLE_SOLUTION, LEVELS[0], 1);
    const result = r.runToEnd();
    expect(result.success).toBe(false);
  });

  it("levels 1 and 3 are beatable with the naive solution", () => {
    for (const level of [LEVELS[0], LEVELS[2]]) {
      const r = new Runner(NAIVE_SOLUTION, level, 7);
      const result = r.runToEnd();
      expect(result.error, `level ${level.id}`).toBeUndefined();
      expect(result.success, `level ${level.id}: ${result.reason}`).toBe(true);
    }
  });

  it("level 2: batching play clears the wait gate the starter fails", () => {
    // Commuter Flow is wait-gated; see criteria.test.ts for the starter's
    // fail-low-nonzero outcome. The winning move here is fewer, fuller trips.
    const r = new Runner(BATCHING_SOLUTION, LEVELS[1], 1);
    const result = r.runToEnd();
    expect(result.error).toBeUndefined();
    expect(result.success, result.reason).toBe(true);
  });

  it("level 4 punishes naive play but rewards lobby batching", () => {
    const naive = new Runner(NAIVE_SOLUTION, LEVELS[3], 7).runToEnd();
    expect(naive.success).toBe(false);

    const batching = new Runner(BATCHING_SOLUTION, LEVELS[3], 7).runToEnd();
    expect(batching.success, batching.reason).toBe(true);
  });

  it("level 5 is beatable with a zoning strategy", () => {
    // Zones passes on the production seed (1); L5's quota is calibrated to
    // the seed-1 schedule — other seeds vary more than the margin.
    const r = new Runner(ZONE_SOLUTION, LEVELS[4], 1);
    const result = r.runToEnd();
    expect(result.error).toBeUndefined();
    expect(result.success, result.reason).toBe(true);
  });

  it("is deterministic: same code + same seed = same outcome", () => {
    const a = new Runner(NAIVE_SOLUTION, LEVELS[1], 123).runToEnd();
    const b = new Runner(NAIVE_SOLUTION, LEVELS[1], 123).runToEnd();
    expect(a.success).toBe(b.success);
    expect(a.snapshot.delivered).toBe(b.snapshot.delivered);
    expect(a.snapshot.time).toBe(b.snapshot.time);
  });
});
