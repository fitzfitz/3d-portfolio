import { describe, it, expect } from "vitest";
import {
  createDirector, stepDirector, endEvent, forceStart, skipEvent, ambientStep, SKIP_RETRY_S,
  FIRST_EVENT_AT, GAP_MIN, GAP_SPAN, EVENT_DURATION, REDUCED_MOTION_KINDS, type DirectorInput, type DirectorStep, type WorldEventKind,
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

  it("still starts events under reduced motion, on schedule, but only comets and convoys", () => {
    // Reduced motion used to block every event, which left the Comet chaser and
    // Convoy spotter badges (and the logbook's "all done") out of reach.
    for (const seed of [1, 7, 42]) {
      const d = createDirector(lcg(seed));
      const kinds: WorldEventKind[] = [];
      let first = -1;
      for (let n = 0; n < 20000; n++) {
        const st = stepDirector(d, { ...calm, dt: 0.5, reducedMotion: true });
        if (st.started) { kinds.push(st.started.kind); if (first < 0) first = d.clock; }
      }
      expect(first).toBe(FIRST_EVENT_AT);
      expect(kinds.length).toBeGreaterThan(10);
      expect(kinds).not.toContain("flare");
      expect(new Set(kinds)).toEqual(new Set(["comet", "convoy"]));
      // Never the same kind twice running, here too: so they alternate.
      for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
    }
  });

  it("a flare already playing ends at once when reduced motion comes on", () => {
    const d = createDirector(() => 0);
    forceStart(d, "flare");
    const st = stepDirector(d, { ...calm, dt: 0.1, reducedMotion: true });
    expect(st.ended?.kind).toBe("flare");
    expect(d.active).toBeNull();
  });

  it("a comet or convoy under reduced motion plays its full length", () => {
    for (const kind of REDUCED_MOTION_KINDS) {
      const d = createDirector(() => 0);
      forceStart(d, kind);
      let endedAt = -1;
      for (let n = 0; n < 200 && endedAt < 0; n++) if (stepDirector(d, { ...calm, reducedMotion: true }).ended) endedAt = d.clock;
      expect(endedAt, kind).toBe(EVENT_DURATION[kind]);
    }
  });

  it("forceStart ends the active event and starts the requested one", () => {
    const d = createDirector(() => 0);
    forceStart(d, "comet");
    const st = forceStart(d, "convoy");
    expect(st.ended?.kind).toBe("comet");
    expect(st.started?.kind).toBe("convoy");
    expect(d.active?.kind).toBe("convoy");
  });

  it("retries a skipped event within a few seconds, as a different kind", () => {
    // Review M3: a comet with no clear line fell through to endEvent and a full
    // 60-120s gap, so a pilot parked near a planet could see nothing for minutes.
    const d = createDirector(() => 0);
    forceStart(d, "comet");
    skipEvent(d);
    expect(d.active).toBeNull();
    expect(d.nextAt - d.clock).toBeLessThanOrEqual(SKIP_RETRY_S);
    let started = null;
    for (let n = 0; n < 20 && !started; n++) started = stepDirector(d, calm).started;
    expect(started?.kind).not.toBe("comet");
  });

  it("ambientStep advances by the full ambient gap, never backwards", () => {
    // Review I1: the director must run on the planets' clock (ambient time), not a
    // frame-capped dt, or a pre-cleared comet line drifts out of sync with them.
    expect(ambientStep(null, 12)).toBe(0);
    expect(ambientStep(10, 25)).toBe(15);
    expect(ambientStep(10, 10)).toBe(0);
    expect(ambientStep(10, 4)).toBe(0); // a clock reset never runs the director backwards
  });

  it("endEvent schedules the next start from the end time", () => {
    const d = createDirector(() => 0.5);
    forceStart(d, "flare");
    endEvent(d);
    expect(d.active).toBeNull();
    expect(d.nextAt).toBe(d.clock + GAP_MIN + 0.5 * GAP_SPAN);
  });
});

describe("stepDirector out parameter", () => {
  it("reuses and resets the given step object", () => {
    const s = createDirector(() => 0.5);
    const out: DirectorStep = { started: null, ended: null };
    const inp = { dt: 50, paused: false, raceRunning: false, radioBusy: false, reducedMotion: false };
    const first = stepDirector(s, inp, out);
    expect(first).toBe(out);
    expect(out.started).not.toBeNull();
    stepDirector(s, { ...inp, dt: 0.01 }, out);
    expect(out.started).toBeNull();
  });
});
