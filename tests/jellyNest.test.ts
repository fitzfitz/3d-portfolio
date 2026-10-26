import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guideOfferBlocked, nestKeepOut, type GuideOfferState } from "../src/utils/jellyNest";
import { JELLY_RADIUS, pushOutOfSolids } from "../src/utils/jellyMood";
import { NEST_LEASH_R } from "../src/utils/combat/constants";
import { NEST_CENTRE } from "../src/data/nest";
import { RACE_IDLE } from "../src/utils/raceSession";

/**
 * The jellyfish and the Nest (Rulings C9, C19): the guide keeps out of the
 * whole fighting area (110 u, not the 70 u zone), and does not offer itself
 * while the ship is in the Nest.
 */
const calm: GuideOfferState = {
  isOrbitLocked: false, openDossier: null, raceView: RACE_IDLE, photoMode: false, showClassicCV: false, inNest: false,
};

describe("the jellyfish keeps out of the Nest (C9, C19)", () => {
  it("its keep-out is the fighting area: centred on the Nest, r = body = NEST_LEASH_R + JELLY_RADIUS", () => {
    const k = nestKeepOut();
    expect(k).toEqual({
      x: NEST_CENTRE[0], y: NEST_CENTRE[1], z: NEST_CENTRE[2],
      r: NEST_LEASH_R + JELLY_RADIUS, body: NEST_LEASH_R + JELLY_RADIUS,
    });
    expect(k.r).toBeGreaterThan(NEST_LEASH_R);
  });

  it("a jellyfish inside the fighting area is pushed out past its edge", () => {
    const k = nestKeepOut();
    const p = { x: NEST_CENTRE[0] + 80, y: NEST_CENTRE[1], z: NEST_CENTRE[2] };
    expect(pushOutOfSolids(p, [k])).toBe(true);
    const d = Math.hypot(p.x - NEST_CENTRE[0], p.y - NEST_CENTRE[1], p.z - NEST_CENTRE[2]);
    expect(d).toBeGreaterThanOrEqual(NEST_LEASH_R + JELLY_RADIUS - 1e-9);
    // One already outside stays where it is.
    const q = { x: NEST_CENTRE[0] + 200, y: NEST_CENTRE[1], z: NEST_CENTRE[2] };
    expect(pushOutOfSolids(q, [k])).toBe(false);
    expect(q.x).toBe(NEST_CENTRE[0] + 200);
  });

  it("the guide does not offer itself while the ship is in the Nest", () => {
    expect(guideOfferBlocked(calm, false)).toBe(false);
    expect(guideOfferBlocked({ ...calm, inNest: true }, false)).toBe(true);
    // The other blockers still apply.
    expect(guideOfferBlocked({ ...calm, photoMode: true }, false)).toBe(true);
    expect(guideOfferBlocked({ ...calm, showClassicCV: true }, false)).toBe(true);
    expect(guideOfferBlocked({ ...calm, isOrbitLocked: true }, false)).toBe(true);
    expect(guideOfferBlocked({ ...calm, raceView: { phase: "running", race: "r", kind: "solo", next: 0, goAt: 0, finalEndsAt: null, finished: false } }, false)).toBe(true);
    expect(guideOfferBlocked(calm, true)).toBe(true);
  });

  it("SpaceJellyfish uses both: the Nest keep-out after the bodies, and the offer block", () => {
    const src = readFileSync(join(process.cwd(), "src/components/canvas/SpaceJellyfish.tsx"), "utf8");
    expect(src).toMatch(/SOLAR_BODIES\.map\([\s\S]*?\),\s*(?:\/\/[^\n]*\n\s*)*nestKeepOut\(\)/);
    expect(src).toMatch(/fi\.blocked = guideOfferBlocked\(store, radioBusy\)/);
  });
});
