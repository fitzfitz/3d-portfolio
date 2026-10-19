import { describe, it, expect } from "vitest";
import { PROBE_IDS } from "../src/data/probes";
import { BEAM_RANGE } from "../src/utils/tractorBeam";
import {
  grabbableProbe, nearestProbe, relocationDone, relocationLine, rcsPuff,
  RELOCATE_S, RCS_PERIOD_S,
} from "../src/utils/probes";

/** Probe positions keyed by id, all parked far away unless a case moves them. */
function positions(over: Partial<Record<string, [number, number, number]>> = {}) {
  const out: Record<string, { x: number; y: number; z: number }> = {};
  for (const id of PROBE_IDS) {
    const [x, y, z] = over[id] ?? [1000, 1000, 1000];
    out[id] = { x, y, z };
  }
  return out;
}
const none = (): Record<string, boolean> => Object.fromEntries(PROBE_IDS.map((id) => [id, false]));

// Review Focus 3: the beam grabs the right probe, never a relocating one.
describe("grabbableProbe", () => {
  it("returns the nearest of two probes in the cone", () => {
    const pos = positions({ ruangrapi: [0, 0, 22], portfolio: [0, 1, 9] });
    expect(grabbableProbe(0, 0, 0, 0, 0, 1, pos, none())).toBe("portfolio");
  });

  it("skips a relocating probe", () => {
    const pos = positions({ ruangrapi: [0, 0, 22], portfolio: [0, 1, 9] });
    const relocating = { ...none(), portfolio: true };
    expect(grabbableProbe(0, 0, 0, 0, 0, 1, pos, relocating)).toBe("ruangrapi");
    expect(grabbableProbe(0, 0, 0, 0, 0, 1, pos, { ...relocating, ruangrapi: true })).toBe(null);
  });

  it("returns null outside the beam's 30 u range", () => {
    expect(BEAM_RANGE).toBe(30);
    expect(grabbableProbe(0, 0, 0, 0, 0, 1, positions({ fuxx: [0, 0, 30.5] }), none())).toBe(null);
    expect(grabbableProbe(0, 0, 0, 0, 0, 1, positions({ fuxx: [0, 0, 29.5] }), none())).toBe("fuxx");
  });

  it("returns null outside the 20° cone", () => {
    const off = (deg: number): [number, number, number] => {
      const a = (deg * Math.PI) / 180;
      return [Math.sin(a) * 15, 0, Math.cos(a) * 15];
    };
    expect(grabbableProbe(0, 0, 0, 0, 0, 1, positions({ fuxx: off(21) }), none())).toBe(null);
    expect(grabbableProbe(0, 0, 0, 0, 0, 1, positions({ fuxx: off(19) }), none())).toBe("fuxx");
  });

  it("measures from the beam origin, not the world origin", () => {
    const pos = positions({ ruangrapi: [100, 50, 120] });
    expect(grabbableProbe(100, 50, 100, 0, 0, 1, pos, none())).toBe("ruangrapi");
    expect(grabbableProbe(100, 50, 100, 0, 0, -1, pos, none())).toBe(null);
  });
});

describe("nearestProbe (HUD tip and chatter)", () => {
  it("returns the nearest probe within range, in any direction", () => {
    const pos = positions({ ruangrapi: [0, 0, -40], fuxx: [30, 0, 0] });
    expect(nearestProbe(0, 0, 0, pos, none(), 45)).toBe("fuxx");
  });
  it("returns null when every probe is out of range", () => {
    expect(nearestProbe(0, 0, 0, positions({ fuxx: [0, 46, 0] }), none(), 45)).toBe(null);
  });
  it("ignores a relocating probe (it is leaving, not grabbable)", () => {
    const pos = positions({ fuxx: [0, 5, 0] });
    expect(nearestProbe(0, 0, 0, pos, { ...none(), fuxx: true }, 45)).toBe(null);
  });
});

// Review Focus 5: the burn always ends, and reduced motion skips it.
// (Review Focus 3's store side, "openProjectDossier is a no-op while another
// is open", is tests/spaceStore.test.ts "openProjectDossier while one is open
// is ignored".)
describe("relocationDone", () => {
  it("is done at t = 0 under reduced motion", () => {
    expect(relocationDone(0, true)).toBe(true);
  });
  it("runs for RELOCATE_S otherwise", () => {
    expect(relocationDone(0, false)).toBe(false);
    expect(relocationDone(RELOCATE_S - 0.01, false)).toBe(false);
    expect(relocationDone(RELOCATE_S, false)).toBe(true);
    expect(relocationDone(RELOCATE_S + 3, false)).toBe(true);
  });
});

describe("relocationLine", () => {
  it("names the project, a bearing off the nose and the distance", () => {
    // Heading 0 faces +z: straight ahead is bearing 000.
    expect(relocationLine("RUANGRAPI", 0, 300, 312.4, 0)).toBe("PROBE RELOCATING // RUANGRAPI SIGNAL REACQUIRED BEARING 000 AT 312 U");
  });
  it("measures the bearing clockwise from the nose, like the heading-up radar", () => {
    expect(relocationLine("FUXX", -10, 0, 10, 0)).toContain("BEARING 090 AT 10 U"); // -x is to starboard at heading 0
    expect(relocationLine("FUXX", 0, -10, 10, 0)).toContain("BEARING 180");
    expect(relocationLine("FUXX", 10, 0, 10, 0)).toContain("BEARING 270");
    // Turned to face +x (heading +90°), +x is dead ahead.
    expect(relocationLine("FUXX", 10, 0, 10, Math.PI / 2)).toContain("BEARING 000");
  });
});

describe("rcsPuff", () => {
  it("is a brief flash once per period and dark the rest of the time", () => {
    let lit = 0, peak = 0;
    const steps = 6000;
    for (let i = 0; i < steps; i++) {
      const v = rcsPuff((i / steps) * RCS_PERIOD_S, 0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v > 0) lit++;
      peak = Math.max(peak, v);
    }
    expect(peak).toBeGreaterThan(0.95);
    expect(lit / steps).toBeLessThan(0.1);
  });
  it("repeats every ~6 s and the phase de-syncs probes", () => {
    expect(RCS_PERIOD_S).toBeGreaterThanOrEqual(5);
    expect(RCS_PERIOD_S).toBeLessThanOrEqual(7);
    expect(rcsPuff(0.1, 0)).toBeCloseTo(rcsPuff(0.1 + RCS_PERIOD_S, 0));
    expect(rcsPuff(0.1, 0)).not.toBeCloseTo(rcsPuff(0.1, 2));
  });
});
