import { describe, expect, it } from "vitest";
import {
  checkLap, checkPath, isInviteCode, newInviteCode, newRaceToken, parseRaceClient, parseRaceServer,
  rankResults, signStamp, verifyStamp, type RaceServerMessage, type ResultEntry, type Stamp,
} from "../src/utils/raceProtocol";
import { RING_RADIUS } from "../src/data/ringCourse";
import { GHOST_HZ, type Ghost } from "../src/utils/race";

const SECRET = "s".repeat(32);
const TOKEN = "a".repeat(32);
const RACE = "race-1";

// 11 centres evenly spaced on a circle: every consecutive pair, the last back to the first included, is 100 u apart.
const N = 11;
const R = 100 / (2 * Math.sin(Math.PI / N));
const CENTRES: [number, number, number][] = Array.from({ length: N }, (_, i) => {
  const a = (i / N) * Math.PI * 2;
  return [R * Math.cos(a), 0, R * Math.sin(a)];
});
const gate = (i: number) => CENTRES[i % N];

const stamp = (i: number, at: number) => signStamp(SECRET, { r: RACE, k: TOKEN, i, at });
async function lap(ids: number[], spacingMs = 3000, t0 = 1_000_000): Promise<Stamp[]> {
  return Promise.all(ids.map((i, n) => stamp(i, t0 + n * spacingMs)));
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe("parseRaceClient", () => {
  const ok = (m: unknown) => parseRaceClient(JSON.stringify(m));
  it("accepts each client type", () => {
    expect(ok({ t: "rjoin" })).toEqual({ t: "rjoin" });
    expect(ok({ t: "rjoin", code: "ABCDEF", token: TOKEN })).toEqual({ t: "rjoin", code: "ABCDEF", token: TOKEN });
    for (const t of ["rinvite", "rstart", "rsolo", "rleave", "ragain"]) expect(ok({ t })).toEqual({ t });
    expect(ok({ t: "rring", i: 3 })).toEqual({ t: "rring", i: 3 });
  });
  it("rejects a bad ring index", () => {
    expect(ok({ t: "rring", i: 1.5 })).toBeNull();
    expect(ok({ t: "rring", i: -1 })).toBeNull();
    expect(ok({ t: "rring" })).toBeNull();
  });
  it("rejects a bad code or token", () => {
    expect(ok({ t: "rjoin", code: "abcdef" })).toBeNull();
    expect(ok({ t: "rjoin", code: "ABC0EF" })).toBeNull();
    expect(ok({ t: "rjoin", token: "A".repeat(32) })).toBeNull();
    expect(ok({ t: "rjoin", token: "a".repeat(31) })).toBeNull();
  });
  it("rejects oversized and non-string input", () => {
    expect(parseRaceClient(JSON.stringify({ t: "rjoin", pad: "x".repeat(300) }))).toBeNull();
    expect(parseRaceClient({ t: "rleave" })).toBeNull();
    expect(parseRaceClient("not json")).toBeNull();
  });
  it("returns null for live-sky's me", () => {
    expect(ok({ t: "me", p: [0, 0, 0], q: [0, 0, 0, 1], plume: "x", ch: 0 })).toBeNull();
  });
});

describe("parseRaceServer", () => {
  const stampX: Stamp = { r: RACE, k: TOKEN, i: 2, at: 5, sig: "f".repeat(32) };
  const msgs: RaceServerMessage[] = [
    { t: "rlobby", race: RACE, kind: "public", code: null, host: false, token: TOKEN, pilots: [{ cc: "ID", you: true }, { cc: null, you: false }], startsAt: null, now: 1 },
    { t: "rlobby", race: RACE, kind: "private", code: "ABCDEF", host: true, token: TOKEN, pilots: [], startsAt: 99, now: 1 },
    { t: "rgrid", race: RACE, kind: "solo", slot: 0, goAt: 10, now: 1 },
    { t: "rgo", stamp: stampX, now: 1 },
    { t: "rstamp", stamp: stampX },
    { t: "rfinal", endsAt: 5, now: 1 },
    { t: "rover", race: RACE, uploadBy: 5, now: 1 },
    { t: "rresults", race: RACE, rows: [{ place: 1, cc: "ID", timeMs: 1000, rings: 11, you: true }, { place: 2, cc: null, timeMs: null, rings: 3, you: false }], againBy: 7, now: 1 },
    { t: "rwait", cc: "ID" },
    { t: "rwait", cc: null },
    { t: "rerr", reason: "full" },
  ];
  it("round-trips one of each type", () => {
    for (const m of msgs) expect(parseRaceServer(JSON.stringify(m))).toEqual(m);
  });
  it("rejects live-sky and malformed messages", () => {
    expect(parseRaceServer(JSON.stringify({ t: "snap", ships: [] }))).toBeNull();
    expect(parseRaceServer(JSON.stringify({ t: "rerr", reason: "nope" }))).toBeNull();
    expect(parseRaceServer(JSON.stringify({ t: "rstamp", stamp: { ...stampX, sig: "zz" } }))).toBeNull();
    expect(parseRaceServer(JSON.stringify({ t: "rfinal", endsAt: "x", now: 1 }))).toBeNull();
    expect(parseRaceServer("nope")).toBeNull();
    expect(parseRaceServer(5)).toBeNull();
  });
});

describe("stamp signing", () => {
  it("verifies a signed stamp and rejects any change", async () => {
    const s = await stamp(3, 12345);
    expect(s.sig).toMatch(/^[0-9a-f]{32}$/);
    expect(await verifyStamp(SECRET, s)).toBe(true);
    expect(await verifyStamp(SECRET, { ...s, r: "race-2" })).toBe(false);
    expect(await verifyStamp(SECRET, { ...s, k: "b".repeat(32) })).toBe(false);
    expect(await verifyStamp(SECRET, { ...s, i: 4 })).toBe(false);
    expect(await verifyStamp(SECRET, { ...s, at: 12346 })).toBe(false);
    expect(await verifyStamp(SECRET, { ...s, sig: "0".repeat(32) })).toBe(false);
    expect(await verifyStamp(SECRET, { ...s, sig: s.sig.slice(1) })).toBe(false);
    expect(await verifyStamp("t".repeat(32), s)).toBe(false);
  });
});

describe("checkLap", () => {
  it("accepts a full lap", async () => {
    const r = await checkLap(SECRET, RACE, TOKEN, await lap(range(0, 11)), CENTRES);
    expect(r).toEqual({ ok: true, rings: 11, timeMs: 33000, lastAt: 1_033_000 });
  });
  it("rejects a lap missing stamp 0", async () => {
    expect(await checkLap(SECRET, RACE, TOKEN, await lap(range(1, 11)), CENTRES)).toEqual({ ok: false, reason: "start" });
    expect(await checkLap(SECRET, RACE, TOKEN, [], CENTRES)).toEqual({ ok: false, reason: "start" });
  });
  it("rejects skipped or repeated rings", async () => {
    expect(await checkLap(SECRET, RACE, TOKEN, await lap([0, 1, 3]), CENTRES)).toEqual({ ok: false, reason: "order" });
    expect(await checkLap(SECRET, RACE, TOKEN, await lap([0, 1, 1]), CENTRES)).toEqual({ ok: false, reason: "order" });
    expect(await checkLap(SECRET, RACE, TOKEN, await lap(range(0, 12)), CENTRES)).toEqual({ ok: false, reason: "order" });
  });
  it("rejects a leg flown faster than warp", async () => {
    expect(await checkLap(SECRET, RACE, TOKEN, await lap([0, 1], 1000), CENTRES)).toEqual({ ok: false, reason: "speed" });
    expect(await checkLap(SECRET, RACE, TOKEN, await lap([0, 1], -1000), CENTRES)).toEqual({ ok: false, reason: "speed" });
  });
  it("rejects another race or token", async () => {
    const good = await lap(range(0, 3));
    const other = await signStamp(SECRET, { r: "race-2", k: TOKEN, i: 2, at: good[2].at });
    expect(await checkLap(SECRET, RACE, TOKEN, [good[0], good[1], other], CENTRES)).toEqual({ ok: false, reason: "race" });
    expect(await checkLap(SECRET, RACE, "b".repeat(32), good, CENTRES)).toEqual({ ok: false, reason: "race" });
  });
  it("rejects a forged signature", async () => {
    const good = await lap(range(0, 3));
    const bad = { ...good[2], sig: "0".repeat(32) };
    expect(await checkLap(SECRET, RACE, TOKEN, [good[0], good[1], bad], CENTRES)).toEqual({ ok: false, reason: "sig" });
  });
  it("scores a DNF by rings and last stamp time", async () => {
    const stamps = await lap(range(0, 4));
    expect(await checkLap(SECRET, RACE, TOKEN, stamps, CENTRES)).toEqual({ ok: true, rings: 4, timeMs: null, lastAt: stamps[4].at });
  });
});

describe("checkPath", () => {
  /** A ghost along the loop through the stamps, at 10 Hz, with the lap time given. */
  function ghostFor(stamps: readonly Stamp[], time = (stamps[stamps.length - 1].at - stamps[0].at) / 1000): Ghost {
    const t0 = stamps[0].at;
    const samples = [];
    for (let n = 0; n <= Math.round(time * GHOST_HZ); n++) {
      const t = n / GHOST_HZ;
      let k = 0;
      while (k < stamps.length - 2 && (stamps[k + 1].at - t0) / 1000 <= t) k++;
      const a = (stamps[k].at - t0) / 1000, b = (stamps[k + 1].at - t0) / 1000;
      const f = Math.min(1, Math.max(0, (t - a) / (b - a)));
      const ga = gate(stamps[k].i), gb = gate(stamps[k + 1].i);
      samples.push({ x: ga[0] + (gb[0] - ga[0]) * f, y: ga[1] + (gb[1] - ga[1]) * f, z: ga[2] + (gb[2] - ga[2]) * f, yaw: 0, pitch: 0 });
    }
    return { time, samples };
  }
  it("passes an honest ghost", async () => {
    const stamps = await lap(range(0, 11));
    expect(checkPath(ghostFor(stamps), stamps, CENTRES)).toBe(true);
  });
  it("fails a jump of 50 u in 0.1 s", async () => {
    const stamps = await lap(range(0, 11));
    const g = ghostFor(stamps);
    g.samples[100] = { ...g.samples[100], x: g.samples[100].x + 50 };
    expect(checkPath(g, stamps, CENTRES)).toBe(false);
  });
  it("fails a ghost whose time disagrees with the lap", async () => {
    const stamps = await lap(range(0, 11));
    const g = ghostFor(stamps);
    expect(checkPath({ ...g, time: g.time + 0.6 }, stamps, CENTRES)).toBe(false);
    expect(checkPath({ ...g, time: g.time + 0.4 }, stamps, CENTRES)).toBe(true);
  });
  it("fails a ghost that misses a ring", async () => {
    const stamps = await lap(range(0, 11));
    const g = ghostFor(stamps);
    // Ring 5 is stamped at 15 s (sample 150): a smooth bump there takes the ghost well off the ring without a step the step rule would catch.
    const off = RING_RADIUS + 15 + 5;
    for (let n = 140; n <= 160; n++) g.samples[n] = { ...g.samples[n], y: off * (1 - Math.abs(n - 150) / 10) };
    expect(checkPath(g, stamps, CENTRES)).toBe(false);
  });
  it("fails an unfinished lap", async () => {
    const stamps = await lap(range(0, 4));
    expect(checkPath(ghostFor(stamps), stamps, CENTRES)).toBe(false);
  });
});

describe("rankResults", () => {
  const e = (token: string, timeMs: number | null, rings: number, lastAt: number): ResultEntry => ({ token, cc: null, timeMs, rings, lastAt });
  it("puts finishers by time, then DNF by rings, ties by lastAt", () => {
    const out = rankResults([
      e("dnf-3-late", null, 3, 90), e("slow", 40000, 11, 5), e("dnf-7", null, 7, 50),
      e("fast", 30000, 11, 9), e("dnf-3-early", null, 3, 80), e("tie-b", 30000, 11, 20),
    ]);
    expect(out.map((x) => x.token)).toEqual(["fast", "tie-b", "slow", "dnf-7", "dnf-3-early", "dnf-3-late"]);
  });
  it("does not mutate its input", () => {
    const input = [e("b", 2, 11, 1), e("a", 1, 11, 1)];
    rankResults(input);
    expect(input[0].token).toBe("b");
  });
});

describe("codes and tokens", () => {
  it("makes 6-char invite codes from the allowed alphabet", () => {
    for (let n = 0; n < 50; n++) {
      const c = newInviteCode();
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      expect(isInviteCode(c)).toBe(true);
    }
    expect(isInviteCode("abcdef")).toBe(false);
    expect(isInviteCode("ABCDE")).toBe(false);
    expect(isInviteCode("ABCDEI")).toBe(false);
    expect(isInviteCode(123456)).toBe(false);
  });
  it("makes 32-hex race tokens", () => {
    expect(newRaceToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(newRaceToken()).not.toBe(newRaceToken());
  });
});
