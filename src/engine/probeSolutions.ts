/**
 * Reference player solutions used for level-balance probing and tests.
 * These are player programs (strings), exactly what a user would submit.
 */

/** Answers every hall call and car press in order; parks at floor 0 when idle. */
export const NAIVE_SOLUTION = `{
  init: function(elevators, floors) {
    elevators.forEach(function(e, i) {
      e.goingUpIndicator(true);
      e.goingDownIndicator(true);
      e.on("idle", function() {
        if (i === 0) e.goToFloor(0);
      });
      e.on("floor_button_pressed", function(f) { e.goToFloor(f); });
    });
    floors.forEach(function(f) {
      var call = function() {
        elevators.forEach(function(e) {
          if (e.destinationDirection() === "stopped") e.goToFloor(f.floorNum());
        });
      };
      f.on("up_button_pressed", call);
      f.on("down_button_pressed", call);
    });
  }
}`;

/**
 * Batches passengers at the lobby: reopen doors until reasonably full
 * instead of departing with a single rider. Strong on rush traffic.
 */
export const BATCHING_SOLUTION = `{
  init: function(elevators, floors) {
    elevators.forEach(function(e) {
      e.goingUpIndicator(true);
      e.goingDownIndicator(true);
      e.remembered = [];

      e.on("floor_button_pressed", function(f) {
        if (e.remembered.indexOf(f) < 0) e.remembered.push(f);
      });

      e.on("idle", function() {
        if (e.destinationQueue.length === 0) e.goToFloor(0);
      });

      floors.forEach(function(f) {
        var answer = function() {
          var floor = f.floorNum();
          if (floor === 0) return;
          if (e.destinationDirection() === "stopped" && e.loadFactor() === 0) {
            e.goToFloor(floor);
          }
        };
        f.on("up_button_pressed", answer);
        f.on("down_button_pressed", answer);
      });
    });
  },

  update: function(dt, elevators, floors) {
    elevators.forEach(function(e) {
      if (Math.round(e.currentFloor()) === 0 &&
          e.loadFactor() > 0.6 &&
          e.remembered.length > 0) {
        e.remembered.sort(function(a, b) { return a - b; });
        e.remembered.forEach(function(f) { e.goToFloor(f); });
        e.remembered = [];
      }
    });
  }
}`;

/** Static zones: each car owns a band of floors and parks inside it. */
export const ZONE_SOLUTION = `{
  init: function(elevators, floors) {
    var N = elevators.length;
    var F = floors.length;
    function owner(floor) { return Math.min(N - 1, Math.floor(floor / (F / N))); }

    elevators.forEach(function(e, i) {
      e.goingUpIndicator(true);
      e.goingDownIndicator(true);
      e.on("floor_button_pressed", function(f) { e.goToFloor(f); });
      e.on("idle", function() {
        var lo = Math.round(i * F / N);
        var hi = Math.round((i + 1) * F / N) - 1;
        e.goToFloor(i === 0 ? 0 : Math.floor((lo + hi) / 2));
      });
    });

    floors.forEach(function(f) {
      var call = function() {
        var floor = f.floorNum();
        var e = elevators[owner(floor)];
        e.goToFloor(floor);
        elevators.forEach(function(other) {
          if (other !== e &&
              other.destinationDirection() === "stopped" &&
              other.loadFactor() === 0) {
            other.goToFloor(floor);
          }
        });
      };
      f.on("up_button_pressed", call);
      f.on("down_button_pressed", call);
    });
  }
}`;

/** Does nothing — used to verify levels fail without player logic. */
export const IDLE_SOLUTION = `{ init: function() {} }`;
