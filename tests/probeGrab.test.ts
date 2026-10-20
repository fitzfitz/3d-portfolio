import { describe, it, expect } from "vitest";
import { PROBE_IDS } from "../src/data/probes";
import { BEAM_RANGE } from "../src/utils/tractorBeam";
import {
  grabbableProbe, nearestProbe, relocationDone, relocationLine, rcsPuff, relocationSettled, spotPos,
  burnDirection, probeTip, probeTipText, trimTone,
  RELOCATE_S, RCS_PERIOD_S, TRIM_DESAT,
} from "../src/utils/probes";
import { PROBES } from "../src/data/probes";

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

// Ruling R12: the next-stop hint waits for the last probe's relocation, so
// its PROBE RELOCATING line plays first and cannot cut the hint short.
describe("relocationSettled", () => {
  const def = PROBES[0];
  const at = (spot: number) => positions({ [def.id]: [...spotPos(def, spot)] as [number, number, number] });
  const spots = (n: number) => Object.fromEntries(PROBE_IDS.map((id) => [id, id === def.id ? n : 0]));

  it("is settled when no relocation was asked for", () => {
    expect(relocationSettled(null, spots(0), at(0), none())).toBe(true);
  });

  it("is not settled right after the close: the spot advanced, the probe has not moved", () => {
    expect(relocationSettled(def.id, spots(1), at(0), none())).toBe(false);
  });

  it("is not settled while the burn plays", () => {
    expect(relocationSettled(def.id, spots(1), positions({ [def.id]: [0, 0, 0] }), { ...none(), [def.id]: true })).toBe(false);
  });

  it("is not settled on the burn's last frame if the flag is still up, even at the spot", () => {
    expect(relocationSettled(def.id, spots(1), at(1), { ...none(), [def.id]: true })).toBe(false);
  });

  it("is settled once the probe sits at its new spot with its flag cleared", () => {
    expect(relocationSettled(def.id, spots(1), at(1), none())).toBe(true);
  });
});

// Task 12 (R13): the burn must read as a streak, not a disc shrinking down the view line.
describe("burnDirection", () => {
  const angleDeg = (a: number[], b: { x: number; y: number; z: number }) =>
    (Math.acos(Math.max(-1, Math.min(1, (a[0] * b.x + a[1] * b.y + a[2] * b.z) / Math.hypot(a[0], a[1], a[2])))) * 180) / Math.PI;
  const axes = [[0, 0, 1], [1, 0, 0], [0.3, -0.2, -0.9], [0, 1, 0], [0, -1, 0], [0.001, 1, 0], [5, 2, -3]];

  it("is a unit vector at least 45° off the ship-to-probe axis, for every probe", () => {
    for (const a of axes) {
      for (let i = 0; i < PROBE_IDS.length; i++) {
        const out = { x: 0, y: 0, z: 0 };
        burnDirection(a[0], a[1], a[2], i, out);
        expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
        const deg = angleDeg(a, out);
        expect(deg, `axis ${a} probe ${i}`).toBeGreaterThanOrEqual(45);
        expect(deg, `axis ${a} probe ${i}`).toBeLessThan(90); // still away from the ship
      }
    }
  });

  it("is deterministic per probe and climbs a little off a level axis", () => {
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    burnDirection(0, 0, 1, 1, a);
    burnDirection(0, 0, 1, 1, b);
    expect(a).toEqual(b);
    for (let i = 0; i < PROBE_IDS.length; i++) {
      burnDirection(0, 0, 1, i, a);
      expect(a.y, `probe ${i}`).toBeGreaterThan(0.05);
    }
  });

  it("swings mostly sideways, neighbouring probes to opposite sides", () => {
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    burnDirection(0, 0, 1, 0, a);
    burnDirection(0, 0, 1, 1, b);
    expect(Math.sign(a.x)).not.toBe(Math.sign(b.x));
    expect(Math.abs(a.x)).toBeGreaterThan(a.y);
    expect(Math.abs(a.x)).toBeGreaterThan(0.5);
  });

  it("tolerates a zero axis", () => {
    const out = { x: 0, y: 0, z: 0 };
    burnDirection(0, 0, 0, 0, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
  });
});

// Task 12 (R13): the tip only says HOLD F when the beam would take the probe.
describe("probeTip", () => {
  it("is null with no probe in range", () => {
    expect(probeTip(0, 0, 0, 0, 0, 1, positions(), none(), null)).toBe(null);
  });
  it("is grab when the beam would select a probe", () => {
    expect(probeTip(0, 0, 0, 0, 0, 1, positions({ fuxx: [0, 0, 20] }), none(), "fuxx")).toBe("grab");
  });
  it("is closer beyond the beam's 30 u, even dead ahead", () => {
    expect(probeTip(0, 0, 0, 0, 0, 1, positions({ fuxx: [0, 0, 34] }), none(), "fuxx")).toBe("closer");
  });
  it("is turn inside 30 u but outside the 20° cone", () => {
    expect(probeTip(0, 0, 0, 0, 0, 1, positions({ fuxx: [20, 0, 0] }), none(), "fuxx")).toBe("turn");
    expect(probeTip(0, 0, 0, 0, 0, 1, positions({ fuxx: [0, 0, -20] }), none(), "fuxx")).toBe("turn");
  });
});

describe("probeTipText", () => {
  it("names the grab control for keyboard, pad and touch", () => {
    expect(probeTipText("grab", false, false)).toBe("PROBE IN RANGE // HOLD F TO GRAB");
    expect(probeTipText("grab", true, false)).toBe("PROBE IN RANGE // HOLD LB TO GRAB");
    expect(probeTipText("grab", false, true)).toBe("PROBE IN RANGE // HOLD BEAM TO GRAB");
    expect(probeTipText("grab", true, true)).toBe("PROBE IN RANGE // HOLD LB TO GRAB");
  });
  it("says to fly closer or turn otherwise, and nothing with no probe", () => {
    expect(probeTipText("closer", false, false)).toBe("PROBE NEARBY // FLY CLOSER");
    expect(probeTipText("turn", true, false)).toBe("PROBE NEARBY // TURN TOWARD IT");
    expect(probeTipText(null, false, false)).toBe(null);
  });
});

describe("trimTone (matches turntable_probe.py toned())", () => {
  it("pulls the colour 60% toward its own Rec. 709 luminance, not toward white", () => {
    const out = { r: 0, g: 0, b: 0 };
    trimTone(1, 0, 0, out);
    const y = 0.2126;
    expect(out.r).toBeCloseTo(1 + 0.6 * (y - 1));
    expect(out.g).toBeCloseTo(0.6 * y);
    expect(out.b).toBeCloseTo(0.6 * y);
    trimTone(0.5, 0.5, 0.5, out); // a grey is its own luminance
    expect(out).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(TRIM_DESAT).toBe(0.6);
  });
});
