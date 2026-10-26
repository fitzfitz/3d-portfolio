import { describe, it, expect, vi } from "vitest";
import {
  ringsVisible, targetGate, racingView, raceHoldAt, gridPose, ringToClaim, lapMsFromRun, ghostForUpload, fetchBestLap,
  CLAIM_RETRY_MS, type RingClaim,
  RACE_START_SCAN_ID, RACE_START_LABEL,
} from "../src/utils/raceScene";
import { RACE_IDLE, RUN_TTL_MS, type RaceView, type RaceRun } from "../src/utils/raceSession";
import { RACE_GATES, RING_RADIUS, SEED_SPEED, START_GATE } from "../src/data/ringCourse";
import { gridSlot, seedLap, encodeGhost, decodeGhost, type Ghost } from "../src/utils/race";
import type { Stamp } from "../src/utils/raceProtocol";

const N = RACE_GATES.length;
const T = 1_000_000;
const TOKEN = "0123456789abcdef0123456789abcdef";
const SIG = "fedcba9876543210fedcba9876543210";
const stamp = (i: number, at: number, r = "race-1"): Stamp => ({ r, k: TOKEN, i, at, sig: SIG });

const lobby: RaceView = { phase: "lobby", race: "race-1", kind: "public", code: null, host: false, pilots: [], startsAt: null };
const grid: RaceView = { phase: "grid", race: "race-1", kind: "public", slot: 3, goAt: T + 3000 };
const running = (over: Partial<Extract<RaceView, { phase: "running" }>> = {}): RaceView =>
  ({ phase: "running", race: "race-1", kind: "public", next: 1, goAt: T, finalEndsAt: null, finished: false, ...over });
const over: RaceView = { phase: "over", race: "race-1", uploadBy: T + 30_000, finished: true };
const results: RaceView = { phase: "results", race: "race-1", rows: [], againBy: T + 20_000 };

describe("ringsVisible", () => {
  it("shows the course only while running and at the over", () => {
    expect(ringsVisible(RACE_IDLE)).toBe(false);
    expect(ringsVisible(lobby)).toBe(false);
    expect(ringsVisible(grid)).toBe(false);
    expect(ringsVisible(running())).toBe(true);
    expect(ringsVisible(running({ finished: true, next: N + 1 }))).toBe(true);
    expect(ringsVisible(over)).toBe(true);
    expect(ringsVisible(results)).toBe(false);
  });
});

describe("targetGate", () => {
  it("is next % N while running and not finished, else null", () => {
    expect(targetGate(RACE_IDLE)).toBeNull();
    expect(targetGate(lobby)).toBeNull();
    expect(targetGate(grid)).toBeNull();
    expect(targetGate(running())).toBe(1);
    expect(targetGate(running({ next: N - 1 }))).toBe(N - 1);
    expect(targetGate(running({ next: N }))).toBe(0);
    expect(targetGate(running({ next: N + 1, finished: true }))).toBeNull();
    expect(targetGate(over)).toBeNull();
    expect(targetGate(results)).toBeNull();
  });
});

describe("racing and the grid hold", () => {
  it("racingView: grid and running only", () => {
    expect([RACE_IDLE, lobby, grid, running(), running({ finished: true }), over, results].map(racingView))
      .toEqual([false, false, true, true, true, false, false]);
  });

  it("holds on the grid until goAt (local), then releases even before rgo arrives", () => {
    expect(raceHoldAt(grid, T)).toBe(true);
    expect(raceHoldAt(grid, T + 2999)).toBe(true);
    expect(raceHoldAt(grid, T + 3000)).toBe(false);
    expect(raceHoldAt(running({ goAt: T + 3000 }), T + 2000)).toBe(true);
    expect(raceHoldAt(running(), T)).toBe(false);
    expect(raceHoldAt(lobby, T)).toBe(false);
    expect(raceHoldAt(over, 0)).toBe(false);
  });

  it("gridPose: the grid slot behind the start gate, keyed by race and slot", () => {
    const g = gridPose(grid)!;
    const want = gridSlot(START_GATE, 3);
    expect(g.key).toBe("race-1:3");
    expect(g.p).toEqual(want.p);
    expect(g.heading).toBe(want.heading);
    expect(g.pitch).toBe(want.pitch);
    expect(gridPose(running())).toBeNull();
    expect(gridPose(RACE_IDLE)).toBeNull();
  });
});

describe("ringToClaim", () => {
  const g1 = RACE_GATES[1];
  const before = { x: g1.c.x - g1.n.x, y: g1.c.y - g1.n.y, z: g1.c.z - g1.n.z };
  const after = { x: g1.c.x + g1.n.x, y: g1.c.y + g1.n.y, z: g1.c.z + g1.n.z };

  const claim = (next: number, at: number, race = "race-1"): RingClaim => ({ race, next, at });

  it("claims next on a crossing of the target ring", () => {
    expect(ringToClaim(running(), before, after, null, T)).toBe(1);
  });

  it("refuses a re-claim of the same ring inside CLAIM_RETRY_MS", () => {
    expect(CLAIM_RETRY_MS).toBe(2000);
    expect(ringToClaim(running(), before, after, claim(1, T), T)).toBeNull();
    expect(ringToClaim(running(), before, after, claim(1, T), T + CLAIM_RETRY_MS - 1)).toBeNull();
  });

  it("allows a re-claim after CLAIM_RETRY_MS with no stamp (a refused or lost claim)", () => {
    expect(ringToClaim(running(), before, after, claim(1, T), T + CLAIM_RETRY_MS)).toBe(1);
    // Another race's or another ring's claim never blocks this one.
    expect(ringToClaim(running(), before, after, claim(1, T, "race-0"), T)).toBe(1);
  });

  it("never re-claims a ring once next has moved past it", () => {
    // Stamped: next is 2, so crossing ring 1 again claims nothing, however late.
    expect(ringToClaim(running({ next: 2 }), before, after, claim(1, T), T + 60_000)).toBeNull();
    expect(ringToClaim(running({ next: 2 }), before, after, null, T + 60_000)).toBeNull();
  });

  it("only the target ring counts; the finish claims ring N through gate 0", () => {
    expect(ringToClaim(running({ next: 2 }), before, after, null, T)).toBeNull();
    const g0 = START_GATE;
    const a = { x: g0.c.x - g0.n.x, y: g0.c.y - g0.n.y, z: g0.c.z - g0.n.z };
    const b = { x: g0.c.x + g0.n.x, y: g0.c.y + g0.n.y, z: g0.c.z + g0.n.z };
    expect(ringToClaim(running({ next: N }), a, b, null, T)).toBe(N);
    // GO's pass through the start gate is not a claim: ring 1 is the target.
    expect(ringToClaim(running(), a, b, null, T)).toBeNull();
  });

  it("claims nothing off a running view, after the finish, or on a miss", () => {
    expect(ringToClaim(grid, before, after, null, T)).toBeNull();
    expect(ringToClaim(over, before, after, null, T)).toBeNull();
    expect(ringToClaim(running({ next: N + 1, finished: true }), before, after, null, T)).toBeNull();
    // Sideways (n × up, flat) by more than the ring's radius.
    const flat = Math.hypot(g1.n.x, g1.n.z);
    const off = RING_RADIUS + 1;
    const miss = (p: typeof before) => ({ x: p.x - (g1.n.z / flat) * off, y: p.y, z: p.z + (g1.n.x / flat) * off });
    expect(ringToClaim(running(), miss(before), miss(after), null, T)).toBeNull();
  });
});

describe("the ghost upload", () => {
  const run = (stamps: Stamp[]): RaceRun => ({ v: 1, race: "race-1", token: TOKEN, stamps, expiresAt: T + RUN_TTL_MS });
  const full = Array.from({ length: N + 1 }, (_, i) => stamp(i, T + i * 4000));

  it("lapMsFromRun: the finish stamp's time less GO's, or null without both", () => {
    expect(lapMsFromRun(run(full))).toBe(N * 4000);
    expect(lapMsFromRun(run(full.slice(0, N)))).toBeNull();
    expect(lapMsFromRun(run(full.slice(1)))).toBeNull();
    expect(lapMsFromRun(null)).toBeNull();
  });

  const rec: Ghost = { time: 0, samples: [{ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, { x: 1, y: 0, z: 0, yaw: 0, pitch: 0 }] };

  it("sends the encoded path, timed by the stamps, only on a finish that beats the best known", () => {
    const sent = ghostForUpload(true, 40_000, 45_000, rec);
    expect(sent).not.toBeNull();
    expect(decodeGhost(sent)).toEqual({ time: 40, samples: rec.samples });
    expect(ghostForUpload(true, 45_000, 45_000, rec)).toBeNull();
    expect(ghostForUpload(true, 50_000, 45_000, rec)).toBeNull();
    expect(ghostForUpload(false, 40_000, 45_000, rec)).toBeNull();
    expect(ghostForUpload(true, null, 45_000, rec)).toBeNull();
    expect(ghostForUpload(true, 40_000, 45_000, null)).toBeNull();
    expect(ghostForUpload(true, 40_000, 45_000, { time: 0, samples: [] })).toBeNull();
  });
});

describe("fetchBestLap", () => {
  const seed = seedLap(RACE_GATES, SEED_SPEED);
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("takes the stored best lap", async () => {
    const ghost: Ghost = { time: 41.2, samples: [{ x: 1, y: 2, z: 3, yaw: 0.5, pitch: 0.1 }, { x: 2, y: 2, z: 3, yaw: 0.5, pitch: 0.1 }] };
    const f = reply(200, { course: "loop-2", timeMs: 41_200, ghost: encodeGhost(ghost), cc: "ID", at: T });
    const best = await fetchBestLap("https://api.example", f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith("https://api.example/race/best");
    expect(best).toEqual({ timeMs: 41_200, ghost });
  });

  it("falls back to the seed lap with no row, a bad body, an error status, no network or no API", async () => {
    const want = { timeMs: seed.time * 1000, ghost: seed };
    expect(await fetchBestLap("https://api.example", reply(200, { course: "loop-2", timeMs: null }) as unknown as typeof fetch)).toEqual(want);
    expect(await fetchBestLap("https://api.example", reply(200, { timeMs: 40_000, ghost: "nope" }) as unknown as typeof fetch)).toEqual(want);
    expect(await fetchBestLap("https://api.example", reply(503, { error: "x" }) as unknown as typeof fetch)).toEqual(want);
    const down = vi.fn(async () => { throw new TypeError("offline"); });
    expect(await fetchBestLap("https://api.example", down as unknown as typeof fetch)).toEqual(want);
    const none = vi.fn();
    expect(await fetchBestLap("", none as unknown as typeof fetch)).toEqual(want);
    expect(none).not.toHaveBeenCalled();
  });
});

it("the start gate's scannable is race_start, RACE START GATE", () => {
  expect(RACE_START_SCAN_ID).toBe("race_start");
  expect(RACE_START_LABEL).toBe("RACE START GATE");
});
