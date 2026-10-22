import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The KTX2 transcoder the game ships (public/basis/, KTX2Loader's
// setTranscoderPath in sceneAssets.ts) must be three's own copy: a three
// upgrade that changes it needs the shipped one replaced too.
describe("public/basis", () => {
  for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
    it(`${f} is three's copy`, () => {
      expect(readFileSync(`public/basis/${f}`).equals(readFileSync(`node_modules/three/examples/jsm/libs/basis/${f}`))).toBe(true);
    });
  }
});
