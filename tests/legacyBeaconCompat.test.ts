import { describe, it, expect, beforeEach } from "vitest";
import { handleRequest, RATE_WINDOW_MS, type BeaconStore } from "../beacon-api/src/handler";
import { d1Store } from "../beacon-api/src/d1Store";
import { parseBottles } from "../src/utils/beacons";
import { sqliteD1 } from "./helpers/sqliteD1";
import { legacyParseBeacons } from "./legacyBeaconParser";

/*
 * "The new Worker must work with the old site" (plan, global constraints).
 * The Worker deploys before the site, so for a while a cached old page reads
 * the new GET output. Its parser (frozen in tests/legacyBeaconParser.ts) must
 * show the legacy phrase drops and silently drop free-text bottles, never
 * throw or render text it does not understand.
 */

const ORIGIN = "https://fitzfitz.github.io";
const NOW = 1_760_000_000_000;
let store: BeaconStore;
let clock = NOW;
const deps = () => ({ store, allowedOrigins: [ORIGIN], salt: "pepper-pepper-pepper-pepper", now: () => clock });

function post(body: unknown, ip: string) {
  return handleRequest(new Request("https://api.example/beacons", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip, "CF-IPCountry": "ID" },
    body: JSON.stringify(body),
  }), deps());
}
const get = async () => (await handleRequest(new Request("https://api.example/beacons", { headers: { Origin: ORIGIN } }), deps())).json();

beforeEach(() => {
  store = d1Store(sqliteD1("beacon-api/schema.sql").db);
  clock = NOW;
});

describe("the old site against the new Worker", () => {
  it("parses the legacy rows and drops the free-text bottles", async () => {
    expect((await post({ x: 10, y: 0, z: 100, phrase: 1 }, "198.51.100.1")).status).toBe(201);
    clock += 1000;
    expect((await post({ x: 20, y: 0, z: 100, text: "Hello from Jakarta!" }, "198.51.100.2")).status).toBe(201);
    clock += 1000;
    expect((await post({ x: 30, y: 0, z: 100, phrase: 8 }, "198.51.100.3")).status).toBe(201);
    clock += RATE_WINDOW_MS;

    const body = await get();
    expect(body.beacons).toHaveLength(3);
    const old = legacyParseBeacons(body);
    expect(old.map((b) => b.phrase)).toEqual([8, 1]);
    expect(old.every((b) => !("text" in b))).toBe(true);
    // And the new client reads all three, the legacy rows by their text.
    expect(parseBottles(body).map((b) => b.text)).toEqual(["HIRE THIS PILOT", "Hello from Jakarta!", "NICE VIEW"]);
  });

  it("reads an old client's own legacy POST response as a success", async () => {
    const res = await post({ x: 10, y: 0, z: 100, phrase: 5 }, "198.51.100.9");
    // The old dropBeacon parses { beacons: [body.beacon] } and reads nothing as "offline".
    const [beacon] = legacyParseBeacons({ beacons: [(await res.json()).beacon] });
    expect(beacon).toMatchObject({ phrase: 5, x: 10, z: 100, country: "ID" });
  });

  it("copes with a sky of free text only", async () => {
    for (let i = 0; i < 5; i++) {
      clock += 1000;
      await post({ x: 10 + i, y: 0, z: 100, text: `Note number ${"abcde"[i]} here` }, `198.51.100.${20 + i}`);
    }
    const body = await get();
    expect(body.beacons).toHaveLength(5);
    expect(legacyParseBeacons(body)).toEqual([]);
  });
});
