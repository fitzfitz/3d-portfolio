import { describe, it, expect, beforeEach } from "vitest";
import { perfStats, pushFrame, percentile, resetStats } from "../src/debug/perfStats";

describe("perfStats", () => {
  beforeEach(() => resetStats());

  it("reports 0 before any frame is recorded", () => {
    expect(percentile(50)).toBe(0);
    expect(percentile(99)).toBe(0);
  });

  it("computes p50 and p99 over recorded frames", () => {
    for (let i = 1; i <= 100; i++) pushFrame(i);
    expect(percentile(50)).toBe(50);
    expect(percentile(99)).toBe(99);
  });

  // Nearest-rank: p99 of 100 samples is the 99th, i.e. index 98. A single
  // spike in 100 therefore does NOT land at p99 -- it takes 10 spikes in 100
  // for the 99th-ranked sample to be one. Asserting otherwise would be
  // asserting a percentile definition that no percentile uses.
  it("surfaces sustained spikes at p99 but not at p50", () => {
    for (let i = 0; i < 90; i++) pushFrame(16);
    for (let i = 0; i < 10; i++) pushFrame(400);
    expect(percentile(50)).toBe(16);
    expect(percentile(99)).toBe(400);
  });

  it("does not let one outlier in a hundred move p99", () => {
    for (let i = 0; i < 99; i++) pushFrame(16);
    pushFrame(400);
    expect(percentile(99)).toBe(16);
    expect(percentile(100)).toBe(400);
  });

  it("wraps at capacity, keeping only the most recent samples", () => {
    for (let i = 0; i < 300; i++) pushFrame(1);
    for (let i = 0; i < 240; i++) pushFrame(9);
    expect(perfStats.count).toBe(240);
    expect(percentile(50)).toBe(9);
  });

  it("clamps percentile input to the valid range", () => {
    for (let i = 1; i <= 10; i++) pushFrame(i);
    expect(percentile(0)).toBe(1);
    expect(percentile(100)).toBe(10);
    expect(percentile(150)).toBe(10);
  });
});
