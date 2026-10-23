import { describe, it, expect } from "vitest";
import {
  createGuideState, stepGuide, type GuideInput, type GuideState, type GuideEvent,
  GUIDE_LOST_SECONDS, GUIDE_OFFER_COOLDOWN, GUIDE_COME_SECONDS, GUIDE_LEAD_DIST,
  GUIDE_PRESENT_SECONDS, GUIDE_PRESENT_MIN_R, GUIDE_LEAD_MAX_ANGLE,
  GUIDE_REDUCED_SNAP_DIST,
} from "../src/utils/jellyGuide";
import { pushOutOfSolids, JELLY_RADIUS, type JellyKeepOut } from "../src/utils/jellyMood";
import { SHIP_WARP_SPEED, PORTAL_ZONE_R } from "../src/constants";
import { CRUISE_MAX_FACTOR } from "../src/utils/cruise";
import { DESTINATIONS } from "../src/data/destinations";
import { STATION_RADII } from "../src/data/careerTrail";
import { SHIP_HALF_LENGTH } from "../src/utils/worldCollide";

type V = { x: number; y: number; z: number };
const v = (x = 0, y = 0, z = 0): V => ({ x, y, z });
const copyV = (o: V, a: V) => { o.x = a.x; o.y = a.y; o.z = a.z; };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (a: V) => Math.hypot(a.x, a.y, a.z);
const DT = 1 / 60;
const CRUISE = 10.8;
const DEG = Math.PI / 180;
/** Level heading `deg` degrees off +x (toward +z): unit vector. */
const heading = (deg: number): V => v(Math.cos(deg * DEG), 0, Math.sin(deg * DEG));
/** How far the guide is in front of the ship's nose (u): (pos - ship) . nose. */
const ahead = (s: GuideState, inp: GuideInput) =>
  (s.pos.x - inp.ship.x) * inp.shipNose.x + (s.pos.y - inp.ship.y) * inp.shipNose.y + (s.pos.z - inp.ship.z) * inp.shipNose.z;
/** Angle (degrees) between (pos - ship) and the nose. */
const offNose = (s: GuideState, inp: GuideInput) =>
  Math.acos(Math.min(1, ahead(s, inp) / dist(s.pos, inp.ship))) / DEG;

/** One reusable input, as the frame loop will keep it (spec: frame loop allocates nothing). */
const input = (over: Partial<GuideInput> = {}): GuideInput => ({
  jelly: v(0, 0, 300), ship: v(), shipVel: v(), shipNose: v(1, 0, 0), warping: false,
  target: v(1000, 0, 0), targetRadius: 15, progress: 0, blocked: false,
  reducedMotion: false, toggle: false, keepOut: [], ...over,
});

/** A moving ship points its nose where it flies; a hovering one keeps its last nose. */
function noseAlongVel(inp: GuideInput) {
  const sp = len(inp.shipVel);
  if (sp > 0) { inp.shipNose.x = inp.shipVel.x / sp; inp.shipNose.y = inp.shipVel.y / sp; inp.shipNose.z = inp.shipVel.z / sp; }
}

/**
 * Step for `seconds`, flying the ship by its velocity, nose along it. Collects
 * every event. `toggle` is an edge: it is cleared after the first step.
 */
function run(s: GuideState, inp: GuideInput, seconds: number, each?: (s: GuideState) => void): GuideEvent[] {
  const events: GuideEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    inp.ship.x += inp.shipVel.x * DT; inp.ship.y += inp.shipVel.y * DT; inp.ship.z += inp.shipVel.z * DT;
    noseAlongVel(inp);
    stepGuide(s, inp, DT);
    inp.toggle = false;
    if (s.event) events.push(s.event);
    each?.(s);
  }
  return events;
}
const press = (s: GuideState, inp: GuideInput) => { inp.toggle = true; return run(s, inp, DT); };

describe("calling it (J)", () => {
  it("toggles: J while roaming calls it, J while active sends it back to roaming", () => {
    const s = createGuideState(), inp = input();
    run(s, inp, 1);
    expect(s.name).toBe("roaming");
    expect(press(s, inp)).toEqual(["called"]);
    expect(s.name).toBe("coming");
    run(s, inp, 0.5);
    expect(press(s, inp)).toEqual(["dismissed"]);
    expect(s.name).toBe("roaming");
    expect(s.guiding).toBe(false);
  });

  it("is dismissed by J from leading and presenting too", () => {
    const s = createGuideState(), inp = input();
    press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
    expect(s.name).toBe("leading");
    expect(press(s, inp)).toEqual(["dismissed"]);
    expect(s.name).toBe("roaming");

    const p = createGuideState(), pin = input({ target: v(10, 0, 0) });
    press(p, pin); run(p, pin, GUIDE_COME_SECONDS + 0.5);
    expect(p.name).toBe("presenting");
    expect(press(p, pin)).toEqual(["dismissed"]);
    expect(p.name).toBe("roaming");
  });

  it("emits each event on one frame only (the field resets every step)", () => {
    const s = createGuideState(), inp = input();
    press(s, inp);
    expect(s.event).toBe("called");
    run(s, inp, DT);
    expect(s.event).toBeNull();
  });

  it("streaks to the ship in ~2 s and meets it, even from across the system", () => {
    const s = createGuideState(), inp = input({ jelly: v(-3000, 400, 2500), shipVel: v(0, 0, CRUISE) });
    press(s, inp);
    // A streak, not a teleport: still far after a quarter second.
    run(s, inp, 0.25);
    expect(dist(s.pos, inp.ship)).toBeGreaterThan(100);
    expect(s.streak).toBe(true);
    const events = run(s, inp, GUIDE_COME_SECONDS - 0.25 + 0.05);
    expect(events).toContain("met");
    expect(s.name).toBe("leading");
    // Plan's e2e bound: within ~25 u of the ship in <= 3 s.
    run(s, inp, 3 - GUIDE_COME_SECONDS - 0.05 - DT);
    expect(dist(s.pos, inp.ship)).toBeLessThanOrEqual(25);
  });

  it("is not held back by the offer cooldown", () => {
    const s = createGuideState(), inp = input();
    run(s, inp, GUIDE_LOST_SECONDS + 0.1);
    expect(s.name).toBe("coming");
    press(s, inp);
    expect(s.name).toBe("roaming");
    expect(s.cooldown).toBeGreaterThan(0);
    expect(press(s, inp)).toEqual(["called"]);
    expect(s.name).toBe("coming");
  });

  it("still answers J under a blocker (blockers gate only the offer)", () => {
    const s = createGuideState(), inp = input({ blocked: true });
    expect(press(s, inp)).toEqual(["called"]);
  });

  it("says all done instead of coming when nothing is left (target null)", () => {
    const s = createGuideState(), inp = input({ target: null });
    expect(press(s, inp)).toEqual(["allDone"]);
    expect(s.name).toBe("roaming");
  });
});

describe("offering itself (lost timer)", () => {
  it("offers after 45 s with no progress", () => {
    const s = createGuideState(), inp = input();
    expect(run(s, inp, GUIDE_LOST_SECONDS - 0.5)).toEqual([]);
    expect(s.name).toBe("roaming");
    expect(run(s, inp, 1)).toEqual(["offered"]);
    expect(s.name).toBe("coming");
    expect(s.offered).toBe(true);
  });

  it("restarts the count when the progress signature changes", () => {
    const s = createGuideState(), inp = input();
    run(s, inp, 40);
    inp.progress = 1;
    expect(run(s, inp, 40)).toEqual([]);
    expect(run(s, inp, 6)).toEqual(["offered"]);
  });

  it("never offers under a blocker, and the blocked time does not count", () => {
    const s = createGuideState(), inp = input();
    run(s, inp, 30);
    inp.blocked = true;
    expect(run(s, inp, 120)).toEqual([]);
    expect(s.name).toBe("roaming");
    inp.blocked = false;
    // Paused, not reset: 30 s banked, so 15 more unblocked seconds offer.
    expect(run(s, inp, 14)).toEqual([]);
    expect(run(s, inp, 1.5)).toEqual(["offered"]);
  });

  it("does not offer again inside the cooldown", () => {
    const s = createGuideState(), inp = input();
    run(s, inp, GUIDE_LOST_SECONDS + 0.1);
    press(s, inp); // the pilot sends the offer away
    expect(s.name).toBe("roaming");
    // Lost long past 45 s again, but the cooldown (counted from the offer) holds.
    expect(run(s, inp, GUIDE_OFFER_COOLDOWN - 5)).toEqual([]);
    expect(run(s, inp, 10)[0]).toBe("offered");
  });

  it("holds an overdue offer until the blocker lifts", () => {
    const s = createGuideState(), inp = input();
    run(s, inp, GUIDE_LOST_SECONDS + 0.1);
    press(s, inp);
    // Lost again for 100 s while the cooldown runs, then a blocker holds past its end.
    expect(run(s, inp, 100)).toEqual([]);
    inp.blocked = true;
    expect(run(s, inp, GUIDE_OFFER_COOLDOWN)).toEqual([]);
    inp.blocked = false;
    expect(run(s, inp, DT)).toEqual(["offered"]);
  });

  it("does not offer when everything is done", () => {
    const s = createGuideState(), inp = input({ target: null });
    expect(run(s, inp, 300)).toEqual([]);
  });

  // Owner, 2026-10-23 (after #54): "I never get any offer when I flew away".
  // A lost pilot flies anywhere, so a fly-away withdrawal ate every offer six
  // seconds in. An offer now behaves as a call: it stays until arrival or J.
  it("keeps an offered guide leading, in front of the nose, while the pilot flies away for 30 s", () => {
    const s = createGuideState(), inp = input();
    run(s, inp, GUIDE_LOST_SECONDS + 0.1);
    expect(s.name).toBe("coming");
    expect(s.offered).toBe(true);
    inp.shipVel.x = -CRUISE; // straight away from the target at +x
    expect(run(s, inp, 30)).toEqual(["met"]);
    expect(s.name).toBe("leading");
    expect(ahead(s, inp)).toBeGreaterThan(15);
  });

  it("keeps a called guide leading when the pilot flies away", () => {
    const s = createGuideState(), inp = input();
    press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
    inp.shipVel.x = -CRUISE;
    expect(run(s, inp, 30)).toEqual([]);
    expect(s.name).toBe("leading");
    expect(ahead(s, inp)).toBeGreaterThan(15);
  });
});

describe("leading", () => {
  const led = (over: Partial<GuideInput> = {}) => {
    const s = createGuideState(), inp = input(over);
    press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
    expect(s.name).toBe("leading");
    return { s, inp };
  };

  it("holds a station ~20 u ahead of the ship along the route to the target", () => {
    const { s, inp } = led({ target: v(600, 0, 600) });
    inp.shipVel.x = CRUISE * Math.SQRT1_2; inp.shipVel.z = CRUISE * Math.SQRT1_2;
    run(s, inp, 5);
    expect(dist(s.pos, inp.ship)).toBeCloseTo(GUIDE_LEAD_DIST, 1);
    // Ahead along ship -> target.
    const tx = inp.target!.x - inp.ship.x, tz = inp.target!.z - inp.ship.z, tl = Math.hypot(tx, tz);
    const ax = (s.pos.x - inp.ship.x) / GUIDE_LEAD_DIST, az = (s.pos.z - inp.ship.z) / GUIDE_LEAD_DIST;
    expect(ax * tx / tl + az * tz / tl).toBeGreaterThan(0.999);
    expect(len(s.vel)).toBeCloseTo(CRUISE, 0);
  });

  it("flying at the target, the station is exactly route x 20 (unchanged by the lean)", () => {
    const target = v(800, 120, -500);
    const r = v(target.x, target.y, target.z), rl = len(r);
    const { s, inp } = led({ target, shipNose: v(r.x / rl, r.y / rl, r.z / rl) });
    inp.shipVel.x = r.x / rl * CRUISE; inp.shipVel.y = r.y / rl * CRUISE; inp.shipVel.z = r.z / rl * CRUISE;
    run(s, inp, 1);
    run(s, inp, 5, (g) => {
      expect(g.pos.x - inp.ship.x).toBeCloseTo(r.x / rl * GUIDE_LEAD_DIST, 6);
      expect(g.pos.y - inp.ship.y).toBeCloseTo(r.y / rl * GUIDE_LEAD_DIST, 6);
      expect(g.pos.z - inp.ship.z).toBeCloseTo(r.z / rl * GUIDE_LEAD_DIST, 6);
    });
  });

  it("keeps the station at warp speed (speed matched, warp included)", () => {
    const warp = SHIP_WARP_SPEED * CRUISE_MAX_FACTOR;
    const { s, inp } = led({ target: v(1e6, 0, 0) });
    inp.shipVel.x = warp; inp.warping = true;
    let worst = 0;
    run(s, inp, 3, (g) => { worst = Math.max(worst, Math.abs(dist(g.pos, inp.ship) - GUIDE_LEAD_DIST)); });
    expect(worst).toBeLessThan(1);
    expect(len(s.vel)).toBeCloseTo(warp, 0);
    expect(s.streak).toBe(true);
  });

  it("holds its station, pointing the way, while the ship hovers", () => {
    const { s, inp } = led();
    run(s, inp, 5);
    expect(s.pos.x - inp.ship.x).toBeCloseTo(GUIDE_LEAD_DIST, 1);
    expect(len(s.vel)).toBeLessThan(0.01);
  });

  // Owner feedback 2026-10-23 (after #54): "I'm able to pass the jellyfish;
  // it's behind". Flown 135 degrees off the target, the old rule (slow down and
  // swim back to the ship at 6 u/s) let it fall from -2 to -47 u ahead of the
  // nose in 8 s. It never falls behind now.
  for (const deg of [90, 135]) {
    it(`flying ${deg} degrees off the target, it stays in front of the nose, leaning toward the target`, () => {
      const s = createGuideState(), inp = input();
      inp.shipVel = v(heading(deg).x * CRUISE, 0, heading(deg).z * CRUISE);
      press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
      expect(s.name).toBe("leading");
      let minAhead = Infinity, maxOff = 0, minLean = Infinity;
      run(s, inp, 10, (g) => {
        minAhead = Math.min(minAhead, ahead(g, inp));
        maxOff = Math.max(maxOff, offNose(g, inp));
        // Leaning toward the target: closer to the route than the nose is.
        const rl = dist(inp.target!, inp.ship);
        const toward = ((g.pos.x - inp.ship.x) * (inp.target!.x - inp.ship.x) + (g.pos.z - inp.ship.z) * (inp.target!.z - inp.ship.z)) / (rl * GUIDE_LEAD_DIST);
        const noseToward = (inp.shipNose.x * (inp.target!.x - inp.ship.x) + inp.shipNose.z * (inp.target!.z - inp.ship.z)) / rl;
        minLean = Math.min(minLean, toward - noseToward);
      });
      expect(minAhead).toBeGreaterThan(15);
      expect(maxOff).toBeLessThanOrEqual(GUIDE_LEAD_MAX_ANGLE / DEG + 0.5);
      expect(minLean).toBeGreaterThan(0);
      expect(s.name).toBe("leading");
    });
  }

  it("swings back in front of the nose within 2 s of a hard turn away", () => {
    const { s, inp } = led();
    inp.shipVel.x = CRUISE;
    run(s, inp, 2);
    inp.shipVel = v(heading(135).x * CRUISE, 0, heading(135).z * CRUISE);
    run(s, inp, 2);
    let minAhead = Infinity;
    run(s, inp, 8, (g) => { minAhead = Math.min(minAhead, ahead(g, inp)); });
    expect(minAhead).toBeGreaterThan(15);
    expect(offNose(s, inp)).toBeLessThanOrEqual(GUIDE_LEAD_MAX_ANGLE / DEG + 0.5);
  });

  it("flying straight away from the target (antiparallel), it stays in front, never NaN", () => {
    const { s, inp } = led();
    inp.shipVel.x = -CRUISE; // nose exactly -x, route exactly +x
    let minAhead = Infinity, finite = true;
    run(s, inp, 2);
    run(s, inp, 10, (g) => {
      minAhead = Math.min(minAhead, ahead(g, inp));
      finite &&= Number.isFinite(g.pos.x) && Number.isFinite(g.pos.y) && Number.isFinite(g.pos.z);
    });
    expect(finite).toBe(true);
    expect(minAhead).toBeGreaterThan(15);
    expect(offNose(s, inp)).toBeCloseTo(GUIDE_LEAD_MAX_ANGLE / DEG, 1);
  });

  it("antiparallel with a vertical nose (diving away from a target straight above), never NaN", () => {
    const { s, inp } = led({ target: v(0, 1000, 0) });
    inp.shipVel.y = -CRUISE;
    run(s, inp, 2);
    run(s, inp, 5);
    expect(Number.isFinite(s.pos.x + s.pos.y + s.pos.z)).toBe(true);
    expect(ahead(s, inp)).toBeGreaterThan(15);
  });

  it("keeps up off-axis at warp speed", () => {
    const warp = SHIP_WARP_SPEED * CRUISE_MAX_FACTOR;
    const { s, inp } = led({ target: v(1e5, 0, 0) });
    inp.shipVel = v(heading(135).x * warp, 0, heading(135).z * warp); inp.warping = true;
    // The turn swings the station ~34 u round the ship; at warp the catch-up
    // trails it along the velocity and closes it in ~1.1 s.
    run(s, inp, 2);
    let minAhead = Infinity, maxOff = 0;
    run(s, inp, 3, (g) => { minAhead = Math.min(minAhead, ahead(g, inp)); maxOff = Math.max(maxOff, offNose(g, inp)); });
    expect(minAhead).toBeGreaterThan(15);
    expect(maxOff).toBeLessThanOrEqual(GUIDE_LEAD_MAX_ANGLE / DEG + 0.5);
    expect(len(s.vel)).toBeCloseTo(warp, -1);
  });

  it("catches up after a jump: a 300 u jump, then the ship hovers", () => {
    const { s, inp } = led();
    run(s, inp, 1);
    // A number-key jump: the ship is suddenly 300 u off to the side, at rest.
    inp.ship.z += 300;
    run(s, inp, 5);
    // Back on its station: on the new route (17 degrees off the nose, within the lean).
    const r = dist(inp.target!, inp.ship);
    expect(dist(s.pos, inp.ship)).toBeCloseTo(GUIDE_LEAD_DIST, 0);
    expect(s.pos.x - inp.ship.x).toBeCloseTo((inp.target!.x - inp.ship.x) / r * GUIDE_LEAD_DIST, 0);
    expect(s.pos.z - inp.ship.z).toBeCloseTo((inp.target!.z - inp.ship.z) / r * GUIDE_LEAD_DIST, 0);
  });

  it("is never startled while guiding: the component skips moods on `guiding`", () => {
    const s = createGuideState(), inp = input();
    expect(s.guiding).toBe(false);
    press(s, inp);
    expect(s.guiding).toBe(true);
    run(s, inp, GUIDE_COME_SECONDS + 0.5);
    expect(s.guiding).toBe(true);
  });

  it("never ends a step inside a solid", () => {
    // A planet sits on the route: the station point sweeps through it.
    // The ship skims over it at y = 32 toward a target below its far side, so
    // the station ~20 u ahead dips through the planet.
    const planet: JellyKeepOut = { x: 200, y: 0, z: 0, r: 60, body: 30 };
    const { s, inp } = led({ ship: v(0, 32, 0), target: v(400, -100, 0), keepOut: [planet] });
    inp.shipVel.x = CRUISE;
    let worst = Infinity;
    run(s, inp, 40, (g) => { worst = Math.min(worst, dist(g.pos, planet) - planet.body); });
    expect(worst).toBeGreaterThanOrEqual(-1e-9);
    expect(worst).toBeLessThan(1); // it did reach the surface: the law was exercised
  });

  it("keeps clear of solids while it streaks in", () => {
    const planet: JellyKeepOut = { x: 0, y: 0, z: 150, r: 60, body: 40 };
    const s = createGuideState(), inp = input({ jelly: v(0, 0, 300), keepOut: [planet] });
    press(s, inp);
    let worst = Infinity;
    run(s, inp, GUIDE_COME_SECONDS + 0.1, (g) => { worst = Math.min(worst, dist(g.pos, planet) - planet.body); });
    expect(worst).toBeGreaterThanOrEqual(-1e-9);
    expect(worst).toBeLessThan(1);
    expect(s.name).toBe("leading");
  });

  it("follows a target that moves on (progress made elsewhere)", () => {
    const { s, inp } = led();
    inp.target = v(0, 0, -800);
    inp.shipNose = v(0, 0, -1); // the pilot turns to it
    run(s, inp, 3);
    expect(s.pos.z - inp.ship.z).toBeCloseTo(-GUIDE_LEAD_DIST, 0);
  });

  it("roams when everything is done (target goes null mid-lead)", () => {
    const { s, inp } = led();
    inp.target = null;
    expect(run(s, inp, DT)).toEqual(["allDone"]);
    expect(s.name).toBe("roaming");
  });
});

describe("arriving", () => {
  it("arrives when the ship enters the target's radius, circles it once, then roams", () => {
    const s = createGuideState(), inp = input({ target: v(200, 0, 0), targetRadius: 15 });
    press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
    inp.shipVel.x = CRUISE;
    let presented = 0;
    const count = (g: GuideState) => { if (g.name === "presenting") presented += DT; };
    const events = run(s, inp, (200 - 15) / CRUISE + 0.2, count);
    expect(events).toEqual(["arrived"]);
    expect(s.name).toBe("presenting");
    inp.shipVel.x = 0;
    const center = { ...inp.target! };
    // The next goal takes over the input while it presents; it still circles this one.
    inp.target = v(-5000, 0, 0);
    let swept = 0, last = Math.atan2(s.pos.z - center.z, s.pos.x - center.x);
    let maxR = 0;
    run(s, inp, GUIDE_PRESENT_SECONDS + 1, (g) => {
      count(g);
      if (g.name !== "presenting") return;
      const a = Math.atan2(g.pos.z - center.z, g.pos.x - center.x);
      let d = a - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      swept += d; last = a;
      maxR = Math.max(maxR, dist(g.pos, center));
    });
    expect(s.name).toBe("roaming");
    expect(presented).toBeGreaterThan(GUIDE_PRESENT_SECONDS - 0.1);
    expect(presented).toBeLessThan(GUIDE_PRESENT_SECONDS + 0.1);
    expect(maxR).toBeLessThan(40);
    // Once round (the eased follow trails the circle point by a fraction of a turn).
    expect(Math.abs(swept)).toBeGreaterThan(1.7 * Math.PI);
  });

  it("says all done after presenting the last step", () => {
    const s = createGuideState(), inp = input({ target: v(10, 0, 0), targetRadius: 15 });
    press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
    expect(s.name).toBe("presenting");
    inp.target = null;
    expect(run(s, inp, GUIDE_PRESENT_SECONDS + 0.5)).toEqual(["allDone"]);
    expect(s.name).toBe("roaming");
  });

  // The career station (arrival 8.5, STATION_RADII.zoneR) and the contact
  // portal (2.2, PORTAL_ZONE_R) are reached well inside the 20 u lead: it must
  // wait beside them, not park in the station's hull or the portal's mouth.
  it("present radius clears the docked ship's orbit at every destination", () => {
    const widest = Math.max(...DESTINATIONS.map((d) => d.orbitR));
    expect(GUIDE_PRESENT_MIN_R).toBeGreaterThanOrEqual(widest + SHIP_HALF_LENGTH + JELLY_RADIUS);
  });

  for (const radius of [PORTAL_ZONE_R, STATION_RADII.zoneR]) {
    for (const [label, from] of [["level", v(-300, 0, 0)], ["climbing", v(0, -300, 0)], ["oblique", v(200, -150, 120)]] as const) {
      it(`never comes inside the present radius of a ${radius} u target (${label} approach), even with the ship docked`, () => {
        const target = v(500, 200, -300);
        const ship = v(target.x + from.x, target.y + from.y, target.z + from.z);
        const s = createGuideState();
        const inp = input({ jelly: v(target.x + 600, target.y, target.z + 600), ship, target, targetRadius: radius });
        press(s, inp);
        let closest = Infinity, closestShip = Infinity, arrived = false, orbit = 0;
        for (let i = 0; i < 60 * 60; i++) {
          if (!arrived) {
            // Fly straight in at cruise and stop on the target (as a dock does).
            const d = dist(inp.ship, target);
            const k = d > CRUISE * DT ? CRUISE / d : 0;
            inp.shipVel.x = (target.x - inp.ship.x) * k; inp.shipVel.y = (target.y - inp.ship.y) * k; inp.shipVel.z = (target.z - inp.ship.z) * k;
            noseAlongVel(inp);
            if (k === 0) copyV(inp.ship, target);
          } else {
            // Docked: the ship orbits at the station's orbitR, 0.25 rad/s (Spaceship.tsx).
            orbit += 0.25 * DT;
            const nx = target.x + Math.sin(orbit) * STATION_RADII.orbitR, nz = target.z + Math.cos(orbit) * STATION_RADII.orbitR;
            inp.shipVel.x = (nx - inp.ship.x) / DT; inp.shipVel.y = 0; inp.shipVel.z = (nz - inp.ship.z) / DT;
            inp.ship.x = nx; inp.ship.y = target.y; inp.ship.z = nz;
          }
          if (!arrived) { inp.ship.x += inp.shipVel.x * DT; inp.ship.y += inp.shipVel.y * DT; inp.ship.z += inp.shipVel.z * DT; }
          stepGuide(s, inp, DT);
          inp.toggle = false;
          if (s.event === "arrived") arrived = true;
          if (s.name !== "roaming") closest = Math.min(closest, dist(s.pos, target));
          if (s.name === "presenting") closestShip = Math.min(closestShip, dist(s.pos, inp.ship));
          if (s.name === "roaming") break;
        }
        expect(arrived).toBe(true);
        expect(s.name).toBe("roaming"); // presented once round, then let go
        expect(closest).toBeGreaterThanOrEqual(GUIDE_PRESENT_MIN_R - 1e-6);
        expect(closestShip).toBeGreaterThan(JELLY_RADIUS + SHIP_HALF_LENGTH);
      });
    }
  }

  it("waits beside a near target, out of the ship's path, and presents from there", () => {
    const target = v(400, 0, 0);
    const s = createGuideState(), inp = input({ target, targetRadius: STATION_RADII.zoneR });
    press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
    inp.shipVel.x = CRUISE;
    // Fly to just outside the arrival radius, then hover there.
    run(s, inp, (400 - STATION_RADII.zoneR - 1) / CRUISE);
    inp.shipVel.x = 0;
    run(s, inp, 3);
    expect(s.name).toBe("leading");
    expect(dist(s.pos, target)).toBeCloseTo(GUIDE_PRESENT_MIN_R, 3);
    // Beside the approach line (+x), not on it: off to one side, level with the target.
    expect(Math.abs(s.pos.x - target.x)).toBeLessThan(0.5);
    expect(Math.abs(s.pos.y - target.y)).toBeLessThan(0.5);
    // Arriving starts the circle from where it waited (radius held, no jump).
    inp.shipVel.x = CRUISE;
    expect(run(s, inp, 0.2)).toEqual(["arrived"]);
    expect(Math.hypot(s.pos.x - target.x, s.pos.z - target.z)).toBeCloseTo(GUIDE_PRESENT_MIN_R, 1);
  });

  it("circles a planet target outside its body", () => {
    const planet: JellyKeepOut = { x: 300, y: 0, z: 0, r: 80, body: 45 };
    const s = createGuideState(), inp = input({ target: v(300, 0, 0), targetRadius: 70, keepOut: [planet] });
    press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
    inp.shipVel.x = CRUISE;
    let worst = Infinity;
    const events = run(s, inp, 40, (g) => { if (g.name === "presenting") worst = Math.min(worst, dist(g.pos, planet) - planet.body); });
    expect(events).toContain("arrived");
    expect(worst).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe("reduced motion", () => {
  it("appears beside the ship instead of swimming in, with no streak", () => {
    const s = createGuideState(), inp = input({ jelly: v(-3000, 0, 0), reducedMotion: true });
    press(s, inp);
    expect(s.name).toBe("coming");
    expect(dist(s.pos, inp.ship)).toBeLessThanOrEqual(25);
    expect(s.streak).toBe(false);
    expect(run(s, inp, DT)).toEqual(["met"]);
    expect(s.name).toBe("leading");
  });

  it("appears beside the ship on an offer too", () => {
    const s = createGuideState(), inp = input({ jelly: v(-3000, 0, 0), reducedMotion: true });
    expect(run(s, inp, GUIDE_LOST_SECONDS + 0.05)).toContain("offered");
    expect(dist(s.pos, inp.ship)).toBeLessThanOrEqual(25);
    expect(s.streak).toBe(false);
  });

  it("re-appears at its station after a jump rather than streaking back", () => {
    const s = createGuideState(), inp = input({ reducedMotion: true });
    press(s, inp); run(s, inp, 0.1);
    inp.ship.z += 300; // a number-key jump
    run(s, inp, DT);
    const r = dist(inp.target!, inp.ship);
    expect(s.pos.x - inp.ship.x).toBeCloseTo((inp.target!.x - inp.ship.x) / r * GUIDE_LEAD_DIST, 6);
    expect(s.pos.z - inp.ship.z).toBeCloseTo((inp.target!.z - inp.ship.z) / r * GUIDE_LEAD_DIST, 6);
    expect(s.streak).toBe(false);
  });

  it("stays in front of the nose through a hard turn, swimming (no snap) since the swing is under the snap distance", () => {
    const s = createGuideState(), inp = input({ reducedMotion: true });
    press(s, inp); run(s, inp, 0.1);
    inp.shipVel.x = CRUISE;
    run(s, inp, 1);
    inp.shipVel = v(heading(180).x * CRUISE, 0, heading(180).z * CRUISE);
    let worstStep = 0, last = { ...s.pos };
    run(s, inp, 3, (g) => { worstStep = Math.max(worstStep, dist(g.pos, last) - CRUISE * DT); last = { ...g.pos }; });
    // The swing is a ~39 u chord, under GUIDE_REDUCED_SNAP_DIST: it swims it
    // (~1 u a frame) rather than re-appearing.
    expect(GUIDE_REDUCED_SNAP_DIST).toBeGreaterThan(2 * GUIDE_LEAD_DIST * Math.sin((Math.PI - GUIDE_LEAD_MAX_ANGLE) / 2));
    expect(worstStep).toBeLessThan(5);
    expect(ahead(s, inp)).toBeGreaterThan(15);
    expect(s.streak).toBe(false);
  });
});

describe("roaming", () => {
  it("passes the component's own position through while roaming", () => {
    const s = createGuideState(), inp = input({ jelly: v(5, 6, 7) });
    run(s, inp, DT);
    expect(s.pos).toEqual(v(5, 6, 7));
  });

  it("hands back its last guided position on the step it returns to roaming", () => {
    const s = createGuideState(), inp = input();
    press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
    const at = { ...s.pos };
    expect(dist(at, inp.jelly)).toBeGreaterThan(50);
    press(s, inp);
    expect(s.name).toBe("roaming");
    expect(s.pos).toEqual(at);
  });

  it("writes into the same output objects every step (allocation-free contract)", () => {
    const s = createGuideState(), inp = input();
    const pos = s.pos, vel = s.vel;
    press(s, inp); run(s, inp, 5);
    expect(s.pos).toBe(pos);
    expect(s.vel).toBe(vel);
  });
});

describe("pushOutOfSolids (shared keep-out law)", () => {
  const k: JellyKeepOut = { x: 10, y: 0, z: 0, r: 30, body: 20 };
  it("moves a point inside a body onto its surface, away from the centre", () => {
    const p = v(5, 0, 0);
    expect(pushOutOfSolids(p, [k])).toBe(true);
    expect(p.x).toBeCloseTo(-10, 9);
    expect(dist(p, k)).toBeCloseTo(20, 9);
  });
  it("leaves a point outside every body untouched", () => {
    const p = v(-20, 0, 0);
    expect(pushOutOfSolids(p, [k])).toBe(false);
    expect(p).toEqual(v(-20, 0, 0));
  });
  it("pushes a point at the exact centre straight up", () => {
    const p = v(10, 0, 0);
    pushOutOfSolids(p, [k]);
    expect(p).toEqual(v(10, 20, 0));
  });
});
