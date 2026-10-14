import { describe, it, expect, afterEach, vi } from "vitest";
import * as THREE from "three";
import {
  liveSkyUrl, parseServerMessage, GhostBuffer, nearestGhosts, newSendState, shouldSend, markSent,
  shipQuat, ghostRegistry, ghostScanId, ghostReport, RENDER_DELAY_MS, type GhostPose,
} from "../src/utils/liveSky";
import { generateScanReport } from "../src/utils/scanReport";
import { COSMIC_BOUNDS } from "../src/constants";
import type { ShipState, SnapShip } from "../src/utils/liveSkyProtocol";

afterEach(() => { vi.unstubAllEnvs(); ghostRegistry.clear(); });

const ship = (id: string, x: number, o: Partial<SnapShip> = {}): SnapShip =>
  ({ id, p: [x, 0, 0], q: [0, 0, 0, 1], plume: "stock", cc: null, ...o });

describe("liveSkyUrl", () => {
  it("reads VITE_LIVE_SKY without a trailing slash", () => {
    vi.stubEnv("VITE_LIVE_SKY", "wss://sky.example/live/");
    expect(liveSkyUrl()).toBe("wss://sky.example/live");
  });
  it("is empty (feature off) when unset", () => {
    vi.stubEnv("VITE_LIVE_SKY", "");
    expect(liveSkyUrl()).toBe("");
  });
});

describe("parseServerMessage", () => {
  const j = (o: unknown) => JSON.stringify(o);
  it("parses every message type", () => {
    expect(parseServerMessage(j({ t: "hello", id: "a", peers: 2 }))).toEqual({ t: "hello", id: "a", peers: 2 });
    expect(parseServerMessage(j({ t: "peers", n: 0 }))).toEqual({ t: "peers", n: 0 });
    expect(parseServerMessage(j({ t: "sync" }))).toEqual({ t: "sync" });
    expect(parseServerMessage(j({ t: "full" }))).toEqual({ t: "full" });
  });
  it.each([["junk"], [j({ t: "hello", peers: 1 })], [j({ t: "peers", n: -1 })], [j({ t: "peers", n: 1.5 })], [j({ t: "nope" })], [j(null)]])(
    "rejects %s", (raw) => expect(parseServerMessage(raw)).toBeNull());
  it("treats snapshot rows as untrusted", () => {
    const m = parseServerMessage(j({ t: "snap", ships: [
      { id: "a", p: [9999, 0, -9999], q: [0, 0, 0, 1], plume: "rainbow", cc: "XX" },
      { id: "b", p: [1, 2, 3], q: [0, 0, 0, 1], plume: "ring", cc: "ID" },
      { id: "c", p: [1, 2], q: [0, 0, 0, 1] },
      { id: "d", p: [1, 2, 3], q: [0, 0, 0, 0] },
      "garbage",
    ] }));
    expect(m).toEqual({ t: "snap", ships: [
      { id: "a", p: [COSMIC_BOUNDS, 0, -COSMIC_BOUNDS], q: [0, 0, 0, 1], plume: "stock", cc: null },
      { id: "b", p: [1, 2, 3], q: [0, 0, 0, 1], plume: "ring", cc: "ID" },
    ] });
  });
  it("caps a snapshot at 40 ships", () => {
    const ships = Array.from({ length: 50 }, (_, i) => ship(`s${i}`, i));
    const m = parseServerMessage(j({ t: "snap", ships }));
    expect(m?.t === "snap" && m.ships.length).toBe(40);
  });
});

describe("GhostBuffer", () => {
  it("renders RENDER_DELAY_MS in the past, blending between snapshots", () => {
    const b = new GhostBuffer();
    b.push([ship("a", 0)], 0);
    b.push([ship("a", 10)], 250);
    expect(b.sample(250 + 125)[0].p[0]).toBeCloseTo(5);
    expect(b.sample(250 + RENDER_DELAY_MS)[0].p[0]).toBeCloseTo(10);
  });
  it("holds the last pose rather than extrapolating", () => {
    const b = new GhostBuffer();
    b.push([ship("a", 0)], 0);
    b.push([ship("a", 10)], 250);
    expect(b.sample(5000)[0].p[0]).toBeCloseTo(10);
  });
  it("blends across the wrap seam the short way", () => {
    const b = new GhostBuffer();
    b.push([ship("a", COSMIC_BOUNDS - 1)], 0);
    b.push([ship("a", -COSMIC_BOUNDS + 1)], 250);
    const x = b.sample(125 + RENDER_DELAY_MS)[0].p[0];
    expect(Math.abs(x)).toBeGreaterThan(COSMIC_BOUNDS - 1.01);
  });
  it("blends rotation along the short arc", () => {
    const yaw90: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const b = new GhostBuffer();
    b.push([ship("a", 0)], 0);
    b.push([ship("a", 0, { q: yaw90 })], 250);
    const q = b.sample(125 + RENDER_DELAY_MS)[0].q;
    expect(2 * Math.acos(q[3])).toBeCloseTo(Math.PI / 4, 3);
  });
  it("drops a ghost missing from a newer snapshot", () => {
    const b = new GhostBuffer();
    b.push([ship("a", 0), ship("b", 1)], 0);
    b.push([ship("b", 1)], 250);
    expect(b.sample(600).map((g) => g.id)).toEqual(["b"]);
  });
  it("fades a new ghost in, instantly when fadeMs is 0", () => {
    const b = new GhostBuffer();
    b.push([ship("a", 0)], 1000);
    expect(b.sample(1250, 500)[0].alpha).toBeCloseTo(0.5);
    expect(b.sample(1250, 0)[0].alpha).toBe(1);
  });
});

describe("nearestGhosts", () => {
  const pose = (id: string, x: number): GhostPose => ({ id, p: [x, 0, 0], q: [0, 0, 0, 1], plume: "stock", cc: null, alpha: 1 });
  it("sorts by toroidal distance and keeps n", () => {
    const at = { x: -COSMIC_BOUNDS + 5, y: 0, z: 0 };
    const out = nearestGhosts(at, [pose("mid", 0), pose("acrossSeam", COSMIC_BOUNDS - 5), pose("near", -COSMIC_BOUNDS + 8)], 2);
    expect(out.map((g) => g.id)).toEqual(["near", "acrossSeam"]);
  });
});

describe("shouldSend", () => {
  const ME: ShipState = { p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock" };
  it("never sends while alone", () => {
    expect(shouldSend(newSendState(), 0, 1000, ME)).toBe(false);
  });
  it("sends the first pose once someone else is here, then waits for change", () => {
    const s = newSendState();
    expect(shouldSend(s, 1, 1000, ME)).toBe(true);
    markSent(s, 1000, ME);
    expect(shouldSend(s, 1, 1500, ME)).toBe(false);
  });
  it("spaces sends at least 200 ms apart", () => {
    const s = newSendState();
    markSent(s, 1000, ME);
    expect(shouldSend(s, 1, 1150, { ...ME, p: [5, 2, 3] })).toBe(false);
    expect(shouldSend(s, 1, 1200, { ...ME, p: [5, 2, 3] })).toBe(true);
  });
  it("ignores sub-threshold drift but sends a real move or turn", () => {
    const s = newSendState();
    markSent(s, 0, ME);
    expect(shouldSend(s, 1, 500, { ...ME, p: [1.03, 2, 3] })).toBe(false);
    expect(shouldSend(s, 1, 500, { ...ME, p: [1.1, 2, 3] })).toBe(true);
    const turn2deg: ShipState = { ...ME, q: [0, Math.sin(Math.PI / 180), 0, Math.cos(Math.PI / 180)] };
    expect(shouldSend(s, 1, 500, turn2deg)).toBe(true);
  });
  it("a plume change while still is sent", () => {
    const s = newSendState();
    markSent(s, 0, ME);
    expect(shouldSend(s, 1, 500, { ...ME, plume: "ring" })).toBe(true);
  });
  it("sends after a sync even when still", () => {
    const s = newSendState();
    markSent(s, 0, ME);
    s.syncPending = true;
    expect(shouldSend(s, 1, 500, ME)).toBe(true);
    markSent(s, 500, ME);
    expect(s.syncPending).toBe(false);
  });
});

describe("shipQuat", () => {
  it("matches the ship's YXZ rotation (-pitch, heading, 0)", () => {
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 1.2, 0, "YXZ"));
    const got = shipQuat(1.2, 0.3);
    expect(got[0]).toBeCloseTo(want.x); expect(got[1]).toBeCloseTo(want.y);
    expect(got[2]).toBeCloseTo(want.z); expect(got[3]).toBeCloseTo(want.w);
  });
});

describe("ghost scan reports", () => {
  it("name the country, or just the pilot", () => {
    expect(ghostReport("ID")).toBe("PILOT FROM ID · LIVE");
    expect(ghostReport(null)).toBe("PILOT · LIVE");
  });
  it("generateScanReport answers for a registered ghost", () => {
    ghostRegistry.set(ghostScanId("ab12cd34"), "SG");
    expect(generateScanReport("ghost_ab12cd34")).toBe("PILOT FROM SG · LIVE");
  });
});
