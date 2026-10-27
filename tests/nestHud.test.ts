import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FLASH_S, NEST_HAZE_MAX, NEST_OFFLINE_LINE, flashOpacity, hullBarColor, hullLabel, hullShown, markNestLoadFailed,
  nestBanner, nestHazeOpacity, nestRadarShown, nestRadarSpot, waveReadout, type NestBannerText,
} from "../src/utils/combat/nestHud";
import { monsterFrameNeeded, monstersOnShow } from "../src/utils/combat/renderPose";
import { createNest, createNestEvents, stepNest, contactCount, type NestInput } from "../src/utils/combat/nest";
import { HULL_MAX, NEST_HAZE_BAND, NEST_ZONE_R } from "../src/utils/combat/constants";
import type { NestSink } from "../src/utils/combat/types";
import { RADAR_RANGE, worldToRadar } from "../src/utils/radarTransform";
import SafeErrorBoundary from "../src/components/canvas/SafeErrorBoundary";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the Nest HUD's pure parts", () => {
  it("the haze peaks at the zone edge and is gone 30 u either side", () => {
    expect(nestHazeOpacity(70)).toBeCloseTo(0.35); expect(nestHazeOpacity(40)).toBe(0); expect(nestHazeOpacity(100)).toBe(0);
    expect(nestHazeOpacity(55)).toBeGreaterThan(0); expect(nestHazeOpacity(55)).toBeLessThan(0.35);
    // The pinned constants, and a symmetric curve about the edge.
    expect(NEST_HAZE_MAX).toBe(0.35);
    expect(nestHazeOpacity(NEST_ZONE_R + 15)).toBeCloseTo(nestHazeOpacity(NEST_ZONE_R - 15));
    expect(nestHazeOpacity(NEST_ZONE_R + NEST_HAZE_BAND + 200)).toBe(0);
    expect(nestHazeOpacity(0)).toBe(0);
  });

  it("the hit flash fades, or holds a static tint under reduced motion", () => {
    expect(flashOpacity(1, 1, false)).toBeCloseTo(0.55); expect(flashOpacity(1.2, 1, false)).toBeLessThan(0.55);
    expect(flashOpacity(1.2, 1, true)).toBe(0.3); expect(flashOpacity(1.4, 1, true)).toBe(0);
    // Gone past FLASH_S either way, and nothing before any hit.
    expect(FLASH_S).toBe(0.35);
    expect(flashOpacity(1.4, 1, false)).toBe(0);
    expect(flashOpacity(5, -Infinity, false)).toBe(0);
    expect(flashOpacity(5, -Infinity, true)).toBe(0);
    // Static: the same tint all through the window (no fade under reduced motion).
    expect(flashOpacity(1.01, 1, true)).toBe(flashOpacity(1.3, 1, true));
  });

  it("banners: the countdown, waiting on warm-up, cleared and breach", () => {
    const c = { enteredAt: 10, clearedAt: -Infinity, breachAt: -Infinity };
    expect(nestBanner(10.1, c, "countdown", 0.1, false)).toEqual({ title: "ENTERING THE NEST", sub: "CONTACT IN 3…" });
    expect(nestBanner(13.5, c, "countdown", 3.5, false)).toEqual({ title: "ENTERING THE NEST", sub: "CONTACT IN …" });
    expect(nestBanner(20, { ...c, clearedAt: 19 }, "rest", 1, true)?.title).toBe("NEST CLEARED");
    expect(nestBanner(20, { ...c, clearedAt: 19, breachAt: 19.5 }, "ready", 0, true)?.title).toBe("HULL BREACH");
    expect(nestBanner(40, c, "ready", 0, true)).toBeNull();
  });

  it("banners count down 3… 2… 1…, show ENTERING alone for 2 s, and expire breach and cleared after 3 s", () => {
    const c = { enteredAt: 10, clearedAt: -Infinity, breachAt: -Infinity };
    expect(nestBanner(11.2, c, "countdown", 1.2, false)?.sub).toBe("CONTACT IN 2…");
    expect(nestBanner(12.5, c, "countdown", 2.5, true)?.sub).toBe("CONTACT IN 1…");
    // Warm and past 3 s, but the step has not started the wave yet: still waiting.
    expect(nestBanner(13.01, c, "countdown", 3.01, true)?.sub).toBe("CONTACT IN …");
    // Entered again during a fight (the Nest busy): the title alone, 2 s.
    expect(nestBanner(11, c, "fighting", 1, true)).toEqual({ title: "ENTERING THE NEST", sub: "" });
    expect(nestBanner(12.1, c, "fighting", 2.1, true)).toBeNull();
    expect(nestBanner(22.1, { ...c, clearedAt: 19 }, "rest", 3.1, true)).toBeNull();
    expect(nestBanner(22.4, { ...c, breachAt: 19.5 }, "ready", 3, true)?.title).toBe("HULL BREACH");
    expect(nestBanner(22.6, { ...c, breachAt: 19.5 }, "ready", 3, true)).toBeNull();
    expect(nestBanner(20, { ...c, breachAt: 19.5 }, "ready", 0, true)).toEqual({ title: "HULL BREACH", sub: "" });
    expect(nestBanner(20, { ...c, clearedAt: 19 }, "rest", 1, true)).toEqual({ title: "NEST CLEARED", sub: "" });
  });

  it("banners write into a caller's object, so the overlay's loop allocates nothing", () => {
    const out: NestBannerText = { title: "", sub: "" };
    const c = { enteredAt: 10, clearedAt: -Infinity, breachAt: -Infinity };
    expect(nestBanner(10.1, c, "countdown", 0.1, false, out)).toBe(out);
    expect(out.sub).toBe("CONTACT IN 3…");
    // The same strings every frame (precomputed, not rebuilt).
    const a = nestBanner(10.2, c, "countdown", 0.2, false, out)!.sub;
    const b = nestBanner(10.3, c, "countdown", 0.3, false, out)!.sub;
    expect(a).toBe(b);
  });

  it("the hull shows in the fighting area or while damaged", () => {
    expect(hullShown(true, 100)).toBe(true); expect(hullShown(false, 99)).toBe(true); expect(hullShown(false, 100)).toBe(false);
    expect(hullLabel(93.6)).toBe("HULL: 94%"); expect(waveReadout(2, 4)).toBe("WAVE 2/3 · CONTACTS 4"); expect(waveReadout(0, 0)).toBe("");
    expect(hullLabel(HULL_MAX)).toBe("HULL: 100%");
    expect(hullLabel(0)).toBe("HULL: 0%");
    expect(waveReadout(3, 1)).toBe("WAVE 3/3 · CONTACTS 1");
  });

  it("the hull bar turns red below 30%", () => {
    expect(hullBarColor(29.9)).toBe("#ef4444");
    expect(hullBarColor(30)).toBe("#00ff87");
    expect(hullBarColor(100)).toBe("#00ff87");
  });
});

describe("the radar's Nest marker", () => {
  it("is in range within RADAR_RANGE of the centre (3D)", () => {
    expect(nestRadarShown(0, 0, 0)).toBe(true);
    expect(nestRadarShown(RADAR_RANGE, 0, 0)).toBe(true);
    expect(nestRadarShown(RADAR_RANGE + 1, 0, 0)).toBe(false);
    // In 3D: far below the plane is out of range even straight under the ship.
    expect(nestRadarShown(0, -(RADAR_RANGE + 1), 0)).toBe(false);
    expect(nestRadarShown(150, -150, 0)).toBe(true);
  });
});

describe("the radar's rim marker", () => {
  it("draws the Nest unclamped in range, and on the rim along its horizontal direction beyond", () => {
    const out = { px: 0, py: 0, onRim: false }; const scale = 68 / RADAR_RANGE, rimR = 68;
    nestRadarSpot(100, 0, 0, 0, scale, rimR, out); // in range: unclamped
    expect(out.onRim).toBe(false); expect(Math.hypot(out.px, out.py)).toBeCloseTo(100 * scale, 9);
    nestRadarSpot(-510, -209, -80, 0.3, scale, rimR, out); // beyond: on the rim, the horizontal direction kept
    expect(out.onRim).toBe(true); expect(Math.hypot(out.px, out.py)).toBeCloseTo(rimR - 3, 9);
    const w = worldToRadar(-510, -80, 0.3); expect(Math.atan2(out.py, out.px)).toBeCloseTo(Math.atan2(-w.up, w.x), 9);
    nestRadarSpot(100, -300, 0, 0, scale, rimR, out); // beyond in 3D, inside horizontally: still on the rim
    expect(Math.hypot(out.px, out.py)).toBeCloseTo(rimR - 3, 9);
    nestRadarSpot(0, -300, 0, 0, scale, rimR, out); // straight below: the centre, no NaN
    expect([out.px, out.py, out.onRim]).toEqual([0, 0, true]);
    expect(nestRadarSpot(1, 2, 3, 0, scale, rimR, out)).toBe(out);
  });
});

describe("C22: the on-demand models fail to load", () => {
  it("the countdown banner says the Nest is offline, never an endless CONTACT IN", () => {
    expect(NEST_OFFLINE_LINE).toBe("NEST OFFLINE · MODELS DIDN'T LOAD");
    const c = { enteredAt: 10, clearedAt: -Infinity, breachAt: -Infinity, loadFailed: true };
    expect(nestBanner(10.1, c, "countdown", 0.1, false)).toEqual({ title: "ENTERING THE NEST", sub: NEST_OFFLINE_LINE });
    expect(nestBanner(60, c, "countdown", 50, false)).toEqual({ title: "ENTERING THE NEST", sub: NEST_OFFLINE_LINE });
    // Outside a crossing it shows nothing.
    expect(nestBanner(60, c, "ready", 0, false)).toBeNull();
  });

  it("markNestLoadFailed latches the flag and keeps the warm gate shut", () => {
    const c = { warm: true, loadFailed: false };
    markNestLoadFailed(c);
    expect(c).toEqual({ warm: false, loadFailed: true });
  });

  it("the error boundary's catch reaches its onError (NestGate's path to the flag)", () => {
    const c = { warm: false, loadFailed: false };
    const b = new SafeErrorBoundary({ children: null, onError: () => markNestLoadFailed(c) });
    const warn = console.warn;
    console.warn = () => {};
    try { b.componentDidCatch(new Error("404 saucer.glb"), { componentStack: "" }); } finally { console.warn = warn; }
    expect(c.loadFailed).toBe(true);
  });

  it("NestGate wires its boundary to the combat flag and clears it on each new attempt", () => {
    const gate = src("src/components/canvas/nest/NestGate.tsx");
    expect(gate).toMatch(/<SafeErrorBoundary onError=\{onLoadError\}>/);
    expect(gate).toMatch(/const onLoadError = \(\) => markNestLoadFailed\(combat\)/);
    expect(gate).toMatch(/combat\.loadFailed = false;\s*setNear\(true\)/);
    // A successful warm-up clears it too (NestMonsters).
    expect(src("src/components/canvas/nest/NestMonsters.tsx")).toMatch(/combat\.warm = true; combat\.loadFailed = false;/);
  });

  it("a Nest that never warms stays harmless: no wave, no contact, no hull loss", () => {
    const n = createNest();
    const ev = createNestEvents();
    const sink: NestSink = { muzzle: (_s, o) => o, mouth: (_t, o) => o };
    const inp: NestInput = {
      ship: { x: 100, y: 0, z: 0 }, shipVel: { x: 0, y: 0, z: 0 }, nose: { x: -1, y: 0, z: 0 },
      centre: { x: 0, y: 0, z: 0 }, racing: false, paused: false, lowPerf: false, warm: false, fireHeld: false, click: null,
    };
    stepNest(n, inp, 1 / 60, Math.random, sink, ev);
    inp.ship.x = 40; // an inward crossing
    for (let i = 0; i < 60 * 60; i++) stepNest(n, inp, 1 / 60, Math.random, sink, ev);
    expect(n.phase).toBe("countdown");
    expect(n.wave).toBe(0);
    expect(contactCount(n)).toBe(0);
    expect(n.hull.hp).toBe(HULL_MAX);
  });
});

describe("C21: the monster renderer idles once the Nest is empty", () => {
  it("runs the instance frame while a monster is on show, and once more to clear them, then skips", () => {
    expect(monsterFrameNeeded(true, false)).toBe(true);
    expect(monsterFrameNeeded(true, true)).toBe(true);
    expect(monsterFrameNeeded(false, true)).toBe(true); // the frame that empties the meshes
    expect(monsterFrameNeeded(false, false)).toBe(false);
  });

  it("a monster is on show unless gone or scaled to nothing", () => {
    const n = createNest();
    expect(monstersOnShow(n)).toBe(false);
    n.saucers[2].phase = "idle"; n.saucers[2].scale = 1;
    expect(monstersOnShow(n)).toBe(true);
    n.saucers[2].scale = 0;
    expect(monstersOnShow(n)).toBe(false);
    n.tardigrades[0].phase = "leaving"; n.tardigrades[0].scale = 0.4;
    expect(monstersOnShow(n)).toBe(true);
    n.tardigrades[0].phase = "gone";
    expect(monstersOnShow(n)).toBe(false);
  });

  it("NestMonsters skips beginMonsterFrame/endMonsterFrame on that decision", () => {
    const m = src("src/components/canvas/nest/NestMonsters.tsx");
    expect(m).toMatch(/const show = monstersOnShow\(n\);\s*const run = monsterFrameNeeded\(show, S\.shownLast\);\s*S\.shownLast = show;\s*if \(!run\) return;/);
    expect(m.indexOf("if (!run) return;")).toBeLessThan(m.indexOf("beginMonsterFrame(all)"));
  });
});

describe("C20: the director's track reset runs before any frame", () => {
  it("resets track.has in a layout effect, first, before the dev-only effect", () => {
    const d = src("src/components/canvas/NestDirector.tsx");
    expect(d).toMatch(/useLayoutEffect\(\(\) => \{ track\.has = false; \}, \[\]\);/);
    expect(d).not.toMatch(/useEffect\(\(\) => \{ track\.has = false;/);
    expect(d.indexOf("track.has = false")).toBeLessThan(d.indexOf("import.meta.env.DEV"));
  });
});
