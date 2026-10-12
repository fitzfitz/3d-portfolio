import { describe, it, expect, beforeEach } from "vitest";
import { handleRequest, RATE_WINDOW_MS, KEEP_ROWS, type BeaconStore, type StoredBeacon } from "../beacon-api/src/handler";

const ORIGIN = "https://fitzfitz.github.io";
const NOW = 1_760_000_000_000;

/** In-memory stand-in for the D1 adapter: same contract, no SQL. */
function memoryStore(): BeaconStore & { rows: StoredBeacon[] } {
  const rows: StoredBeacon[] = [];
  return {
    rows,
    async list(limit) { return [...rows].sort((a, b) => b.at - a.at).slice(0, limit); },
    async countSince(ipHash, since) { return rows.filter((r) => r.ipHash === ipHash && r.at >= since).length; },
    async insert(row) { rows.push(row); },
    async prune(keep) {
      const kept = [...rows].sort((a, b) => b.at - a.at).slice(0, keep);
      rows.splice(0, rows.length, ...kept);
    },
  };
}

let store: ReturnType<typeof memoryStore>;
let clock = NOW;
const deps = () => ({ store, allowedOrigins: [ORIGIN], salt: "pepper", now: () => clock });

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
    expect((await post({ x: 4, y: 5, z: 6, phrase: 2 })).status).toBe(429);
    expect((await post({ x: 4, y: 5, z: 6, phrase: 2 }, { ip: "198.51.100.2" })).status).toBe(201);
    clock += RATE_WINDOW_MS;
    expect((await post({ x: 4, y: 5, z: 6, phrase: 2 })).status).toBe(201);
  });
  it("drops an unknown country rather than storing junk", async () => {
    const { beacon } = await (await post({ x: 1, y: 2, z: 3, phrase: 1 }, { country: "XX" })).json();
    expect(beacon.country).toBeNull();
  });
  it("prunes to the newest rows so the table cannot grow without bound", async () => {
    for (let i = 0; i < KEEP_ROWS + 5; i++) {
      clock += 1;
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
