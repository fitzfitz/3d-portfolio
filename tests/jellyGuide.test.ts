import { describe, it, expect } from "vitest";
import {
  createGuideState, stepGuide, type GuideInput, type GuideState, type GuideEvent,
  GUIDE_LOST_SECONDS, GUIDE_OFFER_COOLDOWN, GUIDE_COME_SECONDS, GUIDE_LEAD_DIST,
  GUIDE_WAIT_MAX_SPEED, GUIDE_OFFER_LEAVE_DIST, GUIDE_PRESENT_SECONDS,
} from "../src/utils/jellyGuide";
import { pushOutOfSolids, type JellyKeepOut } from "../src/utils/jellyMood";
import { SHIP_WARP_SPEED } from "../src/constants";
import { CRUISE_MAX_FACTOR } from "../src/utils/cruise";

type V = { x: number; y: number; z: number };
const v = (x = 0, y = 0, z = 0): V => ({ x, y, z });
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (a: V) => Math.hypot(a.x, a.y, a.z);
const DT = 1 / 60;
const CRUISE = 10.8;

/** One reusable input, as the frame loop will keep it (spec: frame loop allocates nothing). */
const input = (over: Partial<GuideInput> = {}): GuideInput => ({
  jelly: v(0, 0, 300), ship: v(), shipVel: v(), warping: false,
  target: v(1000, 0, 0), targetRadius: 15, progress: 0, blocked: false,
  reducedMotion: false, toggle: false, keepOut: [], ...over,
});

/**
 * Step for `seconds`, flying the ship by its velocity. Collects every event.
 * `toggle` is an edge: it is cleared after the first step.
 */
function run(s: GuideState, inp: GuideInput, seconds: number, each?: (s: GuideState) => void): GuideEvent[] {
  const events: GuideEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    inp.ship.x += inp.shipVel.x * DT; inp.ship.y += inp.shipVel.y * DT; inp.ship.z += inp.shipVel.z * DT;
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

  it("goes back to roaming when the pilot flies away from the offer while it comes", () => {
    const s = createGuideState(), inp = input({ jelly: v(0, 0, 400) });
    run(s, inp, GUIDE_LOST_SECONDS + 0.1);
    expect(s.name).toBe("coming");
    // Warp straight away from it.
    inp.shipVel.z = -SHIP_WARP_SPEED * CRUISE_MAX_FACTOR;
    expect(run(s, inp, GUIDE_COME_SECONDS)).toContain("declined");
    expect(s.name).toBe("roaming");
  });

  it("goes back to roaming when the pilot flies away from the offer while it leads", () => {
    const s = createGuideState(), inp = input();
    run(s, inp, GUIDE_LOST_SECONDS + 0.1 + GUIDE_COME_SECONDS + 0.5);
    expect(s.name).toBe("leading");
    inp.shipVel.x = -CRUISE; // away from the target at +x
    let gapAtDecline = 0;
    const events = run(s, inp, 30, (g) => { if (g.event === "declined") gapAtDecline = dist(g.pos, inp.ship); });
    expect(events).toEqual(["declined"]);
    expect(s.name).toBe("roaming");
    // "Flies away" = the gap grew GUIDE_OFFER_LEAVE_DIST past the closest (~20 u at station).
    expect(gapAtDecline).toBeGreaterThan(GUIDE_OFFER_LEAVE_DIST);
    expect(gapAtDecline).toBeLessThan(GUIDE_OFFER_LEAVE_DIST + GUIDE_LEAD_DIST + 1);
  });

  it("keeps a called guide waiting when the pilot flies away (only offers withdraw)", () => {
    const s = createGuideState(), inp = input();
    press(s, inp); run(s, inp, GUIDE_COME_SECONDS + 0.5);
    inp.shipVel.x = -CRUISE;
    expect(run(s, inp, 30)).toEqual([]);
    expect(s.name).toBe("leading");
    expect(s.waiting).toBe(true);
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
    expect(s.waiting).toBe(false);
    expect(dist(s.pos, inp.ship)).toBeCloseTo(GUIDE_LEAD_DIST, 1);
    // Ahead along ship -> target.
    const tx = inp.target!.x - inp.ship.x, tz = inp.target!.z - inp.ship.z, tl = Math.hypot(tx, tz);
    const ax = (s.pos.x - inp.ship.x) / GUIDE_LEAD_DIST, az = (s.pos.z - inp.ship.z) / GUIDE_LEAD_DIST;
    expect(ax * tx / tl + az * tz / tl).toBeGreaterThan(0.999);
    expect(len(s.vel)).toBeCloseTo(CRUISE, 0);
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
    expect(s.waiting).toBe(false);
    expect(s.pos.x - inp.ship.x).toBeCloseTo(GUIDE_LEAD_DIST, 1);
    expect(len(s.vel)).toBeLessThan(0.01);
  });

  it("waits when the ship turns away: slows, turns back toward the ship, then leads again", () => {
    const { s, inp } = led();
    inp.shipVel.x = CRUISE;
    run(s, inp, 3);
    inp.shipVel.x = -CRUISE; // turn away from the target (+x)
    run(s, inp, 0.1);
    expect(s.waiting).toBe(true);
    run(s, inp, 3);
    // Slow, and swimming back toward the ship.
    expect(len(s.vel)).toBeLessThanOrEqual(GUIDE_WAIT_MAX_SPEED + 1e-6);
    const toShip = v(inp.ship.x - s.pos.x, inp.ship.y - s.pos.y, inp.ship.z - s.pos.z);
    expect((s.vel.x * toShip.x + s.vel.y * toShip.y + s.vel.z * toShip.z) / (len(s.vel) * len(toShip))).toBeGreaterThan(0.9);
    // The pilot follows again: it retakes its station ahead.
    inp.shipVel.x = CRUISE;
    run(s, inp, 4);
    expect(s.waiting).toBe(false);
    expect(s.pos.x - inp.ship.x).toBeCloseTo(GUIDE_LEAD_DIST, 0);
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

  it("re-appears at its station rather than streaking back after waiting", () => {
    const s = createGuideState(), inp = input({ reducedMotion: true });
    press(s, inp); run(s, inp, 0.1);
    inp.shipVel.x = -SHIP_WARP_SPEED; // away; it waits behind
    run(s, inp, 3);
    expect(s.waiting).toBe(true);
    inp.shipVel.x = CRUISE;
    run(s, inp, 0.1);
    expect(s.pos.x - inp.ship.x).toBeCloseTo(GUIDE_LEAD_DIST, 0);
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
