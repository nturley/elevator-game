import { describe, expect, it } from "vitest";
import { Runner } from "./runner";
import { LEVELS } from "./levels";

/**
 * Invariant check with a player's collective-style code (lanterns flipped
 * on per-trip, scan-and-queue on idle), run on level 3 with production seed:
 *
 * An elevator may never transition idle -> moving while a waiter standing at
 * its own floor matches the direction its lanterns claim. With the
 * board-before-depart rule, such a car must open its doors (arrive()) instead
 * of going straight to "moving".
 */

const PLAYER_COLLECTIVE = `/** @type {ElevatorProgram} */
({
  init: function(elevators, floors) {
    for (let elevator of elevators) {
      elevator.goingUpIndicator(true);
      elevator.goingDownIndicator(false);

      function nextFloor(currFloor, currGoingUp) {
        if (currGoingUp && currFloor == floors.length - 1) currGoingUp = false;
        if (!currGoingUp && currFloor == 0) currGoingUp = true;
        return currGoingUp ? currFloor + 1 : currFloor - 1;
      }

      elevator.on("idle", function() {
        const noPressedButtons = elevator.getPressedFloors().length == 0;
        const anyWaiting = floors.some((f) => f.upButtonLit() || f.downButtonLit());
        if (noPressedButtons && !anyWaiting) return;
        let myNextFloor = elevator.currentFloor();
        while (true) {
          myNextFloor = nextFloor(myNextFloor, elevator.goingUpIndicator());
          if (myNextFloor > elevator.currentFloor()) {
            elevator.goingUpIndicator(true);
            elevator.goingDownIndicator(false);
          } else {
            elevator.goingUpIndicator(false);
            elevator.goingDownIndicator(true);
          }
          const isFull = elevator.loadFactor() == 1;
          const pressed = elevator.getPressedFloors().includes(myNextFloor);
          const lit = floors.some((f) => f.floorNum() === myNextFloor && (f.upButtonLit() || f.downButtonLit()));
          if (isFull && !pressed) continue;
          if (!lit && !pressed) continue;
          break;
        }
        elevator.goToFloor(myNextFloor);
      });
    }
  }
})`;

describe("collective invariant", () => {
  it("never departs leaving a matching waiter at its own floor", () => {
    const level = LEVELS[2];
    const r = new Runner(PLAYER_COLLECTIVE, level, 1);
    let prev = r.sim.snapshot();
    let violations = 0;
    for (let i = 0; i < 60 * 130 && !r.result; i++) {
      r.step();
      const cur = r.sim.snapshot();
      for (let e = 0; e < cur.elevators.length; e++) {
        const pe = prev.elevators[e];
        const ce = cur.elevators[e];
        if (pe.state === "idle" && ce.state === "moving") {
          // A full car may depart (nobody can board; the leftovers re-press).
          if (pe.passengers >= pe.capacity) continue;
          const floorNum = Math.round(pe.y);
          const pf = prev.floors[floorNum];
          const skipTriggers =
            (pe.goingUpIndicator && pf.upButtonLit && pf.waiting > 0) ||
            (pe.goingDownIndicator && pf.downButtonLit && pf.waiting > 0);
          if (skipTriggers) violations++;
        }
      }
      prev = cur;
    }
    expect(violations).toBe(0);
    // Strategy sanity: it should stay active (not stall into nothingness).
    expect(r.result?.snapshot.delivered ?? 0).toBeGreaterThan(0);
    if (r.result?.error) console.log(r.result.error);
  });
});
