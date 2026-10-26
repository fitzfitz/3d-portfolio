import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { WARP_LANDMARKS } from "../src/utils/warpLandmarks";
import { DESTINATIONS } from "../src/data/destinations";
import { GATE_POS } from "../src/data/dormantGate";
import { PROBES } from "../src/data/probes";

/**
 * Main's landmark set before projects came from D1: the three destinations
 * (career station, shipyard, contact portal), the dormant gate, then the three
 * probes' homes and remote spots. Literal, so a change to either list shows.
 */
const MAIN_LANDMARKS = [
  [67, 152, -104], [-70, 59, 45], [0, 95, -150], [-150, 130, 90],
  [-30, 80, 48], [-37, 413, -7], [-160, -53, -298], [60, -202, -236], [217, 354, -56], [261, 83, 190], [24, 31, 321], [-242, -251, 228],
  [-111, 60, 100], [-292, 24, -134], [-112, 312, -235], [10, -342, -15], [338, 126, -9], [126, -289, 216], [-177, -12, 273], [-322, 9, 114],
  [-67, 102, -7], [-204, -268, -138], [75, 76, -307], [287, -119, -88], [169, -67, 121], [27, 327, 259], [-209, 259, 237], [-314, 277, 5],
];

describe("WARP_LANDMARKS (the warp's fixed spheres)", () => {
  it("is exactly main's set with the bundled projects: empty probe slots never throttle the warp", () => {
    expect(WARP_LANDMARKS.map((p) => [...p])).toEqual(MAIN_LANDMARKS);
  });
  it("holds every destination, the gate and every probe in play", () => {
    for (const d of DESTINATIONS) expect(WARP_LANDMARKS).toContain(d.pos);
    expect(WARP_LANDMARKS).toContain(GATE_POS);
    for (const p of PROBES) for (const spot of [p.home, ...p.remote]) expect(WARP_LANDMARKS).toContain(spot);
  });
  it("is what Spaceship feeds the warp limit", () => {
    const src = readFileSync("src/components/canvas/Spaceship.tsx", "utf8");
    expect(src).toMatch(/WARP_LANDMARKS\[i\]/);
    expect(src).toContain('from "../../utils/warpLandmarks"');
  });
});
