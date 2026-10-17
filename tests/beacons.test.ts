import { describe, it, expect } from "vitest";
import { validateDrop, beaconVisible, parseBeacons, beaconReport, BEACON_LIMIT, SPAWN_KEEP_OUT } from "../src/utils/beacons";
import { SPAWN } from "../src/data/spawn";
import { BEACON_PHRASES } from "../src/data/beaconPhrases";

const good = { x: 10, y: -4.26, z: 120, phrase: 2 };

describe("validateDrop", () => {
  it("accepts a phrase index and a position inside the system, rounded to 0.1", () => {
    expect(validateDrop(good)).toEqual({ ok: true, drop: { x: 10, y: -4.3, z: 120, phrase: 2 } });
  });
  // Free text never reaches the server: a beacon is an index into a fixed list,
  // which is the whole moderation story.
  it("rejects free text and out-of-range phrases", () => {
    for (const phrase of ["HELLO", -1, BEACON_PHRASES.length, 1.5, null]) {
      expect(validateDrop({ ...good, phrase }).ok).toBe(false);
    }
  });
  it("rejects positions outside the system or not finite", () => {
    for (const x of [451, -451, Number.NaN, Infinity, "3"]) expect(validateDrop({ ...good, x }).ok).toBe(false);
  });
  // Every visitor starts at the spawn pad (src/data/spawn.ts): a pile of beacons there
  // would be the first thing a recruiter sees.
  it("refuses drops near the spawn pad", () => {
    expect(validateDrop({ x: SPAWN.x + 3, y: SPAWN.y, z: SPAWN.z + 2, phrase: 0 }).ok).toBe(false);
    expect(validateDrop({ x: SPAWN.x, y: SPAWN.y, z: SPAWN.z + SPAWN_KEEP_OUT + 1, phrase: 0 }).ok).toBe(true);
  });
  it("rejects non-objects", () => {
    for (const b of [null, "x", 3, []]) expect(validateDrop(b).ok).toBe(false);
  });
});

describe("sphere bounds", () => {
  it("validates within the sphere, not a cube", () => {
    expect(validateDrop({ ...good, x: 430, y: 0, z: 0 }).ok).toBe(true);
    expect(validateDrop({ ...good, x: 450, y: 0, z: 0 }).ok).toBe(false);
    expect(validateDrop({ ...good, x: 300, y: 300, z: 300 }).ok).toBe(false);
  });
  it("draws a beacon only inside the system radius", () => {
    expect(beaconVisible({ x: 250, y: 250, z: 250 })).toBe(false);
    expect(beaconVisible({ x: 200, y: 200, z: 200 })).toBe(true);
  });
});

describe("parseBeacons", () => {
  const row = { id: "a1b2c3", x: 1, y: 2, z: 3, phrase: 0, at: 1_760_000_000_000, country: "ID" };
  it("keeps well-formed beacons", () => {
    expect(parseBeacons({ beacons: [row] })).toEqual([row]);
  });
  // The response is untrusted: a bad row is dropped, not rendered and not thrown.
  it("drops malformed rows and keeps the rest", () => {
    const bad = [
      { ...row, id: "<script>" }, { ...row, phrase: 99 }, { ...row, x: 1e9 },
      { ...row, country: "Indonesia" }, { ...row, at: "yesterday" }, null,
    ];
    expect(parseBeacons({ beacons: [...bad, row] })).toEqual([row]);
  });
  it("accepts a missing country", () => {
    expect(parseBeacons({ beacons: [{ ...row, country: null }] })[0].country).toBeNull();
  });
  it("caps the list so a hostile response cannot flood the scene", () => {
    const many = Array.from({ length: BEACON_LIMIT + 20 }, (_, i) => ({ ...row, id: `b${i}` }));
    expect(parseBeacons({ beacons: many })).toHaveLength(BEACON_LIMIT);
  });
  it("returns nothing for a malformed body", () => {
    for (const b of [null, {}, { beacons: "x" }, "[]"]) expect(parseBeacons(b)).toEqual([]);
  });
});

describe("beaconReport", () => {
  const now = 1_760_000_000_000;
  const b = { id: "a", x: 0, y: 0, z: 0, phrase: 0, at: now, country: "ID" };
  it("reads the phrase, where the pilot was from, and how long ago", () => {
    expect(beaconReport({ ...b, at: now - 3 * 86_400_000 }, now))
      .toBe(`BEACON // "${BEACON_PHRASES[0]}" · PILOT FROM ID · 3 DAYS AGO`);
  });
  it("leaves out an unknown origin", () => {
    expect(beaconReport({ ...b, country: null, at: now - 2 * 3_600_000 }, now))
      .toBe(`BEACON // "${BEACON_PHRASES[0]}" · 2 HOURS AGO`);
  });
  it("says JUST NOW for a fresh beacon, and copes with clock skew", () => {
    expect(beaconReport({ ...b, at: now - 30_000 }, now)).toMatch(/JUST NOW$/);
    expect(beaconReport({ ...b, at: now + 60_000 }, now)).toMatch(/JUST NOW$/);
  });
  it("uses singular units", () => {
    expect(beaconReport({ ...b, at: now - 86_400_000 }, now)).toMatch(/1 DAY AGO$/);
  });
});
