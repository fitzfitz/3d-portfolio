import { describe, it, expect } from "vitest";
import {
  createDirector, stepDirector, endEvent, forceStart,
  FIRST_EVENT_AT, GAP_MIN, GAP_SPAN, EVENT_DURATION, type DirectorInput, type WorldEventKind,
} from "../src/utils/eventDirector";

const calm: DirectorInput = { dt: 1, paused: false, raceRunning: false, radioBusy: false, reducedMotion: false };
/** Deterministic LCG in [0,1). */
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

describe("eventDirector", () => {
  it("starts the first event at 45s", () => {
    const d = createDirector(() => 0);
    let at = -1;
    for (let n = 0; n < 60 && at < 0; n++) if (stepDirector(d, calm).started) at = d.clock;
    expect(at).toBe(FIRST_EVENT_AT);
  });

  it("ends an event after its duration and waits 60–120s before the next", () => {
    const d = createDirector(() => 0); // gap = GAP_MIN, kinds in list order
    const starts: { kind: WorldEventKind; at: number }[] = [];
    const ends: number[] = [];
    for (let n = 0; n < 400; n++) {
      const st = stepDirector(d, calm);
      if (st.started) starts.push({ kind: st.started.kind, at: d.clock });
      if (st.ended) ends.push(d.clock);
    }
    expect(starts[0]).toEqual({ kind: "comet", at: 45 });
    expect(ends[0]).toBe(45 + EVENT_DURATION.comet);
    expect(starts[1].at).toBe(ends[0] + GAP_MIN);
    expect(starts[1].kind).toBe("flare");
  });

  it("never repeats a kind back to back, and keeps every gap within 60–120s", () => {
    const d = createDirector(lcg(7));
    let lastKind: WorldEventKind | null = null;
    let lastEnd: number | null = null;
    for (let n = 0; n < 20000; n++) {
      const st = stepDirector(d, { ...calm, dt: 0.5 });
      if (st.ended) lastEnd = d.clock;
      if (st.started) {
        expect(st.started.kind).not.toBe(lastKind);
        if (lastEnd !== null) {
          const gap = d.clock - lastEnd;
          expect(gap).toBeGreaterThanOrEqual(GAP_MIN - 0.5);
          expect(gap).toBeLessThanOrEqual(GAP_MIN + GAP_SPAN + 0.5);
        }
        lastKind = st.started.kind;
      }
    }
  });

  it("does not advance, start or end anything while paused", () => {
    const d = createDirector(() => 0);
    for (let n = 0; n < 100; n++) expect(stepDirector(d, { ...calm, paused: true })).toEqual({ started: null, ended: null });
    expect(d.clock).toBe(0);
    forceStart(d, "flare");
    for (let n = 0; n < 100; n++) stepDirector(d, { ...calm, paused: true });
    expect(d.active?.kind).toBe("flare");
  });

  it("defers, not skips, a due start during a race or a busy radio", () => {
    for (const block of [{ raceRunning: true }, { radioBusy: true }]) {
      const d = createDirector(() => 0);
      for (let n = 0; n < 55; n++) expect(stepDirector(d, { ...calm, ...block }).started).toBeNull();
      expect(stepDirector(d, calm).started?.kind).toBe("comet");
    }
  });

  it("starts nothing under reduced motion, but lets an active event end on time", () => {
    const d = createDirector(() => 0);
    for (let n = 0; n < 200; n++) expect(stepDirector(d, { ...calm, reducedMotion: true }).started).toBeNull();
    forceStart(d, "flare");
    let ended = false;
    for (let n = 0; n < EVENT_DURATION.flare + 1; n++) if (stepDirector(d, { ...calm, reducedMotion: true }).ended) ended = true;
    expect(ended).toBe(true);
  });

  it("forceStart ends the active event and starts the requested one", () => {
    const d = createDirector(() => 0);
    forceStart(d, "comet");
    const st = forceStart(d, "convoy");
    expect(st.ended?.kind).toBe("comet");
    expect(st.started?.kind).toBe("convoy");
    expect(d.active?.kind).toBe("convoy");
  });

  it("endEvent schedules the next start from the end time", () => {
    const d = createDirector(() => 0.5);
    forceStart(d, "flare");
    endEvent(d);
    expect(d.active).toBeNull();
    expect(d.nextAt).toBe(d.clock + GAP_MIN + 0.5 * GAP_SPAN);
  });
});
