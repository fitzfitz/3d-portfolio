import { describe, it, expect, beforeEach } from "vitest";
import {
  handleRequest, rateKey, withListCache, RATE_WINDOW_MS, KEEP_ROWS, GLOBAL_PER_MINUTE,
  type BeaconStore, type StoredBeacon,
} from "../beacon-api/src/handler";

const ORIGIN = "https://fitzfitz.github.io";
const NOW = 1_760_000_000_000;

/** In-memory stand-in for the D1 adapter: same contract, no SQL. */
function memoryStore(): BeaconStore & { rows: StoredBeacon[]; listCalls: number } {
  const rows: StoredBeacon[] = [];
  const st = {
    rows,
    listCalls: 0,
    async list(limit: number) { st.listCalls++; return [...rows].sort((a, b) => b.at - a.at).slice(0, limit); },
    async insertIfAllowed(row: StoredBeacon, keySince: number, globalSince: number, globalMax: number) {
      if (rows.some((r) => r.ipHash === row.ipHash && r.at >= keySince)) return false;
      if (rows.filter((r) => r.at >= globalSince).length >= globalMax) return false;
      rows.push(row);
      return true;
    },
    async prune(keep: number) {
      const kept = [...rows].sort((a, b) => b.at - a.at).slice(0, keep);
      rows.splice(0, rows.length, ...kept);
    },
  };
  return st;
}

let store: ReturnType<typeof memoryStore>;
let clock = NOW;
const SALT = "pepper-pepper-pepper-pepper";
const deps = () => ({ store, allowedOrigins: [ORIGIN], salt: SALT, now: () => clock });

function post(body: unknown, { origin = ORIGIN, ip = "203.0.113.7", country = "ID" } = {}) {
  return handleRequest(new Request("https://api.example/beacons", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": ip, "CF-IPCountry": country },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), deps());
}
const get = (origin = ORIGIN) =>
  handleRequest(new Request("https://api.example/beacons", { headers: { Origin: origin } }), deps());

beforeEach(() => { store = memoryStore(); clock = NOW; });

describe("POST /beacons", () => {
  it("stores a valid drop with its country and returns it", async () => {
    const res = await post({ x: 1, y: 2, z: 3, phrase: 1 });
    expect(res.status).toBe(201);
    const { beacon } = await res.json();
    expect(beacon).toMatchObject({ x: 1, y: 2, z: 3, phrase: 1, at: NOW, country: "ID" });
    expect(store.rows).toHaveLength(1);
  });
  it("never stores the raw IP, only a salted hash", async () => {
    await post({ x: 1, y: 2, z: 3, phrase: 1 });
    expect(JSON.stringify(store.rows)).not.toContain("203.0.113.7");
    expect(store.rows[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
  });
  // An unsalted SHA-256 of an IPv4 address is reversible by brute force (2^32
  // guesses), so the hash must not be a plain hash of the IP.
  it("salts the IP hash", async () => {
    await post({ x: 1, y: 2, z: 3, phrase: 1 });
    const plain = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("203.0.113.7")))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(store.rows[0].ipHash).not.toBe(plain);
  });
  it("does not leak the IP hash in the response", async () => {
    const { beacon } = await (await post({ x: 1, y: 2, z: 3, phrase: 1 })).json();
    expect(beacon.ipHash).toBeUndefined();
  });
  it("rejects free text", async () => {
    expect((await post({ x: 1, y: 2, z: 3, phrase: "HIRE ME" })).status).toBe(400);
    expect(store.rows).toHaveLength(0);
  });
  it("rejects malformed and oversized bodies", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post(JSON.stringify({ x: 1, y: 2, z: 3, phrase: 1, pad: "x".repeat(2000) }))).status).toBe(413);
  });
  it("rejects other origins", async () => {
    expect((await post({ x: 1, y: 2, z: 3, phrase: 1 }, { origin: "https://evil.example" })).status).toBe(403);
  });
  it("allows one beacon per pilot per window", async () => {
    expect((await post({ x: 1, y: 2, z: 3, phrase: 1 })).status).toBe(201);
    expect((await post({ x: 40, y: 5, z: 6, phrase: 2 })).status).toBe(429);
    expect((await post({ x: 40, y: 5, z: 6, phrase: 2 }, { ip: "198.51.100.2" })).status).toBe(201);
    clock += RATE_WINDOW_MS;
    expect((await post({ x: 40, y: 5, z: 6, phrase: 2 })).status).toBe(201);
  });
  it("drops an unknown country rather than storing junk", async () => {
    const { beacon } = await (await post({ x: 1, y: 2, z: 3, phrase: 1 }, { country: "XX" })).json();
    expect(beacon.country).toBeNull();
  });
  it("prunes to the newest rows so the table cannot grow without bound", async () => {
    for (let i = 0; i < KEEP_ROWS + 5; i++) {
      clock += 60_000;
      await post({ x: 1, y: 2, z: 3, phrase: 1 }, { ip: `10.0.${i >> 8}.${i & 255}` });
    }
    expect(store.rows.length).toBe(KEEP_ROWS);
  });
});

describe("GET /beacons", () => {
  it("lists the newest beacons without IP hashes, with CORS for the site", async () => {
    await post({ x: 1, y: 2, z: 3, phrase: 1 });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const body = await res.json();
    expect(body.beacons).toHaveLength(1);
    expect(body.beacons[0].ipHash).toBeUndefined();
  });
  it("sends no CORS grant to other origins", async () => {
    const res = await get("https://evil.example");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("routing", () => {
  it("answers preflight for the site", async () => {
    const res = await handleRequest(new Request("https://api.example/beacons", {
      method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    }), deps());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
  it("404s anything else", async () => {
    const res = await handleRequest(new Request("https://api.example/admin"), deps());
    expect(res.status).toBe(404);
  });
});

describe("abuse resistance (security review)", () => {
  // Check-then-insert let parallel POSTs from one IP all see "no recent row".
  it("admits only one of a parallel burst from one pilot", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => post({ x: 1, y: 2, z: 3, phrase: 1 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });
  it("caps drops across all pilots per minute", async () => {
    const statuses = [];
    for (let i = 0; i < GLOBAL_PER_MINUTE + 3; i++) {
      statuses.push((await post({ x: 1, y: 2, z: 3, phrase: 1 }, { ip: `198.51.100.${i}` })).status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(GLOBAL_PER_MINUTE);
    expect(statuses.at(-1)).toBe(429);
  });
  it("keys IPv6 by /64, so rotating within a home prefix does not evade the limit", async () => {
    expect((await post({ x: 1, y: 2, z: 3, phrase: 1 }, { ip: "2001:db8:1:2::1" })).status).toBe(201);
    expect((await post({ x: 1, y: 2, z: 3, phrase: 1 }, { ip: "2001:db8:1:2:ffff::9" })).status).toBe(429);
  });
  it("rateKey keeps IPv4 whole and IPv6 to its /64, expanding ::", () => {
    expect(rateKey("203.0.113.7")).toBe("203.0.113.7");
    expect(rateKey("2001:db8:1:2::1")).toBe("2001:0db8:0001:0002");
    expect(rateKey("2001:DB8:1:2:a:b:c:d")).toBe("2001:0db8:0001:0002");
    expect(rateKey("::1")).toBe("0000:0000:0000:0000");
  });
  it("refuses to run without a real salt rather than store reversible hashes", async () => {
    const res = await handleRequest(new Request("https://api.example/beacons", {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
      body: JSON.stringify({ x: 1, y: 2, z: 3, phrase: 1 }),
    }), { ...deps(), salt: "" });
    expect(res.status).toBe(500);
    expect(store.rows).toHaveLength(0);
  });
  it("rejects a declared oversized body before reading it", async () => {
    const res = await handleRequest(new Request("https://api.example/beacons", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": "5000000" },
      body: "{}",
    }), deps());
    expect(res.status).toBe(413);
  });
  it("rejects a non-JSON content type", async () => {
    const res = await handleRequest(new Request("https://api.example/beacons", {
      method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "CF-Connecting-IP": "1.2.3.4" },
      body: JSON.stringify({ x: 1, y: 2, z: 3, phrase: 1 }),
    }), deps());
    expect(res.status).toBe(415);
  });
});

describe("withListCache", () => {
  // Every GET hit D1 before: Cache-Control does not cache a Worker's own response.
  it("serves repeat lists from memory within the TTL", async () => {
    let t = 0;
    const cached = withListCache(store, 30_000, () => t);
    await cached.list(40); await cached.list(40);
    expect(store.listCalls).toBe(1);
    t = 30_001;
    await cached.list(40);
    expect(store.listCalls).toBe(2);
  });
  it("drops the cached list after a successful insert", async () => {
    const cached = withListCache(store, 30_000, () => 0);
    await cached.list(40);
    await cached.insertIfAllowed({ id: "a", x: 0, y: 0, z: 0, phrase: 0, at: 1, country: null, ipHash: "h" }, 0, 0, 99);
    expect((await cached.list(40))).toHaveLength(1);
  });
});
