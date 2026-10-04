import { describe, expect, it } from "vitest";
import { Runner } from "./runner";
import { DEFAULT_STARTER_CODE, LEVELS } from "./levels";
import {
  BATCHING_SOLUTION,
  NAIVE_SOLUTION,
  ZONE_SOLUTION,
} from "./probeSolutions";

/**
 * The game's difficulty criteria, pinned so tuning changes must hold them:
 *
 * 1. L1: the starter clears the quota with only a small margin.
 * 2. Every level: the starter scores a non-zero delivery count.
 * 3. L2: the starter fails — but with a low, non-zero score (it meets the
 *    delivery quota but blows the wait-time gate).
 * 4. L5: only very optimal strategies succeed; the best-known strategy
 *    finishes close to the time limit.
 */
describe("difficulty criteria", () => {
  it("L1: the starter barely passes within the time limit", () => {
    const level = LEVELS[0];
    const r = new Runner(DEFAULT_STARTER_CODE, level, 1);
    const result = r.runToEnd();
    expect(result.error).toBeUndefined();
    expect(result.success, result.reason).toBe(true);
    // "Barely passes": finishing well below the limit would mean it's too easy.
    expect(result.snapshot.time).toBeGreaterThanOrEqual(level.timeLimitSeconds * 0.9);
  });

  it("every level: the starter scores a non-zero delivery count", () => {
    for (const level of LEVELS) {
      const r = new Runner(DEFAULT_STARTER_CODE, level, 1);
      const result = r.runToEnd();
      expect(result.error, `level ${level.id}`).toBeUndefined();
      expect(result.snapshot.delivered, `level ${level.id}`).toBeGreaterThan(0);
    }
  });

  it("L2: the starter fails with a low (nonzero) score", () => {
    const r = new Runner(DEFAULT_STARTER_CODE, LEVELS[1], 1);
    const result = r.runToEnd();
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(false);
    expect(result.snapshot.delivered).toBeGreaterThan(0);
    // The intended lesson: waits, not deliveries, are what fail the starter.
    expect(result.reason).toMatch(/wait/i);
  });

  it("L5: only very optimal strategies succeed", () => {
    // Best-known tier: static zones.
    const zones = new Runner(ZONE_SOLUTION, LEVELS[4], 1).runToEnd();
    expect(zones.error).toBeUndefined();
    expect(zones.success, zones.reason).toBe(true);
    // ...and it doesn't finish trivially early.
    expect(zones.snapshot.time).toBeGreaterThanOrEqual(LEVELS[4].timeLimitSeconds * 0.7);
    // Weaker tiers do not make it.
    expect(new Runner(NAIVE_SOLUTION, LEVELS[4], 1).runToEnd().success).toBe(false);
    expect(new Runner(BATCHING_SOLUTION, LEVELS[4], 1).runToEnd().success).toBe(false);
  });
});
