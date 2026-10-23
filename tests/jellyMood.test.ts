import { describe, it, expect } from "vitest";
import {
  createJellyState, stepJelly, type JellyInput, type JellyState,
  JELLY_REST_DIST, JELLY_LEASH, JELLY_STARTLE_SECONDS, JELLY_STARTLE_RADIUS,
} from "../src/utils/jellyMood";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const input = (over: Partial<JellyInput> = {}): JellyInput => ({
  pathPos: v(), player: v(30, 0, 0), playerSpeed: 0, boosting: false, keepOut: [], dt: 0.1, ...over,
});
const run = (s: JellyState, inp: JellyInput, seconds: number) => {
  for (let t = 0; t < seconds; t += inp.dt) stepJelly(s, inp);
  return s;
};
const jellyAt = (s: JellyState, inp: JellyInput) =>
  v(inp.pathPos.x + s.offset.x, inp.pathPos.y + s.offset.y, inp.pathPos.z + s.offset.z);
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (o: { x: number; y: number; z: number }) => Math.hypot(o.x, o.y, o.z);

describe("stepJelly", () => {
  it("stays calm and on its path when the player is far away", () => {
    const s = stepJelly(createJellyState(), input({ player: v(100, 0, 0) }));
    expect(s.mood).toBe("calm");
    expect(s.offset).toEqual(v());
  });

  it("turns curious and settles at the rest distance when the player hovers close", () => {
    const inp = input();
    const s = run(createJellyState(), inp, 8);
    expect(s.mood).toBe("curious");
    expect(dist(jellyAt(s, inp), inp.player)).toBeCloseTo(JELLY_REST_DIST, 0);
  });

  it("settles at the rest distance even while its path keeps moving", () => {
    // The real path drifts ~4.6u/s; an offset eased against a moving point lags
    // ~5u behind, so the creature parked at ~23u instead of 18 (seen live).
    const s = createJellyState();
    let inp = input();
    for (let t = 0; t < 8; t += 0.1) {
      inp = input({ pathPos: v(0, t * 4.6, 0) });
      stepJelly(s, inp);
    }
    expect(s.mood).toBe("curious");
    expect(dist(jellyAt(s, inp), inp.player)).toBeCloseTo(JELLY_REST_DIST, 0);
  });

  it("does not drag the offset along when the path jumps (the J summon)", () => {
    const s = run(createJellyState(), input(), 3);
    stepJelly(s, input({ pathPos: v(0, 500, 0) }));
    expect(len(s.offset)).toBeLessThanOrEqual(JELLY_LEASH + 1e-9);
  });

  it("ignores a player flying past fast", () => {
    const s = run(createJellyState(), input({ playerSpeed: 8 }), 2);
    expect(s.mood).toBe("calm");
    expect(len(s.offset)).toBeLessThan(1e-6);
  });

  it("startles on a boost nearby and darts away", () => {
    const inp = input({ player: v(12, 0, 0), boosting: true });
    const s = run(createJellyState(), inp, 1);
    expect(s.mood).toBe("startled");
    // Flees JELLY_FLEE_DIST (30): well clear of the startle radius (20) in a second.
    expect(dist(jellyAt(s, inp), inp.player)).toBeGreaterThan(JELLY_STARTLE_RADIUS + 10);
  });

  it("lets a startle override curiosity", () => {
    const s = run(createJellyState(), input(), 3);
    expect(s.mood).toBe("curious");
    stepJelly(s, input({ boosting: true }));
    expect(s.mood).toBe("startled");
  });

  it("calms down after the startle and eases home", () => {
    const s = run(createJellyState(), input({ player: v(12, 0, 0), boosting: true }), 0.5);
    run(s, input({ player: v(200, 0, 0) }), JELLY_STARTLE_SECONDS + 0.5);
    expect(s.mood).toBe("calm");
    run(s, input({ player: v(200, 0, 0) }), 12);
    expect(len(s.offset)).toBeLessThan(0.5);
  });

  it("never strays beyond the leash, and gives up when towed past it", () => {
    const s = createJellyState();
    for (let x = 30; x <= 150; x += 0.5) {
      stepJelly(s, input({ player: v(x, 0, 0) }));
      expect(len(s.offset)).toBeLessThanOrEqual(JELLY_LEASH + 1e-9);
    }
    expect(s.mood).toBe("calm");
  });

  it("won't follow the player into a planet's keep-out", () => {
    // Player at +30, jelly at the origin: the resting point would be (22,0,0).
    const s = stepJelly(createJellyState(), input({ keepOut: [{ x: 22, y: 0, z: 0, r: 10, body: 5 }] }));
    expect(s.mood).toBe("calm");
  });

  it("never flees into a planet, even when the pilot boosts from the far side", () => {
    // Review finding: only the curious resting point was guarded; a startle
    // fled straight through a planet whose body sat on the far side.
    const planet = { x: 25, y: 0, z: 0, r: 30, body: 20 };
    const inp = input({ player: v(-20, 0, 0), boosting: true, keepOut: [planet] });
    const s = createJellyState();
    for (let t = 0; t < 1.5; t += inp.dt) {
      stepJelly(s, inp);
      expect(dist(jellyAt(s, inp), planet)).toBeGreaterThanOrEqual(planet.body - 1e-6);
    }
  });

  it("survives a huge dt after a frozen frame", () => {
    const s = stepJelly(createJellyState(), input({ dt: 5 }));
    expect([s.offset.x, s.offset.y, s.offset.z].every(Number.isFinite)).toBe(true);
    expect(len(s.offset)).toBeLessThanOrEqual(JELLY_LEASH);
  });

  it("handles the player sitting exactly on the jellyfish", () => {
    const s = stepJelly(createJellyState(), input({ player: v() }));
    expect([s.offset.x, s.offset.y, s.offset.z].every(Number.isFinite)).toBe(true);
  });

  it("keeps its swim surge and bob while curious", () => {
    // Base path fixed; the swim adds a 2u vertical bob on top, period ~2.1s.
    const s = createJellyState();
    const base = v(0, 0, 0);
    const ys: number[] = [];
    for (let t = 0; t < 10; t += 0.05) {
      const inp = input({ pathPos: v(0, Math.sin(t * 3) * 2, 0), basePos: base, dt: 0.05 });
      stepJelly(s, inp);
      if (t > 8) ys.push(jellyAt(s, inp).y);
    }
    expect(s.mood).toBe("curious");
    // Frozen (old behaviour) gives a range near 0; a living bob gives ~4.
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(3);
  });
});
