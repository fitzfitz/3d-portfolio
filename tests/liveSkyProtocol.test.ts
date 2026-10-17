import { describe, it, expect, vi } from "vitest";
import { parseMe, normQuat, publicCountry, roundState, MAX_MESSAGE_BYTES } from "../src/utils/liveSkyProtocol";

const me = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ t: "me", p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock", ...o });

describe("parseMe", () => {
  it("accepts a valid message", () => {
    expect(parseMe(me())).toEqual({ p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock" });
  });
  it("accepts positions inside the validation sphere, corners included", () => {
    expect(parseMe(me({ p: [435, 0, 0] }))).not.toBeNull();
    expect(parseMe(me({ p: [240, 240, 240] }))).not.toBeNull();
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
    ["a position outside the world", me({ p: [445, 0, 0] })],
    ["a corner outside the validation sphere", me({ p: [260, 260, 260] })],
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
    expect(roundState({ p: [1.23456, 2, -3.004], q: [0.12345, 0, 0, 0.99234], plume: "ore" }))
      .toEqual({ p: [1.23, 2, -3], q: [0.123, 0, 0, 0.992], plume: "ore" });
  });
});
