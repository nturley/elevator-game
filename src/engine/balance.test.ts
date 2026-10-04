import { describe, expect, it } from "vitest";
import { Runner } from "./runner";
import { LEVELS } from "./levels";
import {
  BATCHING_SOLUTION,
  NAIVE_SOLUTION,
  ZONE_SOLUTION,
} from "./probeSolutions";

/**
 * Balance probes: log what different strategies achieve per level so goal
 * targets can be calibrated. Always passes (except on code errors).
 */
function probe(label: string, code: string, levelIndex: number, seed = 7) {
  const r = new Runner(code, LEVELS[levelIndex], seed);
  const result = r.runToEnd();
  const s = result.snapshot;
  console.log(
    `${label}: success=${result.success} reason="${result.reason}" ` +
      `delivered=${s.delivered} avgWait=${s.avgWait.toFixed(1)}s ` +
      `maxWait=${s.maxWait.toFixed(1)}s waiting=${s.totalWaiting}`
  );
  expect(result.error).toBeUndefined();
}

describe("balance probes", () => {
  it("L1 naive", () => probe("L1 naive", NAIVE_SOLUTION, 0));
  it("L2 naive", () => probe("L2 naive", NAIVE_SOLUTION, 1));
  it("L3 naive", () => probe("L3 naive", NAIVE_SOLUTION, 2));
  it("L4 naive", () => probe("L4 naive", NAIVE_SOLUTION, 3));
  it("L4 batching", () => probe("L4 batching", BATCHING_SOLUTION, 3));
  it("L5 naive", () => probe("L5 naive", NAIVE_SOLUTION, 4));
  it("L5 batching", () => probe("L5 batching", BATCHING_SOLUTION, 4));
  it("L5 zones", () => probe("L5 zones", ZONE_SOLUTION, 4));
});
