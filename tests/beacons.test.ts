import { describe, it, expect } from "vitest";
import { validateDrop, bottleVisible, parseBottles, bottleReport, bottleCardMeta, bottleAge, bottleScanId, BOTTLE_LIMIT, SPAWN_KEEP_OUT } from "../src/utils/beacons";
import { BOTTLE_MAX_CHARS } from "../src/utils/bottleFilter";
import { SPAWN } from "../src/data/spawn";
import { BEACON_PHRASES } from "../src/data/beaconPhrases";
import { SYSTEM_RADIUS, VALIDATION_RADIUS } from "../src/constants";

const good = { x: 10, y: -4.26, z: 120, phrase: 2 };

describe("validateDrop", () => {
  it("accepts a phrase index and a position inside the system, rounded to 0.1", () => {
    expect(validateDrop(good)).toEqual({ ok: true, drop: { x: 10, y: -4.3, z: 120, phrase: 2 } });
  });
  // validateDrop is the legacy { phrase } body only; free text goes through bottleFilter.ts.
  it("rejects free text and out-of-range phrases", () => {
    for (const phrase of ["HELLO", -1, BEACON_PHRASES.length, 1.5, null]) {
      expect(validateDrop({ ...good, phrase }).ok).toBe(false);
    }
  });
  it("rejects positions outside the system or not finite", () => {
    for (const x of [VALIDATION_RADIUS + 5, -VALIDATION_RADIUS - 5, Number.NaN, Infinity, "3"]) expect(validateDrop({ ...good, x }).ok).toBe(false);
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
    // VALIDATION_RADIUS 3800 (spec §6.1): r 3790 in, r 3810 out, and a cube corner of side 2 × 2200 (r 3811) out.
    expect(VALIDATION_RADIUS).toBe(3800);
    expect(validateDrop({ ...good, x: 3790, y: 0, z: 0 }).ok).toBe(true);
    expect(validateDrop({ ...good, x: 3810, y: 0, z: 0 }).ok).toBe(false);
    expect(validateDrop({ ...good, x: 2200, y: 2200, z: 2200 }).ok).toBe(false);
  });
  it("draws a beacon only inside the system radius", () => {
    expect(SYSTEM_RADIUS).toBe(3600);
    expect(bottleVisible({ x: 2080, y: 2080, z: 2080 })).toBe(false); // r 3603, past the 3600 edge
    expect(bottleVisible({ x: 2070, y: 2070, z: 2070 })).toBe(true); // r 3585
  });
});

describe("parseBottles", () => {
  const row = { id: "a1b2c3", x: 1, y: 2, z: 3, text: "Hello from Jakarta!", at: 1_760_000_000_000, country: "ID" };
  it("keeps well-formed bottles", () => {
    expect(parseBottles({ beacons: [row] })).toEqual([row]);
  });
  // Legacy rows carry the old phrase index for the old client; the new one reads the text and drops the key.
  it("tolerates a legacy row's phrase key and leaves it out", () => {
    const [b] = parseBottles({ beacons: [{ ...row, text: "NICE VIEW", phrase: 1 }] });
    expect(b).toEqual({ ...row, text: "NICE VIEW" });
    expect("phrase" in b).toBe(false);
  });
  // The response is untrusted: a bad row is dropped, not rendered and not thrown.
  it("drops malformed rows and keeps the rest", () => {
    const bad = [
      { ...row, id: "<script>" }, { ...row, x: 1e9 }, { ...row, country: "Indonesia" }, { ...row, at: "yesterday" },
      { ...row, text: 3 }, { ...row, text: "   " }, { ...row, text: undefined }, { ...row, text: "x".repeat(BOTTLE_MAX_CHARS + 1) },
      // An old phrase-only row (no text) is not a bottle.
      { id: "old", x: 1, y: 2, z: 3, phrase: 0, at: 1, country: null }, null,
    ];
    expect(parseBottles({ beacons: [...bad, row] })).toEqual([row]);
  });
  it("accepts a full-length note of 4-byte characters", () => {
    const text = "🌊🍾".repeat(BOTTLE_MAX_CHARS / 2);
    expect(parseBottles({ beacons: [{ ...row, text }] })).toHaveLength(1);
  });
  it("accepts a missing country", () => {
    expect(parseBottles({ beacons: [{ ...row, country: null }] })[0].country).toBeNull();
  });
  it("caps the list at BOTTLE_LIMIT so a hostile response cannot flood the scene", () => {
    const many = Array.from({ length: BOTTLE_LIMIT + 20 }, (_, i) => ({ ...row, id: `b${i}` }));
    expect(parseBottles({ beacons: many })).toHaveLength(BOTTLE_LIMIT);
  });
  it("returns nothing for a malformed body", () => {
    for (const b of [null, {}, { beacons: "x" }, "[]"]) expect(parseBottles(b)).toEqual([]);
  });
});

describe("bottleReport", () => {
  const now = 1_760_000_000_000;
  const b = { id: "a", x: 0, y: 0, z: 0, text: "Hello from Jakarta!", at: now, country: "ID" };
  it("reads who left it, when, then the note as written", () => {
    expect(bottleReport({ ...b, at: now - 3 * 86_400_000 }, now))
      .toBe('SCAN[MESSAGE_BOTTLE] // LEFT 3 DAYS AGO BY A PILOT FROM ID // "Hello from Jakarta!"');
  });
  it("leaves out an unknown origin", () => {
    expect(bottleReport({ ...b, country: null, at: now - 2 * 3_600_000 }, now))
      .toBe('SCAN[MESSAGE_BOTTLE] // LEFT 2 HOURS AGO BY A PILOT // "Hello from Jakarta!"');
  });
  it("tells the pilot their own bottle", () => {
    expect(bottleReport({ ...b, at: now - 5 * 60_000 }, now, true))
      .toBe('SCAN[YOUR_BOTTLE] // LEFT 5 MINUTES AGO BY YOU // "Hello from Jakarta!"');
  });
  it("keeps markup-like text verbatim (it is only ever rendered as text)", () => {
    expect(bottleReport({ ...b, text: "<b>x</b>" }, now)).toMatch(/"<b>x<\/b>"$/);
  });
});

describe("bottleAge", () => {
  it("says JUST NOW for a fresh bottle, and copes with clock skew via the callers' clamp", () => {
    expect(bottleAge(30_000)).toBe("JUST NOW");
    expect(bottleAge(0)).toBe("JUST NOW");
  });
  it("uses singular units", () => {
    expect(bottleAge(60_000)).toBe("1 MINUTE AGO");
    expect(bottleAge(3_600_000)).toBe("1 HOUR AGO");
    expect(bottleAge(86_400_000)).toBe("1 DAY AGO");
    expect(bottleAge(3 * 86_400_000 + 5)).toBe("3 DAYS AGO");
  });
});

describe("bottleCardMeta", () => {
  const now = 1_760_000_000_000;
  const b = { id: "a", x: 0, y: 0, z: 0, text: "hi there", at: now - 3 * 86_400_000, country: "ID" };
  it("gives the country and the age", () => {
    expect(bottleCardMeta(b, now)).toBe("FROM ID · LEFT 3 DAYS AGO");
  });
  it("gives only the age when the country is unknown, and JUST NOW under clock skew", () => {
    expect(bottleCardMeta({ ...b, country: null, at: now + 60_000 }, now)).toBe("LEFT JUST NOW");
  });
  it("names scannables bottle_<id>", () => {
    expect(bottleScanId("abc")).toBe("bottle_abc");
  });
});
