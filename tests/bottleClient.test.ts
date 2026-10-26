import { describe, it, expect, vi, afterEach } from "vitest";
import { mergeBottles, BOTTLE_LIMIT, OWN_BOTTLES_KEPT, BOTTLES_SHOWN_MAX, type Bottle } from "../src/utils/beacons";
import { postBottle, fetchBottles, dropFailureMessage, formatWait, type DropResult } from "../src/utils/beaconApi";
import { bottleReasonMessage, BOTTLE_MAX_CHARS } from "../src/utils/bottleFilter";
import { SPAWN } from "../src/data/spawn";

/*
 * The client side of messages in bottles (spec docs/superpowers/specs/
 * 2026-10-26-message-bottles-design.md): the 30 newest plus your own, and the
 * Worker's 400/429 answers turned into friendly, specific copy.
 */

const T0 = 1_760_000_000_000;
const bottle = (i: number, over: Partial<Bottle> = {}): Bottle =>
  ({ id: `b${i}`, x: 100 + i, y: 0, z: 100, text: `note ${i}`, at: T0 + i * 1000, country: null, ...over });

describe("mergeBottles", () => {
  it("shows the newest BOTTLE_LIMIT, newest first", () => {
    const served = Array.from({ length: 45 }, (_, i) => bottle(i));
    const out = mergeBottles(served, []);
    expect(out).toHaveLength(BOTTLE_LIMIT);
    expect(out[0].id).toBe("b44");
    expect(out.at(-1)!.id).toBe(`b${45 - BOTTLE_LIMIT}`);
  });
  it("adds the visitor's own bottles even when they fall outside the 30", () => {
    const served = Array.from({ length: 30 }, (_, i) => bottle(100 + i));
    const mine = [bottle(1), bottle(2)];
    const out = mergeBottles(served, mine);
    expect(out).toHaveLength(32);
    expect(out.map((b) => b.id)).toEqual(expect.arrayContaining(["b1", "b2"]));
    // The 30 newest for everyone are untouched.
    expect(out.slice(0, 30).map((b) => b.id)).toEqual(served.map((b) => b.id).reverse());
  });
  it("counts an own bottle inside the newest 30 once, and lets it hold its place", () => {
    const served = Array.from({ length: 30 }, (_, i) => bottle(i));
    const out = mergeBottles(served, [bottle(29)]);
    expect(out).toHaveLength(30);
    expect(out.filter((b) => b.id === "b29")).toHaveLength(1);
  });
  it("puts a just-dropped bottle first and lets it push the oldest of the 30 out", () => {
    const served = Array.from({ length: 30 }, (_, i) => bottle(i));
    const fresh = bottle(999);
    const out = mergeBottles(served, [fresh]);
    expect(out).toHaveLength(30);
    expect(out[0].id).toBe("b999");
    expect(out.some((b) => b.id === "b0")).toBe(false);
  });
  it("never exceeds BOTTLES_SHOWN_MAX, so the scene's instance buffer always fits", () => {
    expect(BOTTLES_SHOWN_MAX).toBe(BOTTLE_LIMIT + OWN_BOTTLES_KEPT);
    const served = Array.from({ length: 30 }, (_, i) => bottle(100 + i));
    const mine = Array.from({ length: 25 }, (_, i) => bottle(i));
    expect(mergeBottles(served, mine).length).toBeLessThanOrEqual(BOTTLES_SHOWN_MAX);
  });
});

describe("formatWait", () => {
  it("reads minutes and seconds under an hour, hours past it", () => {
    expect(formatWait(372)).toBe("6:12");
    expect(formatWait(42)).toBe("0:42");
    expect(formatWait(3 * 3600 + 12 * 60 + 5)).toBe("3:12:05");
  });
  it("rounds up and never reads zero", () => {
    expect(formatWait(59.2)).toBe("1:00");
    expect(formatWait(0)).toBe("0:01");
  });
});

describe("dropFailureMessage", () => {
  it("uses the filter's own copy for a rejection", () => {
    for (const filter of ["too_short", "too_long", "contact", "profanity", "junk"] as const) {
      expect(dropFailureMessage({ ok: false, reason: "rejected", filter })).toBe(bottleReasonMessage(filter));
    }
  });
  it("names the wait, the daily cap and a busy relay, each with the time left", () => {
    expect(dropFailureMessage({ ok: false, reason: "rate", rate: "wait", retryAfter: 372 }))
      .toBe("One bottle every 10 minutes. Next in 6:12.");
    expect(dropFailureMessage({ ok: false, reason: "rate", rate: "daily", retryAfter: 3 * 3600 + 12 * 60 + 5 }))
      .toBe("5 bottles a day is the limit. Next in 3:12:05.");
    expect(dropFailureMessage({ ok: false, reason: "rate", rate: "busy", retryAfter: 42 }))
      .toBe("Lots of bottles are landing right now. Try again in 0:42.");
  });
  it("still reads well without a time", () => {
    expect(dropFailureMessage({ ok: false, reason: "rate", rate: "wait", retryAfter: null }))
      .toBe("One bottle every 10 minutes. Try again soon.");
  });
  it("covers the spawn pad, a refusal and an offline relay", () => {
    expect(dropFailureMessage({ ok: false, reason: "invalid" })).toMatch(/spawn pad/);
    expect(dropFailureMessage({ ok: false, reason: "refused" })).toMatch(/refused/);
    expect(dropFailureMessage({ ok: false, reason: "offline" })).toMatch(/offline/);
  });
});

describe("postBottle and fetchBottles over the wire", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllGlobals(); });
  function relay(status: number, body: unknown, headers: Record<string, string> = {}) {
    const store: Record<string, string> = { "fitz-beacon-api-dev": "http://relay.test" };
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }
  const at = { x: 100, y: 0, z: 100 };

  it("sends the filtered text and returns the stored bottle", async () => {
    const fetchMock = relay(201, { beacon: { id: "n1", ...at, text: "Hello there", at: T0, country: "SG" } });
    const r = await postBottle({ ...at, text: "  Hello   there " });
    expect(r).toEqual({ ok: true, bottle: { id: "n1", ...at, text: "Hello there", at: T0, country: "SG" } });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ ...at, text: "Hello there" });
  });
  it("refuses locally, without a request, what the filter refuses", async () => {
    const fetchMock = relay(201, {});
    expect(await postBottle({ ...at, text: "visit example.com" })).toEqual({ ok: false, reason: "rejected", filter: "contact" });
    expect(await postBottle({ ...at, text: "x".repeat(BOTTLE_MAX_CHARS + 1) })).toEqual({ ok: false, reason: "rejected", filter: "too_long" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses the spawn pad locally, without a request", async () => {
    const fetchMock = relay(201, {});
    expect(await postBottle({ x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, text: "Hello there" })).toEqual({ ok: false, reason: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("maps a 400 rejection to its filter reason", async () => {
    relay(400, { error: "rejected", reason: "profanity" });
    expect(await postBottle({ ...at, text: "Hello there" })).toEqual({ ok: false, reason: "rejected", filter: "profanity" });
  });
  it("maps any other 400 to refused", async () => {
    relay(400, { error: "invalid beacon" });
    expect(await postBottle({ ...at, text: "Hello there" })).toEqual({ ok: false, reason: "refused" });
    relay(400, { error: "rejected", reason: "<b>nope</b>" });
    expect(await postBottle({ ...at, text: "Hello there" })).toEqual({ ok: false, reason: "refused" });
  });
  it("maps each 429 with its retryAfter", async () => {
    for (const rate of ["wait", "daily", "busy"] as const) {
      relay(429, { error: "rate", reason: rate, retryAfter: 372 }, { "Retry-After": "372" });
      expect(await postBottle({ ...at, text: "Hello there" })).toEqual({ ok: false, reason: "rate", rate, retryAfter: 372 });
    }
  });
  it("falls back to the Retry-After header, then to no time, and to the wait for an old relay", async () => {
    relay(429, { error: "rate" }, { "Retry-After": "90" });
    expect(await postBottle({ ...at, text: "Hello there" })).toEqual({ ok: false, reason: "rate", rate: "wait", retryAfter: 90 });
    relay(429, { error: "rate", reason: "busy", retryAfter: "soon" });
    expect(await postBottle({ ...at, text: "Hello there" })).toEqual({ ok: false, reason: "rate", rate: "busy", retryAfter: null });
  });
  it("reads a 5xx, a malformed success or a network failure as offline", async () => {
    relay(500, {});
    expect(await postBottle({ ...at, text: "Hello there" })).toEqual({ ok: false, reason: "offline" });
    relay(201, { beacon: { id: "<x>" } });
    expect(await postBottle({ ...at, text: "Hello there" })).toEqual({ ok: false, reason: "offline" });
    relay(200, {});
    globalThis.fetch = vi.fn(async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect(await postBottle({ ...at, text: "Hello there" })).toEqual({ ok: false, reason: "offline" });
  });
  it("fetches and parses the sky, tolerating legacy rows", async () => {
    relay(200, { beacons: [
      { id: "a", ...at, text: "NICE VIEW", phrase: 1, at: T0, country: "ID" },
      { id: "b", ...at, text: "Hello there", at: T0 - 1, country: null },
    ] });
    expect((await fetchBottles()).map((b) => b.text)).toEqual(["NICE VIEW", "Hello there"]);
  });
});

// Type-level: a DropResult is exactly one of these.
const _ok: DropResult = { ok: true, bottle: bottle(1) };
void _ok;
