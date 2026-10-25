import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  LAB_STATES, PRESET_DISTANCE, SPREAD_SPACING, heroKind, labQuery, layoutFraming, layoutPlacements, parseLabQuery, placementMatrix,
  saucerLabPose, tardigradeLabPose, createSubmittedSnapshot, snapshotSubmitted,
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
    expect(parseLabQuery("")).toEqual({ preset: "near", layout: "fight", state: "idle", lod: "auto", seed: 1, cam: "default", reducedMotion: false, cycle: true });
    expect(parseLabQuery("", true).reducedMotion).toBe(true);
  });
  it("takes every control from the query, holds a named state, and falls back on nonsense", () => {
    const s = parseLabQuery("?preset=far&layout=spread&state=curl&lod=0&seed=42&rm=1");
    expect(s).toEqual({ preset: "far", layout: "spread", state: "curl", lod: "0", seed: 42, cam: "default", reducedMotion: true, cycle: false });
    expect(parseLabQuery("?state=curl&cycle=1").cycle).toBe(true);
    expect(parseLabQuery("?preset=mars&layout=x&state=dance&lod=2&seed=abc")).toMatchObject({ preset: "near", layout: "fight", state: "idle", lod: "auto", seed: 1 });
    expect(parseLabQuery(`?${labQuery(s)}`)).toEqual(s);
  });
});

describe("the lab's hero cameras", () => {
  it("cam= takes hero-saucer / hero-tardigrade, falls back to default, and round-trips", () => {
    expect(parseLabQuery("?cam=hero-saucer").cam).toBe("hero-saucer");
    expect(parseLabQuery("?cam=hero-tardigrade").cam).toBe("hero-tardigrade");
    expect(parseLabQuery("?cam=nope").cam).toBe("default");
    const s = parseLabQuery("?cam=hero-saucer&state=fire");
    expect(parseLabQuery(`?${labQuery(s)}`)).toEqual(s);
  });
  it("a hero camera stands a few units from the first monster of its kind, in front of it, with the ship hidden", () => {
    for (const [cam, kind, max] of [["hero-saucer", "saucer", 6], ["hero-tardigrade", "tardigrade", 12]] as const) {
      const f = layoutFraming("fight", cam);
      const p = layoutPlacements("fight").find((q) => q.kind === kind)!;
      expect(heroKind(cam)).toBe(kind);
      expect(f.ship).toBe(false);
      expect(f.camera.distanceTo(p.position)).toBeLessThan(max);
      expect(f.camera.distanceTo(f.target)).toBeGreaterThan(1);
      const gaze = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(placementMatrix(p)));
      expect(f.camera.clone().sub(p.position).dot(gaze), "camera is on the monster's gaze side").toBeGreaterThan(0);
    }
    expect(layoutFraming("fight").ship).toBe(true);
    expect(heroKind("default")).toBeNull();
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

describe("the lab uses the LOD hysteresis", () => {
  it("MonsterLab keeps one LOD state per placement and hands it to both add functions", () => {
    const src = readFileSync("src/lab/MonsterLab.tsx", "utf8");
    expect(src).toMatch(/createLodState/);
    expect(src).toMatch(/addSaucer\([^)]*lodStates\[i\]\)/);
    expect(src).toMatch(/addTardigrade\([^)]*lodStates\[i\]\)/);
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

describe("the submitted snapshot", () => {
  const meshes = [{ mesh: { count: 3 }, triangles: 100 }, { mesh: { count: 0 }, triangles: 50 }, { mesh: { count: 2 }, triangles: 10 }];
  it("captures counts, calls and triangles together, in place", () => {
    const out = createSubmittedSnapshot(meshes.length);
    const r = snapshotSubmitted(meshes, out);
    expect(r).toBe(out);
    expect([...out.counts]).toEqual([3, 0, 2]);
    expect(out.calls).toBe(2);
    expect(out.triangles).toBe(320);
  });
  it("does not follow later count changes until the next snapshot", () => {
    const out = snapshotSubmitted(meshes, createSubmittedSnapshot(meshes.length));
    meshes[0].mesh.count = 0;
    expect(out.triangles).toBe(320);
    snapshotSubmitted(meshes, out);
    expect(out.triangles).toBe(20);
    expect(out.calls).toBe(1);
    meshes[0].mesh.count = 3;
  });
});
