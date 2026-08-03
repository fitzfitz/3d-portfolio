import { describe, it, expect, beforeEach, vi } from "vitest";
import { ambientTime, setAmbientEnabled, resetAmbientTime, gameTime, resetGameTime } from "../src/utils/ambientTime";

beforeEach(() => {
  resetAmbientTime();
  setAmbientEnabled(true);
  resetGameTime();
});

describe("ambientTime", () => {
  it("tracks real elapsed time while enabled", () => {
    expect(ambientTime(0)).toBe(0);
    expect(ambientTime(1)).toBe(1);
    expect(ambientTime(2.5)).toBe(2.5);
  });

  it("holds its value exactly while disabled", () => {
    ambientTime(5);
    setAmbientEnabled(false);
    expect(ambientTime(6)).toBe(5);
    expect(ambientTime(90)).toBe(5);
  });

  it("resumes from the held value instead of jumping to real time", () => {
    ambientTime(5);
    setAmbientEnabled(false);
    ambientTime(100); // 95s frozen
    setAmbientEnabled(true);
    // The next advance adds only the delta since the last call, not the frozen gap.
    expect(ambientTime(101)).toBe(6);
  });

  it("returns the same value for repeated calls within one frame", () => {
    ambientTime(3);
    expect(ambientTime(3)).toBe(3);
    expect(ambientTime(3)).toBe(3);
  });

  it("is order-independent across consumers in a frame", () => {
    ambientTime(1);
    const first = ambientTime(2);
    const second = ambientTime(2);
    const third = ambientTime(2);
    expect([second, third]).toEqual([first, first]);
  });

  it("ignores a clock that moves backwards rather than going negative", () => {
    ambientTime(10);
    expect(ambientTime(4)).toBe(10);
  });
});

describe("gameTime", () => {
  it("tracks real elapsed time", () => {
    expect(gameTime(0)).toBe(0);
    expect(gameTime(1)).toBe(1);
    expect(gameTime(2.5)).toBe(2.5);
  });

  it("returns the same value for repeated calls within one frame", () => {
    gameTime(3);
    expect(gameTime(3)).toBe(3);
    expect(gameTime(3)).toBe(3);
  });

  it("ignores a clock that moves backwards rather than going negative", () => {
    gameTime(10);
    expect(gameTime(4)).toBe(10);
  });

  // The whole reason gameTime exists instead of reusing ambientTime: gameplay
  // deadlines (warp suppression, impact debounce, meteor spawn timing) must
  // keep advancing under reduced motion, unlike decorative ambient motion.
  it("keeps advancing while ambientTime is disabled (reduced motion)", () => {
    setAmbientEnabled(false);
    expect(ambientTime(5)).toBe(0); // frozen at its seed
    expect(gameTime(5)).toBe(5); // unaffected by the ambientTime gate
    expect(ambientTime(10)).toBe(0);
    expect(gameTime(10)).toBe(10);
  });

  // The regression this function exists to fix: Spaceship.tsx compares a
  // live reading against an absolute deadline stored from an earlier frame
  // (`time > warpSuppressUntil.current`). A THREE.Clock reset (Task 6's
  // dossier freeze) rewinds the raw clock to ~0, but must not rewind
  // gameTime's own accumulated value — the deadline comparison has to keep
  // making sense across the reset, not restart from scratch.
  it("carries forward across a clock reset instead of restarting at zero", () => {
    // Ramp up in <30s steps (DISCONTINUITY_SECONDS) so each call is read as
    // real elapsed time rather than itself triggering the discontinuity path.
    gameTime(5); gameTime(15); gameTime(20); // well into a session
    const deadline = gameTime(20) + 0.45; // e.g. warpSuppressUntil after an impact at t=20
    // THREE.Clock reset: raw elapsed time drops back to ~0 and starts climbing again.
    expect(gameTime(0.1)).toBeCloseTo(20, 5); // re-seeds rather than rewinding
    expect(gameTime(0.6)).toBeGreaterThan(deadline); // 0.5s of real time later, deadline has passed
  });

  it("does not jump on the first reading of an already-elapsed clock (cold start)", async () => {
    vi.resetModules();
    const fresh = await import("../src/utils/ambientTime");
    expect(fresh.gameTime(5)).toBe(0);
    expect(fresh.gameTime(6)).toBe(1);
  });
});

// This module's own doc comment states its reason for existing: no jump on
// the first frame if a consumer's clock doesn't start at exactly 0. That
// guarantee lives entirely in the `lastReal === null` branch, which every
// other test in this file never reaches — `resetAmbientTime()` seeds
// `lastReal = 0`, not null, so those tests only ever exercise the warm,
// already-seeded state. Production reaches `null` exactly once, at true
// module load, before `resetAmbientTime` (a test-only export) has ever run.
// `vi.resetModules()` plus a dynamic re-import gets a fresh module instance
// with its own top-level state, reproducing that genuine cold start without
// touching the statically-imported bindings the tests above rely on.
describe("ambientTime cold start", () => {
  it("does not jump on the first reading of an already-elapsed clock", async () => {
    vi.resetModules();
    const fresh = await import("../src/utils/ambientTime");
    expect(fresh.ambientTime(5)).toBe(0);
    expect(fresh.ambientTime(6)).toBe(1);
  });
});
