import { describe, it, expect, afterEach, vi } from "vitest";
import * as THREE from "three";
import {
  liveSkyUrl, parseServerMessage, GhostBuffer, nearestGhosts, newSendState, shouldSend, markSent,
  shipQuat, ghostRegistry, ghostScanId, ghostReport, hudShowsRadio, RENDER_DELAY_MS, KEEPALIVE_MS, type GhostPose,
  liveRadar, writeRadarBlips,
} from "../src/utils/liveSky";
import { generateScanReport } from "../src/utils/scanReport";
import { VALIDATION_RADIUS } from "../src/constants";
const EDGE = 400;
import type { ShipState, SnapShip } from "../src/utils/liveSkyProtocol";

afterEach(() => { vi.unstubAllEnvs(); ghostRegistry.clear(); });

const ship = (id: string, x: number, o: Partial<SnapShip> = {}): SnapShip =>
  ({ id, p: [x, 0, 0], q: [0, 0, 0, 1], plume: "stock", cc: null, ago: 0, ...o });

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
    // A wild position is pulled onto the validation sphere, direction kept.
    const a = (m as { ships: { id: string; p: number[] }[] }).ships[0];
    expect(a.id).toBe("a");
    expect(Math.hypot(...a.p)).toBeCloseTo(VALIDATION_RADIUS, 6);
    expect(a.p[0]).toBeCloseTo(-a.p[2], 6);
    expect(a.p[1]).toBeCloseTo(0, 6);
    expect((m as { ships: unknown[] }).ships[1]).toEqual({ id: "b", p: [1, 2, 3], q: [0, 0, 0, 1], plume: "ring", cc: "ID", ago: 0 });
    expect((m as { ships: unknown[] }).ships).toHaveLength(2);
  });
  it("reads a row's ago, treating anything odd as 0 and capping it", () => {
    const m = parseServerMessage(j({ t: "snap", ships: [
      { id: "a", p: [0, 0, 0], q: [0, 0, 0, 1], ago: 120 },
      { id: "b", p: [0, 0, 0], q: [0, 0, 0, 1], ago: -5 },
      { id: "c", p: [0, 0, 0], q: [0, 0, 0, 1], ago: "soon" },
      { id: "d", p: [0, 0, 0], q: [0, 0, 0, 1], ago: 1e12 },
    ] }));
    expect(m?.t === "snap" && m.ships.map((s) => s.ago)).toEqual([120, 0, 0, 60_000]);
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
    expect(b.sample(125 + RENDER_DELAY_MS)[0].p[0]).toBeCloseTo(5);
    expect(b.sample(250 + RENDER_DELAY_MS)[0].p[0]).toBeCloseTo(10);
  });
  it("renders a steady pilot at a steady speed, though sends and snapshots alias", () => {
    // The pilot sends every 200 ms at 10 u/s; the room snapshots every 250 ms
    // with each pose's age. Stamped by arrival, the ghost would lurch.
    const b = new GhostBuffer();
    let snapAt = 0;
    for (let now = 0; now <= 3000; now += 50) {
      for (; snapAt <= now; snapAt += 250) {
        const sentAt = Math.floor(snapAt / 200) * 200;
        b.push([ship("a", sentAt / 100, { ago: snapAt - sentAt })], snapAt);
      }
      if (now >= 1000) expect(b.sample(now)[0].p[0]).toBeCloseTo((now - RENDER_DELAY_MS) / 100, 1);
    }
  });
  it("a ghost that sat still and starts moving does not jump", () => {
    const b = new GhostBuffer();
    b.push([ship("a", 0)], 0);
    b.push([ship("a", 0, { ago: 4000 })], 4000); // still: same pose, older stamp
    b.push([ship("a", 2)], 5000);                 // moved 2 u in the last send interval
    const at = (now: number) => b.sample(now)[0].p[0];
    expect(at(5000 - 300 + RENDER_DELAY_MS)).toBeCloseTo(0);
    expect(at(5000 - 100 + RENDER_DELAY_MS)).toBeGreaterThan(0.2);
    expect(at(5000 - 100 + RENDER_DELAY_MS)).toBeLessThan(1.8);
  });
  it("holds the last pose rather than extrapolating", () => {
    const b = new GhostBuffer();
    b.push([ship("a", 0)], 0);
    b.push([ship("a", 10)], 250);
    expect(b.sample(5000)[0].p[0]).toBeCloseTo(10);
  });
  it("blends in a straight line, with no seam", () => {
    const b = new GhostBuffer();
    b.push([ship("a", EDGE - 1)], 0);
    b.push([ship("a", -EDGE + 1)], 250);
    const x = b.sample(125 + RENDER_DELAY_MS)[0].p[0];
    expect(Math.abs(x)).toBeLessThan(1);
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
  it("reuses its pose objects and output array frame to frame", () => {
    const b = new GhostBuffer();
    b.push([ship("a", 0), ship("b", 5)], 0);
    const first = b.sample(1000);
    const [p0, p1] = first;
    const second = b.sample(1100);
    expect(second).toBe(first);
    expect(second[0]).toBe(p0);
    expect(second[1]).toBe(p1);
  });
  it("carries each ghost's scan id, built once", () => {
    const b = new GhostBuffer();
    b.push([ship("ab12", 0)], 0);
    expect(b.sample(1000)[0].scanId).toBe(ghostScanId("ab12"));
  });
  it("fades a new ghost in, instantly when fadeMs is 0", () => {
    const b = new GhostBuffer();
    b.push([ship("a", 0)], 1000);
    expect(b.sample(1250, 500)[0].alpha).toBeCloseTo(0.5);
    expect(b.sample(1250, 0)[0].alpha).toBe(1);
  });
});

describe("nearestGhosts", () => {
  const pose = (id: string, x: number): GhostPose => ({ id, p: [x, 0, 0], q: [0, 0, 0, 1], plume: "stock", cc: null, alpha: 1, scanId: ghostScanId(id), dist: 0 });
  it("sorts by plain distance and keeps n", () => {
    const at = { x: -EDGE + 5, y: 0, z: 0 };
    const list = [pose("mid", 0), pose("far", EDGE - 5), pose("near", -EDGE + 8)];
    const out = nearestGhosts(at, list, 2);
    expect(out.map((g) => g.id)).toEqual(["near", "mid"]);
    expect(out).toBe(list); // sorted and trimmed in place: no per-frame allocation
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
  it("keeps a still pilot alive every KEEPALIVE_MS while in company", () => {
    const s = newSendState();
    markSent(s, 0, ME);
    expect(shouldSend(s, 1, KEEPALIVE_MS - 1, ME)).toBe(false);
    expect(shouldSend(s, 1, KEEPALIVE_MS, ME)).toBe(true);
    expect(shouldSend(s, 0, KEEPALIVE_MS, ME)).toBe(false);
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
  it("writes into the array it is given", () => {
    const out: [number, number, number, number] = [0, 0, 0, 0];
    expect(shipQuat(0.4, 0.1, out)).toBe(out);
    expect(out).not.toEqual([0, 0, 0, 0]);
  });
  it("matches the ship's YXZ rotation (-pitch, heading, 0)", () => {
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 1.2, 0, "YXZ"));
    const got = shipQuat(1.2, 0.3);
    expect(got[0]).toBeCloseTo(want.x); expect(got[1]).toBeCloseTo(want.y);
    expect(got[2]).toBeCloseTo(want.z); expect(got[3]).toBeCloseTo(want.w);
  });
});

describe("radar blips", () => {
  it("lists every ghost with its plume colour, reusing entries", () => {
    const g = (id: string, x: number, plume: string): GhostPose =>
      ({ id, p: [x, 1, 2], q: [0, 0, 0, 1], plume, cc: null, alpha: 1, scanId: ghostScanId(id), dist: 0 });
    writeRadarBlips([g("a", 5, "ring"), g("b", -9, "stock")]);
    expect(liveRadar.count).toBe(2);
    const first = liveRadar.blips[0];
    expect(first).toMatchObject({ x: 5, y: 1, z: 2, hex: "#ff3df0" });
    expect(liveRadar.blips[1]).toMatchObject({ x: -9, hex: "#00d9ff" });
    writeRadarBlips([g("c", 7, "ore")]);
    expect(liveRadar.count).toBe(1);
    expect(liveRadar.blips[0]).toBe(first);
    expect(first).toMatchObject({ x: 7, hex: "#ff8a1f" });
    writeRadarBlips([]);
    expect(liveRadar.count).toBe(0);
  });
});

describe("hudShowsRadio", () => {
  it("is true only when the radio line is on screen", () => {
    expect(hudShowsRadio({ photoMode: false, showClassicCV: false })).toBe(true);
    expect(hudShowsRadio({ photoMode: true, showClassicCV: false })).toBe(false);
    expect(hudShowsRadio({ photoMode: false, showClassicCV: true })).toBe(false);
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
