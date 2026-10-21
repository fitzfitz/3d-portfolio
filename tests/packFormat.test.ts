import { describe, expect, it } from "vitest";
import { decodePackIndex, encodePack, packTier } from "../src/utils/packFormat";

const bytes = (...n: number[]) => new Uint8Array(n);

describe("asset pack format", () => {
  it("round-trips every file's bytes and type", () => {
    const files = [
      { path: "models/a.glb", bytes: bytes(1, 2, 3) },
      { path: "models/b.webp", bytes: bytes() },
      { path: "models/c.bin", bytes: bytes(9, 8, 7, 6) },
    ];
    const pack = encodePack(files);
    const buf = new Uint8Array(pack).buffer; // a copy of exactly the pack's bytes
    const { entries, dataStart } = decodePackIndex(buf);

    expect(entries.map((e) => [e.path, e.type])).toEqual([
      ["models/a.glb", "model/gltf-binary"],
      ["models/b.webp", "image/webp"],
      ["models/c.bin", "application/octet-stream"],
    ]);
    entries.forEach((e, i) => {
      const got = new Uint8Array(buf, dataStart + e.offset, e.length);
      expect(Array.from(got)).toEqual(Array.from(files[i].bytes));
    });
  });

  it("rejects anything that is not a whole pack", () => {
    expect(() => decodePackIndex(new ArrayBuffer(4))).toThrow(/magic/);
    const pack = encodePack([{ path: "models/a.glb", bytes: bytes(1, 2, 3, 4) }]);
    expect(() => decodePackIndex(new Uint8Array(pack.subarray(0, pack.length - 1)).buffer)).toThrow(/past the end/);
  });

  it("packTier sorts files into tiers by the _4k naming", () => {
    const names = ["a.glb", "earth.webp", "earth_4k.webp", "jupiter.webp"];
    expect(packTier("a.glb", names)).toBe("common");
    expect(packTier("earth.webp", names)).toBe("sd");
    expect(packTier("earth_4k.webp", names)).toBe("hd");
    expect(packTier("jupiter.webp", names)).toBe("common");
  });
});
