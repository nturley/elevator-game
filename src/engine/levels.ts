import { DT } from "./simulation";
import type { SpawnFn, SpawnRequest } from "./types";
import type { LevelDef } from "./types";

interface SpawnerOptions {
  /** Weight of each floor as an origin. Default: uniform. */
  fromWeight?: (floor: number, t: number, floorCount: number) => number;
  /** Weight of each floor as a destination given the origin. Default: uniform over other floors. */
  toWeight?: (from: number, to: number, t: number, floorCount: number) => number;
}

/**
 * Builds a spawn function that produces passengers at a (possibly time-varying)
 * rate using a smooth deterministic process: every tick spawns floor(rate*dt)
 * passengers plus one extra with probability equal to the fractional part.
 */
export function makeSpawner(
  ratePerSecond: number | ((t: number) => number),
  options: SpawnerOptions = {}
): SpawnFn {
  return (t, rng, floorCount) => {
    const rate =
      typeof ratePerSecond === "function" ? ratePerSecond(t) : ratePerSecond;
    if (rate <= 0) return [];

    const expected = rate * DT;
    let count = Math.floor(expected);
    if (rng() < expected - count) count++;

    const spawns: SpawnRequest[] = [];
    for (let i = 0; i < count; i++) {
      const from = weightedPick(
        rng,
        floorCount,
        (f) => options.fromWeight?.(f, t, floorCount) ?? 1
      );
      const to = weightedPick(
        rng,
        floorCount,
        (f) =>
          f === from
            ? 0
            : options.toWeight?.(from, f, t, floorCount) ?? 1
      );
      if (from !== to && from >= 0 && to >= 0) spawns.push({ from, to });
    }
    return spawns;
  };
}

function weightedPick(
  rng: () => number,
  n: number,
  weight: (i: number) => number
): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.max(0, weight(i));
  if (total <= 0) return -1;
  let roll = rng() * total;
  for (let i = 0; i < n; i++) {
    roll -= Math.max(0, weight(i));
    if (roll <= 0) return i;
  }
  return n - 1;
}

export const DEFAULT_STARTER_CODE = `/** @type {ElevatorProgram} */
({
  init: (elevators, floors) => {
    // Declare what traffic the first car serves. A car that never declares a
    // direction doesn't answer anybody — both on = take everyone.
    // (We only declare the first elevator. What about the others?)
    const elevator = elevators[0];
    elevator.goingUpIndicator(true);
    elevator.goingDownIndicator(true);

    // The car is idle and has nothing to do.
    // Let's go to floor 0 and wait for someone... surely fine, right?
    elevator.on("idle", () => {
      elevator.goToFloor(0);
    });

    // A passenger inside the elevator pressed a floor button.
    elevator.on("floor_button_pressed", (floorNum) => {
      elevator.goToFloor(floorNum);
    });

    // Someone on a floor pressed the "up" or "down" call button.
    for (const floor of floors) {
      floor.on("up_button_pressed", () => {
        elevator.goToFloor(floor.floorNum());
      });
      floor.on("down_button_pressed", () => {
        elevator.goToFloor(floor.floorNum());
      });
    }
  },
})`;

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: "First Ride",
    description:
      "One elevator, three floors, a handful of passengers. Get them where they're going.",
    hint: "The starter code already works — barely. Press Run and watch. Can you improve it?",
    floorCount: 3,
    elevatorCount: 1,
    elevatorCapacity: 4,
    timeLimitSeconds: 57,
    spawn: makeSpawner(0.25),
    goals: [{ kind: "deliver", count: 12 }],
  },
  {
    id: 2,
    name: "Commuter Flow",
    description:
      "Every morning the lobby is busiest: most riders start at the ground floor and head up. Meet the delivery quota WITHOUT letting the waits run away.",
    hint: "Fewer, fuller trips beat many short ones. Watch the average-wait metric: an idle car that waits where the crowd is answers its next call much sooner.",
    floorCount: 6,
    elevatorCount: 1,
    elevatorCapacity: 5,
    timeLimitSeconds: 120,
    spawn: makeSpawner(0.65, {
      fromWeight: (f) => (f === 0 ? 3.5 : 1),
      toWeight: (from, to) => (to > from ? 1.2 : 0.5),
    }),
    goals: [
      { kind: "deliver", count: 30 },
      { kind: "avgWaitUnder", seconds: 22 },
    ],
  },
  {
    id: 3,
    name: "Double Trouble",
    description:
      "A second car joins the fleet. Two elevators that both answer every call are worse than one.",
    hint: "Two important things: the starter only declares lanterns on the FIRST car — undeclared cars answer nobody — and two cars that both answer every call are worse than one. Split the building, or send the nearest idle car.",
    floorCount: 8,
    elevatorCount: 2,
    elevatorCapacity: 5,
    timeLimitSeconds: 120,
    spawn: makeSpawner(0.6),
    goals: [{ kind: "deliver", count: 45 }],
  },
  {
    id: 4,
    name: "Morning Rush",
    description:
      "Everybody arrives at the lobby at once. The first 40 seconds are brutal — plan for the surge.",
    hint: "During the rush, most trips start at floor 0 going up. Stage cars there before the wave.",
    floorCount: 10,
    elevatorCount: 2,
    elevatorCapacity: 6,
    timeLimitSeconds: 110,
    spawn: makeSpawner((t) => (t < 40 ? 1.1 : 0.45), {
      fromWeight: (f, t) => (t < 40 ? (f === 0 ? 8 : 1) : 1),
      toWeight: (from, to, t) => (t < 40 && from === 0 ? (to > from ? 1 : 0.05) : 1),
    }),
    goals: [{ kind: "deliver", count: 41 }],
  },
  {
    id: 5,
    name: "Skyline",
    description:
      "Fourteen floors, three cars, and an impatient crowd. Keep waits reasonable AND hit the quota.",
    hint: "Think in zones. A car that sprints end-to-end for every call wastes everyone's time.",
    floorCount: 14,
    elevatorCount: 3,
    elevatorCapacity: 6,
    timeLimitSeconds: 160,
    spawn: makeSpawner(0.8),
    goals: [
      { kind: "deliver", count: 53 },
      { kind: "avgWaitUnder", seconds: 31 },
      { kind: "maxWaitUnder", seconds: 95 },
    ],
  },
];
