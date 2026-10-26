import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  handleRequest, RATE_WINDOW_MS, KEEP_ROWS, GLOBAL_PER_MINUTE, DAY_MS,
  type BeaconStore,
} from "../beacon-api/src/handler";
import { d1Store } from "../beacon-api/src/d1Store";
import { BOTTLE_LIMIT, BOTTLE_DAILY_CAP } from "../src/utils/beacons";
import { BOTTLE_MAX_CHARS } from "../src/utils/bottleFilter";
import { BEACON_PHRASES } from "../src/data/beaconPhrases";
import { sqliteD1, d1Of } from "./helpers/sqliteD1";

/*
 * Messages in bottles on the Worker (spec: docs/superpowers/specs/
 * 2026-10-26-message-bottles-design.md, "Data and API"). These run the handler
 * against the real D1 adapter over SQLite, with beacon-api/schema.sql, so the
 * atomic insert, the hidden filter and prune are the shipped SQL.
 */

const ORIGIN = "https://fitzfitz.github.io";
const NOW = 1_760_000_000_000;
const SALT = "pepper-pepper-pepper-pepper";
const AT = { x: 1, y: 2, z: 3 };

let sql: DatabaseSync;
let store: BeaconStore;
let clock = NOW;
const deps = () => ({ store, allowedOrigins: [ORIGIN], salt: SALT, now: () => clock });

function post(body: unknown, { ip = "203.0.113.7", country = "ID" } = {}) {
  return handleRequest(new Request("https://api.example/beacons", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip, "CF-IPCountry": country },
    body: JSON.stringify(body),
  }), deps());
}
const get = () => handleRequest(new Request("https://api.example/beacons", { headers: { Origin: ORIGIN } }), deps());
const count = () => (sql.prepare("SELECT COUNT(*) AS n FROM beacons").get() as { n: number }).n;

beforeEach(() => {
  const d1 = sqliteD1("beacon-api/schema.sql");
  sql = d1.sql;
  store = d1Store(d1.db);
  clock = NOW;
});

describe("POST /beacons with text", () => {
  it("stores a note and returns it as { id, x, y, z, text, at, country }", async () => {
    const res = await post({ ...AT, text: "Hello from Jakarta!" });
    expect(res.status).toBe(201);
    const { beacon } = await res.json();
    expect(Object.keys(beacon).sort()).toEqual(["at", "country", "id", "text", "x", "y", "z"]);
    expect(beacon).toMatchObject({ ...AT, text: "Hello from Jakarta!", at: NOW, country: "ID" });
    expect(sql.prepare("SELECT text, hidden FROM beacons").get()).toEqual({ text: "Hello from Jakarta!", hidden: 0 });
  });
  it("stores the filter's normalised text, not the raw input", async () => {
    const { beacon } = await (await post({ ...AT, text: "  nice​   view\n out here  " })).json();
    expect(beacon.text).toBe("nice view out here");
  });
  it("fits a full-length note of 4-byte characters under the body cap", async () => {
    const text = "🌊🍾".repeat(BOTTLE_MAX_CHARS / 2);
    expect((await post({ ...AT, text })).status).toBe(201);
  });
  it("prefers text when an old field rides along", async () => {
    const { beacon } = await (await post({ ...AT, text: "Clear skies", phrase: 1 })).json();
    expect(beacon.text).toBe("Clear skies");
    expect(beacon.phrase).toBeUndefined();
  });
});

describe("POST /beacons, the legacy { phrase } body", () => {
  // A cached old client keeps working through the deploy (spec, Data and API).
  it("maps every phrase to its text, including ones the free-text filter would refuse", async () => {
    for (const [i, phrase] of BEACON_PHRASES.entries()) {
      clock += RATE_WINDOW_MS;
      const res = await post({ ...AT, phrase: i }, { ip: `198.51.100.${i}` });
      expect(res.status).toBe(201);
      const { beacon } = await res.json();
      expect(beacon.text).toBe(phrase);
      // The old client's parser needs the index back, or it reads the drop as failed.
      expect(beacon.phrase).toBe(i);
    }
  });
  it("still refuses what the old API refused", async () => {
    for (const phrase of ["HIRE ME", -1, BEACON_PHRASES.length, 1.5, null]) {
      expect((await post({ ...AT, phrase })).status).toBe(400);
    }
    expect(count()).toBe(0);
  });
});

describe("rejections", () => {
  const cases: [string, unknown][] = [
    ["too_short", "hi"],
    ["too_long", "a nice long note ".repeat(10)],
    ["contact", "add me on discord: fitz at example.com"],
    ["contact", "visit https://spam.example"],
    ["profanity", "this is shit"],
    ["junk", "!!!!!!!!!!"],
    ["too_short", ""],
  ];
  for (const [reason, text] of cases) {
    it(`400s ${JSON.stringify(text).slice(0, 30)} as ${reason} and stores nothing`, async () => {
      const res = await post({ ...AT, text });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "rejected", reason });
      expect(count()).toBe(0);
    });
  }
  it("checks the position before the text", async () => {
    const res = await post({ x: 1e9, y: 0, z: 0, text: "this is shit" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid beacon");
  });
  it("refuses a body with neither text nor a phrase, and non-string text", async () => {
    expect((await post({ ...AT })).status).toBe(400);
    expect((await post({ ...AT, text: 42 })).status).toBe(400);
    expect(count()).toBe(0);
  });
  // The filter runs before the limits, so a refused note does not spend the
  // pilot's 10-minute window.
  it("does not count a rejected note against the pilot", async () => {
    expect((await post({ ...AT, text: "this is shit" })).status).toBe(400);
    expect((await post({ ...AT, text: "Sorry, nice view" })).status).toBe(201);
  });
});

describe("rate limits", () => {
  it("names the 10-minute window and when the next bottle is allowed", async () => {
    expect((await post({ ...AT, text: "first note" })).status).toBe(201);
    clock += 4 * 60_000;
    const res = await post({ ...AT, text: "second note" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "rate", reason: "wait", retryAfter: 6 * 60 });
    expect(res.headers.get("Retry-After")).toBe("360");
  });
  it(`caps a pilot at ${BOTTLE_DAILY_CAP} a day, then lets them back in as the oldest ages out`, async () => {
    const first = clock;
    for (let i = 0; i < BOTTLE_DAILY_CAP; i++) {
      expect((await post({ ...AT, text: `note number ${i + 1}` })).status).toBe(201);
      clock += RATE_WINDOW_MS;
    }
    const res = await post({ ...AT, text: "one too many" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.reason).toBe("daily");
    expect(body.retryAfter).toBe((first + DAY_MS - clock) / 1000);
    // Another pilot is unaffected.
    expect((await post({ ...AT, text: "someone else" }, { ip: "198.51.100.9" })).status).toBe(201);
    clock = first + DAY_MS;
    expect((await post({ ...AT, text: "a new day" })).status).toBe(201);
  });
  it("counts hidden notes toward the daily cap, so hiding one does not refund it", async () => {
    for (let i = 0; i < BOTTLE_DAILY_CAP; i++) {
      await post({ ...AT, text: `note number ${i + 1}` });
      clock += RATE_WINDOW_MS;
    }
    sql.exec("UPDATE beacons SET hidden = 1");
    expect((await post({ ...AT, text: "one too many" })).status).toBe(429);
  });
  it("names the global cap as busy", async () => {
    for (let i = 0; i < GLOBAL_PER_MINUTE; i++) {
      expect((await post({ ...AT, text: "hello there" }, { ip: `198.51.100.${i}` })).status).toBe(201);
    }
    const res = await post({ ...AT, text: "hello there" }, { ip: "192.0.2.1" });
    expect(res.status).toBe(429);
    expect((await res.json()).reason).toBe("busy");
  });
});

describe("GET /beacons", () => {
  /** Seeds `n` visible notes from distinct pilots, one a minute. */
  async function seed(n: number) {
    for (let i = 0; i < n; i++) {
      clock += 60_000;
      expect((await post({ ...AT, text: `note number ${i}` }, { ip: `10.0.${i >> 8}.${i & 255}` })).status).toBe(201);
    }
  }
  it("returns each bottle as { id, x, y, z, text, at, country }, without the IP hash", async () => {
    await post({ ...AT, text: "Hello from Jakarta!" });
    const { beacons } = await (await get()).json();
    expect(beacons).toHaveLength(1);
    expect(Object.keys(beacons[0]).sort()).toEqual(["at", "country", "id", "text", "x", "y", "z"]);
  });
  it(`serves at most ${BOTTLE_LIMIT}, newest first`, async () => {
    expect(BOTTLE_LIMIT).toBe(30);
    await seed(BOTTLE_LIMIT + 5);
    const { beacons } = await (await get()).json();
    expect(beacons).toHaveLength(BOTTLE_LIMIT);
    expect(beacons[0].text).toBe(`note number ${BOTTLE_LIMIT + 4}`);
    expect(beacons.map((b: { at: number }) => b.at)).toEqual([...beacons.map((b: { at: number }) => b.at)].sort((a, b) => b - a));
  });
  it("leaves out notes the owner hid, and fills the 30 from older ones", async () => {
    await seed(BOTTLE_LIMIT + 5);
    sql.exec("UPDATE beacons SET hidden = 1 WHERE text = 'note number 34' OR text = 'note number 20'");
    const { beacons } = await (await get()).json();
    const texts = beacons.map((b: { text: string }) => b.text);
    expect(texts).toHaveLength(BOTTLE_LIMIT);
    expect(texts).not.toContain("note number 34");
    expect(texts).not.toContain("note number 20");
    expect(texts.at(-1)).toBe("note number 3");
  });
});

describe("prune", () => {
  // At the global cap a full day is 14,400 rows, far past KEEP_ROWS: pruning
  // to 500 would forget a pilot's earlier notes within an hour and reopen the
  // daily cap. Rows younger than a day are kept whatever KEEP_ROWS says.
  it("never prunes a row inside the daily-cap window, even at the global rate", async () => {
    for (let i = 0; i < KEEP_ROWS + 40; i++) {
      clock += 60_000 / GLOBAL_PER_MINUTE;
      expect((await post({ ...AT, text: "hello there" }, { ip: `10.1.${i >> 8}.${i & 255}` })).status).toBe(201);
    }
    expect(count()).toBe(KEEP_ROWS + 40);
  });
  it("still trims to KEEP_ROWS once rows are older than a day", async () => {
    for (let i = 0; i < KEEP_ROWS + 40; i++) {
      clock += 60_000 / GLOBAL_PER_MINUTE;
      await post({ ...AT, text: "hello there" }, { ip: `10.1.${i >> 8}.${i & 255}` });
    }
    clock += DAY_MS;
    expect((await post({ ...AT, text: "next day" })).status).toBe(201);
    expect(count()).toBe(KEEP_ROWS);
  });
});

/** The beacons table as it is in production before beacon-api/bottles.sql. */
const LEGACY_SCHEMA = `
CREATE TABLE beacons (
  id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
  phrase INTEGER NOT NULL, at INTEGER NOT NULL, country TEXT, ip_hash TEXT NOT NULL
);
CREATE INDEX beacons_at ON beacons (at DESC);
CREATE INDEX beacons_ip_at ON beacons (ip_hash, at);`;

describe("beacon-api/bottles.sql (the migration)", () => {
  function legacyDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(LEGACY_SCHEMA);
    const ins = db.prepare("INSERT INTO beacons (id, x, y, z, phrase, at, country, ip_hash) VALUES (?, 1, 2, 3, ?, ?, 'ID', 'h')");
    BEACON_PHRASES.forEach((_, i) => ins.run(`b${i}`, i, NOW + i));
    return db;
  }
  const migration = readFileSync("beacon-api/bottles.sql", "utf8");

  it("adds text and hidden, and backfills text from every phrase", () => {
    const db = legacyDb();
    db.exec(migration);
    const rows = db.prepare("SELECT phrase, text, hidden FROM beacons ORDER BY phrase").all();
    expect(rows).toEqual(BEACON_PHRASES.map((text, phrase) => ({ phrase, text, hidden: 0 })));
  });
  it("fails on a second run before changing anything", () => {
    const db = legacyDb();
    db.exec(migration);
    db.exec("UPDATE beacons SET text = 'edited' WHERE id = 'b0'");
    expect(() => db.exec(migration)).toThrow(/duplicate column/);
    expect(db.prepare("SELECT text FROM beacons WHERE id = 'b0'").get()).toEqual({ text: "edited" });
  });
  it("leaves a database the new Worker serves, including rows the old Worker wrote after it", async () => {
    const db = legacyDb();
    db.exec(migration);
    // The old Worker is still live between the migration and the new deploy.
    db.prepare("INSERT INTO beacons (id, x, y, z, phrase, at, country, ip_hash) VALUES ('late', 1, 2, 3, 5, ?, NULL, 'h2')").run(NOW + 100);
    const s = d1Store(d1Of(db));
    const rows = await s.list(BOTTLE_LIMIT);
    expect(rows[0]).toMatchObject({ id: "late", text: BEACON_PHRASES[5] });
    expect(rows).toHaveLength(BEACON_PHRASES.length + 1);
    // A new note inserts into the migrated table (phrase there is NOT NULL).
    store = s;
    clock = NOW + 60 * 60_000;
    expect((await post({ ...AT, text: "after the migration" })).status).toBe(201);
  });
});
