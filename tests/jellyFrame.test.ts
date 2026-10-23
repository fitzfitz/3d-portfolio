import { describe, it, expect } from "vitest";
import {
  createJellyFrame, stepJellyFrame, beginReturn, streakLength, type JellyFrame, type JellyFrameInput,
  RETURN_MIN_S, RETURN_MAX_S, RETURN_SPEED, STREAK_FULL_SPEED,
} from "../src/utils/jellyFrame";
import { GUIDE_COME_SECONDS, GUIDE_STREAK_SPEED } from "../src/utils/jellyGuide";
import { JELLY_LEASH, JELLY_STARTLE_RADIUS } from "../src/utils/jellyMood";

type V = { x: number; y: number; z: number };
const v = (x = 0, y = 0, z = 0): V => ({ x, y, z });
const copy = (o: V, a: V) => { o.x = a.x; o.y = a.y; o.z = a.z; };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const DT = 1 / 60;

/** One reusable input, as the frame loop keeps it. The loop point is still unless a test moves it. */
const input = (over: Partial<JellyFrameInput> = {}): JellyFrameInput => ({
  pathPos: v(0, 80, 0), basePos: v(0, 80, 0),
  ship: v(0, 80, 200), shipVel: v(), warping: false,
  target: v(2000, 80, 200), targetRadius: 45, progress: 0, blocked: true,
  reducedMotion: false, toggle: false, keepOut: [], ...over,
});

function step(f: JellyFrame, inp: JellyFrameInput, n = 1, each?: () => void) {
  for (let i = 0; i < n; i++) {
    inp.ship.x += inp.shipVel.x * DT; inp.ship.y += inp.shipVel.y * DT; inp.ship.z += inp.shipVel.z * DT;
    stepJellyFrame(f, inp, DT);
    inp.toggle = false;
    each?.();
  }
}

/** Call it and let it reach the ship and start leading. */
function callAndMeet(f: JellyFrame, inp: JellyFrameInput) {
  inp.toggle = true;
  step(f, inp, Math.ceil((GUIDE_COME_SECONDS + 0.2) / DT));
  expect(f.guide.name).toBe("leading");
}

describe("stepJellyFrame: moods only while roaming (spec \"Leading\": boosting does not startle it)", () => {
  it("boosting point-blank at it while it leads never startles it, and the guide alone places it", () => {
    const f = createJellyFrame(), inp = input();
    callAndMeet(f, inp);
    inp.shipVel = v(300, 0, 0); inp.warping = true;
    step(f, inp, 120, () => {
      // Park the ship right on the creature, boosting, with its loop point right
      // there too: the mood step would startle it on the spot if it ran.
      copy(inp.pathPos, f.pos); copy(inp.basePos, f.pos);
      inp.ship.x = f.pos.x - 1; inp.ship.y = f.pos.y; inp.ship.z = f.pos.z;
      expect(f.mood.mood).not.toBe("startled");
      expect(f.pos).toEqual(f.guide.pos);
    });
    expect(f.guide.guiding).toBe(true);
  });
  it("the same boost startles it while it roams (the gate, not the setup, is what holds it)", () => {
    const f = createJellyFrame(), inp = input({ ship: v(0, 80, 10), warping: true });
    step(f, inp, 1);
    expect(dist(inp.ship, f.pos)).toBeLessThan(JELLY_STARTLE_RADIUS);
    expect(f.mood.mood).toBe("startled");
  });
  it("a call while startled calms it (the guide starts clean)", () => {
    const f = createJellyFrame(), inp = input({ ship: v(0, 80, 10), warping: true });
    step(f, inp, 1);
    inp.warping = false; inp.toggle = true;
    step(f, inp, 1);
    expect(f.mood.mood).toBe("calm");
  });
  it("roaming, it sits at the loop point plus the mood offset", () => {
    const f = createJellyFrame(), inp = input();
    step(f, inp, 10);
    expect(f.pos.x).toBeCloseTo(inp.pathPos.x + f.mood.offset.x, 9);
    expect(f.pos.y).toBeCloseTo(inp.pathPos.y + f.mood.offset.y, 9);
    expect(f.pos.z).toBeCloseTo(inp.pathPos.z + f.mood.offset.z, 9);
  });
  it("reduced motion: no moods, as before", () => {
    const f = createJellyFrame(), inp = input({ ship: v(0, 80, 10), warping: true, reducedMotion: true });
    step(f, inp, 5);
    expect(f.mood.mood).toBe("calm");
  });
  it("a call starts the swim-in from where it is (no jump on the call step)", () => {
    const f = createJellyFrame(), inp = input();
    step(f, inp, 5);
    const before = { ...f.pos };
    inp.toggle = true;
    step(f, inp, 1);
    expect(f.guide.name).toBe("coming");
    expect(dist(before, f.pos)).toBeLessThan(5);
  });
  it("keeps one pos object (the frame loop allocates nothing)", () => {
    const f = createJellyFrame(), inp = input(), pos = f.pos, guide = f.guide;
    callAndMeet(f, inp);
    inp.toggle = true; step(f, inp, 1);
    beginReturn(f, inp.pathPos, false);
    step(f, inp, 30);
    expect(f.pos).toBe(pos);
    expect(f.guide).toBe(guide);
  });
});

describe("the hand-back: back to the loop with no teleport", () => {
  /** Lead it far from the loop, then dismiss it there. Returns the hand-back position. */
  function leadAwayAndDismiss(f: JellyFrame, inp: JellyFrameInput, seconds: number): V {
    callAndMeet(f, inp);
    inp.shipVel = v(100, 0, 0);
    step(f, inp, Math.round(seconds / DT));
    inp.shipVel = v();
    inp.toggle = true;
    step(f, inp, 1);
    expect(f.handBack).toBe(true);
    expect(f.guide.name).toBe("roaming");
    return { ...f.pos };
  }

  it("flags the hand-back step and holds the last guided position on it", () => {
    const f = createJellyFrame(), inp = input();
    callAndMeet(f, inp);
    const last = { ...f.pos };
    inp.toggle = true;
    step(f, inp, 1);
    expect(f.handBack).toBe(true);
    expect(dist(f.pos, last)).toBeLessThan(1);
  });
  it("swims back from far away: continuous, past the mood leash, and home in at most RETURN_MAX_S", () => {
    const f = createJellyFrame(), inp = input();
    const left = leadAwayAndDismiss(f, inp, 5); // ~500 u out
    // The component re-phases the loop to the point nearest the creature; here the loop point stays put.
    beginReturn(f, inp.pathPos, false);
    expect(f.returning).toBe(true);
    expect(f.pos).toEqual(left);
    const gap = dist(left, inp.pathPos);
    expect(gap).toBeGreaterThan(JELLY_LEASH * 4);
    let prev = { ...f.pos }, maxStep = 0;
    step(f, inp, 1);
    // The leash (80 u) and PATH_JUMP must not snap it: one frame later it is still out there.
    expect(dist(f.pos, inp.pathPos)).toBeGreaterThan(gap - 5);
    const frames = Math.ceil(RETURN_MAX_S / DT) + 2;
    for (let i = 0; i < frames && f.returning; i++) {
      prev = { ...f.pos };
      step(f, inp, 1);
      maxStep = Math.max(maxStep, dist(prev, f.pos));
    }
    expect(f.returning).toBe(false);
    expect(dist(f.pos, inp.pathPos)).toBeLessThan(1e-6);
    // Smoothstep peaks at 1.5x the mean speed; nothing like a jump.
    expect(maxStep).toBeLessThan((1.5 * gap / Math.max(RETURN_MIN_S, Math.min(RETURN_MAX_S, gap / RETURN_SPEED))) * DT * 1.05);
  });
  it("a short way home takes at least RETURN_MIN_S (it swims, it does not snap)", () => {
    const f = createJellyFrame(), inp = input({ target: v(0, 80, 400), ship: v(0, 80, 60) });
    callAndMeet(f, inp);
    inp.toggle = true; step(f, inp, 1);
    const near = { x: inp.pathPos.x + 6, y: inp.pathPos.y, z: inp.pathPos.z };
    f.pos.x = near.x; f.pos.y = near.y; f.pos.z = near.z;
    beginReturn(f, inp.pathPos, false);
    step(f, inp, Math.floor(RETURN_MIN_S / DT) - 2);
    expect(f.returning).toBe(true);
    step(f, inp, 4);
    expect(f.returning).toBe(false);
  });
  it("no moods while it swims home (no startle mid-return); they resume once home", () => {
    const f = createJellyFrame(), inp = input();
    leadAwayAndDismiss(f, inp, 3);
    beginReturn(f, inp.pathPos, false);
    inp.warping = true;
    step(f, inp, 30, () => {
      // Boosting beside its loop point, where the mood step looks for the ship.
      inp.ship.x = inp.pathPos.x; inp.ship.y = inp.pathPos.y; inp.ship.z = inp.pathPos.z + 2;
      expect(f.mood.mood).toBe("calm");
    });
    step(f, inp, Math.ceil(RETURN_MAX_S / DT));
    expect(f.returning).toBe(false);
    inp.ship.x = f.pos.x; inp.ship.y = f.pos.y; inp.ship.z = f.pos.z + 2;
    step(f, inp, 1);
    expect(f.mood.mood).toBe("startled");
  });
  it("reduced motion: it re-appears on its loop (no streak home)", () => {
    const f = createJellyFrame(), inp = input({ reducedMotion: true });
    leadAwayAndDismiss(f, inp, 3);
    beginReturn(f, inp.pathPos, true);
    expect(f.returning).toBe(false);
    expect(f.pos).toEqual(inp.pathPos);
    step(f, inp, 1);
    expect(f.pos).toEqual(inp.pathPos);
  });
  it("a call mid-return cancels it and the guide starts from where the creature is", () => {
    const f = createJellyFrame(), inp = input();
    leadAwayAndDismiss(f, inp, 3);
    beginReturn(f, inp.pathPos, false);
    step(f, inp, 60);
    const mid = { ...f.pos };
    inp.toggle = true;
    step(f, inp, 1);
    expect(f.returning).toBe(false);
    expect(f.guide.name).toBe("coming");
    expect(dist(f.pos, mid)).toBeLessThan(5);
  });
});

describe("streakLength (the glow streak: the tentacles stretch with speed)", () => {
  it("is 0 when the streak is off and under reduced motion", () => {
    expect(streakLength(false, 500, false)).toBe(0);
    expect(streakLength(true, 500, true)).toBe(0);
  });
  it("is 0 at a swim, grows with speed, and is full by STREAK_FULL_SPEED", () => {
    expect(streakLength(true, GUIDE_STREAK_SPEED * 0.4, false)).toBe(0);
    const a = streakLength(true, 40, false), b = streakLength(true, 90, false);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(streakLength(true, STREAK_FULL_SPEED, false)).toBe(1);
    expect(streakLength(true, 5000, false)).toBe(1);
  });
});
