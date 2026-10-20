import { describe, it, expect, vi } from "vitest";
import {
  parseMe, normQuat, publicCountry, roundState, chartCount, isChartedClaim, parseClient, CHART_TOTAL, MAX_MESSAGE_BYTES,
} from "../src/utils/liveSkyProtocol";
import { LEGACY_CHART_TOTAL } from "../src/data/bodyIds";

const me = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ t: "me", p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock", ...o });

describe("the charted count (C2)", () => {
  it("is 5 worlds at most", () => expect(CHART_TOTAL).toBe(5));
  // The wire still counts the five legacy worlds until Task 8 moves it to
  // the nine bodies with the legacy-5 rule (old cached clients keep AURUM).
  it("is still the legacy chart's total on the wire (Task 8 raises it to 9)", () => {
    expect(CHART_TOTAL).toBe(LEGACY_CHART_TOTAL);
  });
  it("defaults to 0, so a client that never sends it stays visible", () => {
    expect(parseMe(me())?.ch).toBe(0);
  });
  it("carries a valid count", () => expect(parseMe(me({ ch: 3 }))?.ch).toBe(3));
  it.each([["a string", "5"], ["a fraction", 5.5], ["a negative", -1], ["too many", 99], ["null", null]])(
    "coerces %s to 0 and keeps the pilot",
    (_n, ch) => {
      const s = parseMe(me({ ch }));
      expect(s).not.toBeNull();
      expect(s?.ch).toBe(0);
    },
  );
  it("chartCount accepts only whole numbers 0-5", () => {
    expect([0, 1, 5].map(chartCount)).toEqual([0, 1, 5]);
    expect([6, -1, 2.5, "3", undefined, NaN].map(chartCount)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("lets the AURUM plume through only with all five charted", () => {
    expect(parseMe(me({ plume: "cartographer", ch: 5 }))?.plume).toBe("cartographer");
    expect(parseMe(me({ plume: "cartographer", ch: 4 }))?.plume).toBe("stock");
    expect(parseMe(me({ plume: "cartographer" }))?.plume).toBe("stock");
  });
  it("fits the worst case in the byte cap", () => {
    // Longest numbers still inside the 520 validation sphere (r ≈ 519.6).
    const raw = JSON.stringify({ t: "me", p: [-299.99, -299.99, -299.99], q: [-0.4999, -0.4999, -0.4999, -0.5001], plume: "cartographer", ch: 5 });
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(parseMe(raw)?.ch).toBe(5);
  });
  it("roundState carries the count", () => {
    expect(roundState({ p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock", ch: 4 }).ch).toBe(4);
  });
});

describe("parseClient: the room reads each message once", () => {
  it("tells a pose from a claim", () => {
    expect(parseClient(me({ ch: 2 }))).toEqual({ t: "me", state: { p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock", ch: 2 } });
    expect(parseClient('{"t":"charted"}')).toEqual({ t: "charted" });
  });
  it.each([["broken JSON", "{x"], ["an unknown type", '{"t":"hi"}'], ["a bad pose", me({ q: [0, 0, 0, 0] })], ["a binary frame", new ArrayBuffer(4)]])(
    "returns null for %s",
    (_n, raw) => expect(parseClient(raw)).toBeNull(),
  );
  it("parses JSON once per message", () => {
    const spy = vi.spyOn(JSON, "parse");
    parseClient(me());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("isChartedClaim", () => {
  it("knows the claim", () => expect(isChartedClaim('{"t":"charted"}')).toBe(true));
  it.each([["a pose", '{"t":"me"}'], ["a non-string", 42], ["broken JSON", "{x"], ["an oversize frame", `{"t":"charted","x":"${"y".repeat(MAX_MESSAGE_BYTES)}"}`]])(
    "turns away %s",
    (_n, raw) => expect(isChartedClaim(raw)).toBe(false),
  );
});

describe("parseMe", () => {
  it("accepts a valid message", () => {
    expect(parseMe(me())).toEqual({ p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock", ch: 0 });
  });
  it("accepts positions inside the validation sphere, corners included", () => {
    expect(parseMe(me({ p: [515, 0, 0] }))).not.toBeNull();
    expect(parseMe(me({ p: [290, 290, 290] }))).not.toBeNull();
  });
  it("accepts every unlockable plume", () => {
    for (const id of ["slingshot", "comet", "ring", "ore", "convoy", "shards"]) expect(parseMe(me({ plume: id }))).not.toBeNull();
  });
  it.each([
    ["the wrong type", me({ t: "you" })],
    ["broken JSON", "{nope"],
    ["an unknown plume", me({ plume: "rainbow" })],
    ["a prototype key as plume", me({ plume: "toString" })],
    ["a short position", me({ p: [1, 2] })],
    ["a non-finite position", me({ p: [1, null, 3] })],
    ["a position outside the world", me({ p: [3810, 0, 0] })], // VALIDATION_RADIUS 3800
    ["a corner outside the validation sphere", me({ p: [2200, 2200, 2200] })], // r 3811
    ["a zero quaternion", me({ q: [0, 0, 0, 0] })],
    ["a stretched quaternion", me({ q: [0, 0, 0, 2] })],
    ["a JSON array", "[1,2,3]"],
  ])("rejects %s", (_name, raw) => {
    expect(parseMe(raw)).toBeNull();
  });
  it("rejects binary frames", () => expect(parseMe(new ArrayBuffer(8))).toBeNull());
  it("rejects anything over the byte cap", () => {
    expect(parseMe(me({ pad: "x".repeat(MAX_MESSAGE_BYTES) }))).toBeNull();
  });
  it("rejects an oversized frame on its length, before encoding it", () => {
    const spy = vi.spyOn(TextEncoder.prototype, "encode");
    expect(parseMe("x".repeat(1_000_000))).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("normalises a near-unit quaternion", () => {
    expect(parseMe(me({ q: [0, 0, 0, 1.04] }))!.q[3]).toBeCloseTo(1, 10);
  });
});

describe("normQuat", () => {
  it("keeps a unit quaternion", () => expect(normQuat([0, 0.6, 0, 0.8])).toEqual([0, 0.6, 0, 0.8]));
  it("rejects a non-array", () => expect(normQuat("q")).toBeNull());
});

describe("publicCountry", () => {
  it("keeps real codes", () => expect(publicCountry("ID")).toBe("ID"));
  it.each([["XX"], ["T1"], ["id"], ["IDN"], [""], [null], [undefined]])("hides %s", (cc) => {
    expect(publicCountry(cc)).toBeNull();
  });
});

describe("roundState", () => {
  it("rounds positions to 0.01 and quaternions to 0.001", () => {
    expect(roundState({ p: [1.23456, 2, -3.004], q: [0.12345, 0, 0, 0.99234], plume: "ore", ch: 2 }))
      .toEqual({ p: [1.23, 2, -3], q: [0.123, 0, 0, 0.992], plume: "ore", ch: 2 });
  });
});
