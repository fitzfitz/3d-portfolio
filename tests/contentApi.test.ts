import { describe, it, expect } from "vitest";
import { handleContent, withContentCache, CONTENT_MAX_AGE_S, type ContentStore, type ContentRows } from "../beacon-api/src/content";

const ORIGIN = "https://porto.fitzgeral.my.id";
const ROWS: ContentRows = {
  projects: [{ id: "atlas", sort: 10, title: "Atlas", tech: "[\"Go\"]", repo: null }],
  career: [{ id: 1, sort: 10, role: "Engineer", company: "Acme", end: null }],
};

function store(rows: ContentRows | Error = ROWS): ContentStore & { reads: number } {
  const s = {
    reads: 0,
    async read() { s.reads++; if (rows instanceof Error) throw rows; return rows; },
  };
  return s;
}
const req = (method = "GET", origin: string | null = ORIGIN, ip = "203.0.113.7") =>
  new Request("https://api.example/content", { method, headers: { ...(origin ? { Origin: origin } : {}), "CF-Connecting-IP": ip } });
const deps = (over: Partial<Parameters<typeof handleContent>[1]> = {}) => ({ store: store(), allowedOrigins: [ORIGIN], ...over });

describe("GET /content", () => {
  it("returns both tables as stored, with CORS for an allowed origin and a five-minute public cache", async () => {
    const res = await handleContent(req(), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ROWS);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(CONTENT_MAX_AGE_S).toBe(300);
    expect(res.headers.get("Vary")).toBe("Origin");
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
  });

  it("gives another origin the body but no CORS header, as /beacons does", async () => {
    const res = await handleContent(req("GET", "https://evil.example"), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("answers a preflight", async () => {
    const res = await handleContent(req("OPTIONS"), deps());
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("is read-only: any write is 405", async () => {
    for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await handleContent(req(m), deps());
      expect(res.status, m).toBe(405);
    }
  });

  it("answers 503, never cached, when D1 fails (the site then uses its bundled content)", async () => {
    const res = await handleContent(req(), deps({ store: store(new Error("no such table: projects")) }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(JSON.stringify(await res.json())).not.toContain("no such table");
  });

  it("spends the pilot's request budget, and answers 429 past it", async () => {
    const keys: string[] = [];
    const limiter = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false }; } };
    const res = await handleContent(req(), deps({ limiter }));
    expect(res.status).toBe(429);
    expect(keys).toEqual(["203.0.113.7"]);
  });
});

describe("withContentCache", () => {
  it("reads D1 once per TTL per isolate", async () => {
    let t = 0;
    const s = store();
    const cached = withContentCache(s, 60_000, () => t);
    await cached.read(); await cached.read();
    expect(s.reads).toBe(1);
    t = 60_001;
    await cached.read();
    expect(s.reads).toBe(2);
  });

  it("does not keep a failure", async () => {
    let fail = true;
    const s: ContentStore = { async read() { if (fail) throw new Error("down"); return ROWS; } };
    const cached = withContentCache(s, 60_000, () => 0);
    await expect(cached.read()).rejects.toThrow("down");
    fail = false;
    await expect(cached.read()).resolves.toEqual(ROWS);
  });
});
