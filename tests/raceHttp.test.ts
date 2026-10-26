import { describe, expect, it, vi } from "vitest";
import {
  bestCandidate, handleRaceHttp, raceSecret, uploadReply, withBestCache, type BestLap, type RaceHttpDeps,
} from "../beacon-api/src/raceHttp";
import type { Race, UploadResult } from "../beacon-api/src/raceRoom";
import { MIN_RACE_SECRET, RACE_COURSE_ID, UPLOAD_MAX_BYTES } from "../src/utils/raceProtocol";

/*
 * GET /race/best and POST /race/result on the Worker (beacon-api/src/raceHttp.ts),
 * and the Sky room's upload reply. Binding-free: D1 and the Durable Object are
 * the deps' readBest and forwardResult.
 */

const ORIGIN = "https://fitzfitz.github.io";
const SECRET = "s".repeat(MIN_RACE_SECRET);
const BEST: BestLap = { course: RACE_COURSE_ID, timeMs: 51_234, ghost: '{"v":1,"time":51.2,"s":[]}', cc: "ID", at: 1_760_000_000_000 };

function deps(over: Partial<RaceHttpDeps> = {}) {
  const forwarded: string[] = [];
  const d: RaceHttpDeps = {
    allowedOrigins: [ORIGIN],
    secret: SECRET,
    readBest: async () => null,
    forwardResult: async (body) => {
      forwarded.push(body);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    ...over,
  };
  return { d, forwarded };
}
const req = (path: string, init: RequestInit & { origin?: string | null } = {}) => {
  const { origin = ORIGIN, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (origin !== null) headers.set("Origin", origin);
  headers.set("CF-Connecting-IP", "203.0.113.7");
  return new Request(`https://api.example${path}`, { ...rest, headers });
};
const post = (body: string, init: RequestInit & { origin?: string | null } = {}) =>
  req("/race/result", { method: "POST", body, headers: { "Content-Type": "application/json" }, ...init });

describe("raceSecret", () => {
  it("is null when missing or shorter than MIN_RACE_SECRET", () => {
    expect(raceSecret(undefined)).toBeNull();
    expect(raceSecret("")).toBeNull();
    expect(raceSecret("x".repeat(31))).toBeNull();
  });
  it("is the secret at MIN_RACE_SECRET characters or more", () => {
    expect(raceSecret("x".repeat(32))).toBe("x".repeat(32));
    expect(raceSecret("y".repeat(64))).toBe("y".repeat(64));
  });
});

describe("handleRaceHttp routing", () => {
  it("returns null for paths that are not race routes", async () => {
    const { d } = deps();
    for (const p of ["/beacons", "/content", "/live", "/race", "/race/", "/race/bestx", "/race/result/x"]) {
      expect(await handleRaceHttp(req(p), d)).toBeNull();
    }
  });
  it("405 for the wrong method on each route", async () => {
    const { d } = deps();
    expect((await handleRaceHttp(req("/race/best", { method: "POST", body: "{}" }), d))!.status).toBe(405);
    expect((await handleRaceHttp(req("/race/result"), d))!.status).toBe(405);
  });
});

describe("CORS", () => {
  it("answers OPTIONS on both routes with 204 and the CORS headers", async () => {
    const { d, forwarded } = deps();
    for (const p of ["/race/best", "/race/result"]) {
      const res = (await handleRaceHttp(req(p, { method: "OPTIONS" }), d))!;
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    }
    expect(forwarded).toEqual([]);
  });
  it("GET carries CORS for an allowed origin and Vary: Origin always", async () => {
    const { d } = deps();
    const ok = (await handleRaceHttp(req("/race/best"), d))!;
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(ok.headers.get("Vary")).toBe("Origin");
    const other = (await handleRaceHttp(req("/race/best", { origin: "https://evil.example" }), d))!;
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(other.headers.get("Vary")).toBe("Origin");
  });
  it("a POST from a disallowed or missing origin gets 403 and is not forwarded", async () => {
    const { d, forwarded } = deps();
    expect((await handleRaceHttp(post("{}", { origin: "https://evil.example" }), d))!.status).toBe(403);
    expect((await handleRaceHttp(post("{}", { origin: null }), d))!.status).toBe(403);
    expect(forwarded).toEqual([]);
  });
});

describe("the request budget", () => {
  it("a limiter refusal gets 429 with Retry-After on GET and POST, before any read or forward", async () => {
    const readBest = vi.fn(async () => BEST);
    const limit = vi.fn(async () => ({ success: false }));
    const { d, forwarded } = deps({ limiter: { limit }, readBest });
    for (const r of [req("/race/best"), post("{}")]) {
      const res = (await handleRaceHttp(r, d))!;
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("60");
    }
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
    expect(readBest).not.toHaveBeenCalled();
    expect(forwarded).toEqual([]);
  });
});

describe("GET /race/best", () => {
  it("with no row: { course, timeMs: null }", async () => {
    const { d } = deps();
    const res = (await handleRaceHttp(req("/race/best"), d))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ course: RACE_COURSE_ID, timeMs: null });
  });
  it("with a row: { course, timeMs, ghost, cc, at }, publicly cacheable for 30 s", async () => {
    const { d } = deps({ readBest: async () => BEST });
    const res = (await handleRaceHttp(req("/race/best"), d))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(BEST);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
  });
  it("a failed read (table missing, D1 down) is 503, not cached", async () => {
    const { d } = deps({ readBest: async () => { throw new Error("no such table: race_best"); } });
    const res = (await handleRaceHttp(req("/race/best"), d))!;
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("still works with no race secret", async () => {
    const { d } = deps({ secret: raceSecret("x".repeat(31)), readBest: async () => BEST });
    const res = (await handleRaceHttp(req("/race/best"), d))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(BEST);
  });
});

describe("POST /race/result", () => {
  it("with no usable secret: 503, not forwarded", async () => {
    for (const raw of [undefined, "x".repeat(31)]) {
      const { d, forwarded } = deps({ secret: raceSecret(raw) });
      const res = (await handleRaceHttp(post('{"race":"r"}'), d))!;
      expect(res.status).toBe(503);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(forwarded).toEqual([]);
    }
  });
  it("a declared body over UPLOAD_MAX_BYTES gets 413", async () => {
    const { d, forwarded } = deps();
    const res = (await handleRaceHttp(post("{}", { headers: { "Content-Length": String(UPLOAD_MAX_BYTES + 1) } }), d))!;
    expect(res.status).toBe(413);
    expect(forwarded).toEqual([]);
  });
  it("a body over UPLOAD_MAX_BYTES (64 KB) gets 413; exactly the limit is forwarded", async () => {
    const { d, forwarded } = deps();
    const big = JSON.stringify({ ghost: "x".repeat(UPLOAD_MAX_BYTES) });
    expect((await handleRaceHttp(post(big), d))!.status).toBe(413);
    // Multi-byte characters count as bytes, not characters.
    const wide = JSON.stringify({ g: "é".repeat(UPLOAD_MAX_BYTES / 2) });
    expect((await handleRaceHttp(post(wide), d))!.status).toBe(413);
    const exact = JSON.stringify({ g: "x".repeat(UPLOAD_MAX_BYTES - 8) });
    expect(new TextEncoder().encode(exact).length).toBe(UPLOAD_MAX_BYTES);
    expect((await handleRaceHttp(post(exact), d))!.status).toBe(200);
    expect(forwarded).toEqual([exact]);
  });
  it("forwards the exact body and passes the room's status and JSON through, with CORS", async () => {
    const body = '{"race":"r-1","token":"abc","stamps":[],"ghost":"{\\"v\\":1}"}';
    for (const [status, reply] of [[200, { ok: true, entry: { cc: "ID", timeMs: 1, rings: 10, lastAt: 2 } }], [409, { ok: false, reason: "late" }], [400, { ok: false, reason: "sig" }]] as const) {
      const { d, forwarded } = deps({
        forwardResult: async (b) => { forwarded.push(b); return new Response(JSON.stringify(reply), { status }); },
      });
      const res = (await handleRaceHttp(post(body), d))!;
      expect(forwarded).toEqual([body]);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(reply);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
      expect(res.headers.get("Content-Type")).toBe("application/json");
    }
  });
});

describe("withBestCache", () => {
  it("reads once per ttl, per isolate; a failed read is not cached", async () => {
    let clock = 0;
    let fail = true;
    const read = vi.fn(async () => { if (fail) throw new Error("down"); return BEST; });
    const cached = withBestCache(read, 30_000, () => clock);
    await expect(cached()).rejects.toThrow("down");
    fail = false;
    expect(await cached()).toEqual(BEST);
    clock = 29_999;
    expect(await cached()).toEqual(BEST);
    expect(read).toHaveBeenCalledTimes(2);
    clock = 30_001;
    await cached();
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("caches a missing row too", async () => {
    const read = vi.fn(async () => null);
    const cached = withBestCache(read, 30_000, () => 0);
    expect(await cached()).toBeNull();
    expect(await cached()).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("the room's upload reply", () => {
  const TOKEN = "ab".repeat(16);
  const entry = { token: TOKEN, cc: "ID", timeMs: 50_000, rings: 10, lastAt: 1_050_000 };
  const race = { id: "r-1", racers: [{ token: TOKEN, cc: "ID" }, { token: "cd".repeat(16), cc: "SG" }] } as unknown as Race;

  it("never carries the race or any token: { ok, entry } with the entry's token stripped", async () => {
    const res = uploadReply({ status: 200, entry, race });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("cd".repeat(16));
    expect(JSON.parse(text)).toEqual({ ok: true, entry: { cc: "ID", timeMs: 50_000, rings: 10, lastAt: 1_050_000 } });
  });
  it("a refusal is { ok: false, reason } with the room's status", async () => {
    for (const r of [{ status: 400, reason: "sig" }, { status: 404, reason: "race" }, { status: 409, reason: "late" }] as UploadResult[]) {
      const res = uploadReply(r);
      expect(res.status).toBe(r.status);
      expect(await res.json()).toEqual({ ok: false, reason: r.reason });
    }
  });
  it("bestCandidate: a 200 with a finished entry gives the entry, parsed stamps, ghost and the racer's cc", () => {
    const stamp = { r: "r-1", k: TOKEN, i: 0, at: 1_000_000, sig: "0".repeat(32) };
    const body = { race: "r-1", token: TOKEN, stamps: [stamp], ghost: "g" };
    expect(bestCandidate(body, { status: 200, entry, race })).toEqual({ entry, stamps: [stamp], ghost: "g", cc: "ID" });
    expect(bestCandidate({ ...body, ghost: undefined }, { status: 200, entry, race })?.ghost).toBeUndefined();
  });
  it("bestCandidate: null for a refusal or a DNF", () => {
    const body = { race: "r-1", token: TOKEN, stamps: [], ghost: "g" };
    expect(bestCandidate(body, { status: 409, reason: "late" })).toBeNull();
    expect(bestCandidate(body, { status: 200, entry: { ...entry, timeMs: null }, race })).toBeNull();
  });
});
