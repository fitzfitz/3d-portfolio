import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  LAB_STATES, PRESET_DISTANCE, SPREAD_SPACING, labQuery, layoutPlacements, parseLabQuery, placementMatrix,
  saucerLabPose, tardigradeLabPose,
} from "../src/lab/labScene";
import { AU } from "../src/constants";
import type { SaucerPose } from "../src/utils/monsters/saucerMaterial";
import type { TardigradePose } from "../src/utils/monsters/tardigradeMaterial";

/**
 * The monster lab's pure scene (dev only; space monsters Task 6): its query,
 * layouts and timed poses. The lab itself runs in tests/e2e/monsterlab.probe.mjs.
 */
const saucer = (): SaucerPose => ({ phase: 0, look: new THREE.Vector3(), aim: new THREE.Vector3(), chase: -1, fire: 0, hit: 0, defeat: 0, blink: 0 });
const tardigrade = (): TardigradePose => ({ phase: 0, swim: 0, charge: 0, recoil: 0, hit: 0, curl: 0 });
const toCamera = new THREE.Vector3(0.6, 0.2, 1), toShip = new THREE.Vector3(-0.1, -0.3, 1);

describe("the lab's query", () => {
  it("defaults to a first look: near, fight, auto LOD, cycling the states", () => {
    expect(parseLabQuery("")).toEqual({ preset: "near", layout: "fight", state: "idle", lod: "auto", seed: 1, reducedMotion: false, cycle: true });
    expect(parseLabQuery("", true).reducedMotion).toBe(true);
  });
  it("takes every control from the query, holds a named state, and falls back on nonsense", () => {
    const s = parseLabQuery("?preset=far&layout=spread&state=curl&lod=0&seed=42&rm=1");
    expect(s).toEqual({ preset: "far", layout: "spread", state: "curl", lod: "0", seed: 42, reducedMotion: true, cycle: false });
    expect(parseLabQuery("?state=curl&cycle=1").cycle).toBe(true);
    expect(parseLabQuery("?preset=mars&layout=x&state=dance&lod=2&seed=abc")).toMatchObject({ preset: "near", layout: "fight", state: "idle", lod: "auto", seed: 1 });
    expect(parseLabQuery(`?${labQuery(s)}`)).toEqual(s);
  });
});

describe("the lab's layouts", () => {
  it("near is Earth's distance from the sun, far Neptune's", () => {
    expect(PRESET_DISTANCE.near / AU).toBeCloseTo(1, 4);
    expect(PRESET_DISTANCE.far / AU).toBeCloseTo(30.07, 2);
  });
  it("fight: six saucers and two tardigrades round the ship; overlap: two saucers, one dome behind the other", () => {
    const fight = layoutPlacements("fight");
    expect(fight.filter((p) => p.kind === "saucer")).toHaveLength(6);
    expect(fight.filter((p) => p.kind === "tardigrade")).toHaveLength(2);
    for (const p of fight) expect(p.position.length(), "clear of the ship").toBeGreaterThan(6);
    const overlap = layoutPlacements("overlap");
    expect(overlap.map((p) => p.kind)).toEqual(["saucer", "saucer"]);
    expect(overlap[0].position.distanceTo(overlap[1].position)).toBeLessThan(3.2); // closer than a saucer's width
  });
  it("spread: eight monsters, each 200 u from its neighbours, all the same distance from the sun", () => {
    const spread = layoutPlacements("spread");
    expect(spread).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(spread[i].position.distanceTo(spread[(i + 1) % 8].position)).toBeCloseTo(SPREAD_SPACING, 6);
      expect(spread[i].position.x, "square to the sunlight (+X)").toBe(0);
    }
  });
  it("each monster's +Z (gaze, barrel, mouth) faces its target, upright", () => {
    for (const layout of ["fight", "spread", "overlap"] as const) {
      for (const p of layoutPlacements(layout)) {
        const m = placementMatrix(p);
        const z = new THREE.Vector3(0, 0, 1).transformDirection(m);
        const want = p.facing.clone().sub(p.position).normalize();
        expect(z.dot(want), layout).toBeGreaterThan(0.999);
      }
    }
  });
});

describe("the lab's timed poses", () => {
  const TIMES = [0, 0.3, 1.1, 2.7, 4.9];
  it("move with time while motion is on, so every state is visibly alive", () => {
    const DENSE = Array.from({ length: 240 }, (_, k) => k * 0.025);
    const fire = DENSE.map((t) => saucerLabPose("fire", t, 0.3, false, toCamera, toShip, saucer()).fire);
    expect(Math.max(...fire) - Math.min(...fire)).toBeGreaterThan(0.9);
    const curl = DENSE.map((t) => tardigradeLabPose("curl", t, 0.3, false, tardigrade()).curl);
    expect(Math.max(...curl) - Math.min(...curl)).toBeGreaterThan(0.5);
    const chase = TIMES.map((t) => saucerLabPose("chase", t, 0.3, false, toCamera, toShip, saucer()).chase);
    expect(new Set(chase).size).toBeGreaterThan(3);
  });
  it("under reduced motion hold each state at full strength, unchanging, with no idle blink (R20)", () => {
    for (const state of LAB_STATES) {
      const s0 = saucerLabPose(state, TIMES[0], 0.3, true, toCamera, toShip, saucer());
      const t0 = tardigradeLabPose(state, TIMES[0], 0.3, true, tardigrade());
      for (const t of TIMES) {
        expect(saucerLabPose(state, t, 0.3, true, toCamera, toShip, saucer()), `${state} t=${t}`).toEqual(s0);
        expect(tardigradeLabPose(state, t, 0.3, true, tardigrade()), `${state} t=${t}`).toEqual(t0);
      }
      expect(s0.blink, state).toBe(0);
    }
    expect(saucerLabPose("fire", 1, 0.3, true, toCamera, toShip, saucer())).toMatchObject({ fire: 1 });
    expect(saucerLabPose("hit", 1, 0.3, true, toCamera, toShip, saucer())).toMatchObject({ hit: 1 });
    expect(saucerLabPose("defeat", 1, 0.3, true, toCamera, toShip, saucer())).toMatchObject({ defeat: 1 });
    expect(tardigradeLabPose("charge", 1, 0.3, true, tardigrade())).toMatchObject({ charge: 1 });
    expect(tardigradeLabPose("recoil", 1, 0.3, true, tardigrade())).toMatchObject({ recoil: 1 });
    expect(tardigradeLabPose("curl", 1, 0.3, true, tardigrade())).toMatchObject({ curl: 1 });
    expect(tardigradeLabPose("defeat", 1, 0.3, true, tardigrade())).toMatchObject({ curl: 1 });
  });
  it("look turns the gaze to the camera, fire aims the barrel at the ship; idle blinks now and then", () => {
    expect(saucerLabPose("look", 1, 0.3, false, toCamera, toShip, saucer()).look.toArray()).toEqual(toCamera.toArray());
    const fire = saucerLabPose("fire", 1, 0.3, false, toCamera, toShip, saucer());
    expect(fire.aim.toArray()).toEqual(toShip.toArray());
    const blinks = Array.from({ length: 400 }, (_, k) => saucerLabPose("idle", k * 0.025, 0.3, false, toCamera, toShip, saucer()).blink);
    expect(Math.max(...blinks)).toBeGreaterThan(0.9);
    expect(blinks.filter((b) => b > 0).length / blinks.length).toBeLessThan(0.1);
  });
});

describe("the lab stays out of the game", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
  it("nothing outside src/lab imports from it", () => {
    for (const f of files("src").filter((p) => !p.startsWith(join("src", "lab")))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+["'][^"']*\/lab\//);
    }
  });
  it("the build's only page is index.html (monster-lab.html is served in dev only)", () => {
    const vite = readFileSync("vite.config.ts", "utf8");
    expect(vite).not.toMatch(/monster-lab/);
    expect(vite).not.toMatch(/rollupOptions\s*:\s*\{[^}]*input/s);
  });
});
