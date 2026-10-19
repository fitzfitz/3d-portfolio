import { describe, expect, it } from "vitest";
import { HAS_ASSET_PACK, loadAssetPack } from "../src/utils/assetPack";

describe("assetPack without packs (dev, tests, e2e)", () => {
  it("hands out one promise, as React's use() requires", () => {
    // A new promise per call made PackGate suspend on every render: the
    // scene never mounted in dev and the e2e harness.
    expect(HAS_ASSET_PACK).toBe(false);
    expect(loadAssetPack()).toBe(loadAssetPack());
  });
});
