import { describe, it, expect } from "vitest";
import { SHARDS, shardBroadcast } from "../src/data/shards";

describe("shard broadcasts", () => {
  it("numbers a pickup by how many are collected, not by which shard it is", () => {
    // Shard 10 sits beside spawn, so it is often the second one found.
    expect(shardBroadcast(SHARDS[9].fact, 2)).toMatch(/^DATA_SHARD 2\/10 \/\/ /);
  });

  it("no individual fact claims the set is complete", () => {
    for (const s of SHARDS) {
      expect(s.fact).not.toMatch(/ALL SHARDS/i);
      expect(s.fact).not.toMatch(/^DATA_SHARD/);
    }
  });
});
