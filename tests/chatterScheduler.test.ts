import { describe, it, expect } from "vitest";
import { ChatterScheduler, chatterZone, type ChatterPools } from "../src/utils/chatterScheduler";
import { chatterPools } from "../src/data/chatterLines";
import { PROBE_IDS } from "../src/data/probes";
import { DESTINATIONS } from "../src/data/destinations";

const pools: ChatterPools = {
  deepSpace: ["ds-1", "ds-2", "ds-3"],
  zones: { saas: ["saas-1", "saas-2"], video: ["video-1"] },
  warp: ["warp-1", "warp-2"],
  haze: ["haze-1"], slingshot: ["sling-1"], ore: ["ore-1"],
  comet: ["comet-1", "comet-2"],
  impact: ["imp-1"],
  hail: ["hail-1"],
};

describe("ChatterScheduler", () => {
  it("picks from the hail pool for cargo hails", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("hail")).toBe("hail-1");
  });
  it("picks from the zone pool when a known zone is given", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("zone", "saas")).toBe("saas-1");
  });
  it("falls back to deepSpace for unknown zones", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("zone", "nope")).toBe("ds-1");
  });
  it("never repeats the immediately-previous line when the pool has 2+ lines", () => {
    const s = new ChatterScheduler(pools, () => 0);
    const first = s.pick("ambient");
    const second = s.pick("ambient");
    expect(second).not.toBe(first);
  });
  it("allows repeats for single-line pools", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("haze")).toBe("haze-1");
    expect(s.pick("haze")).toBe("haze-1");
  });
  it("picks the haze, slingshot and ore pools", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("haze")).toBe("haze-1");
    expect(s.pick("slingshot")).toBe("sling-1");
    expect(s.pick("ore")).toBe("ore-1");
  });
  it("nextDelayMs stays within [18000, 35000]", () => {
    const lo = new ChatterScheduler(pools, () => 0);
    const hi = new ChatterScheduler(pools, () => 0.9999999);
    expect(lo.nextDelayMs()).toBe(18000);
    expect(hi.nextDelayMs()).toBeLessThanOrEqual(35000);
  });
  it("picks from the comet pool for comet events", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("comet")).toBe("comet-1");
  });
  it("picks from the impact pool", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("impact")).toBe("imp-1");
  });
});

// The project pools fire when a probe comes in range (probeNear), not on a
// planet's zone: planets have none now (project probes, spec §4.4).
describe("zone chatter: probes and destinations", () => {
  it("has a pool per probe and per destination, and nothing else", () => {
    expect(Object.keys(chatterPools.zones).sort()).toEqual([...PROBE_IDS, ...DESTINATIONS.map((d) => d.id)].filter((id) => id in chatterPools.zones).sort());
    for (const id of PROBE_IDS) expect(chatterPools.zones[id]?.length, id).toBeGreaterThan(0);
    for (const id of Object.keys(chatterPools.zones)) expect([...PROBE_IDS, ...DESTINATIONS.map((d) => d.id)], id).toContain(id);
  });
  it("each probe pool opens with \"<X> PROBE IN RANGE\", and no line announces a sector", () => {
    for (const id of PROBE_IDS) expect(chatterPools.zones[id][0].startsWith(`${id.toUpperCase()} PROBE IN RANGE`), id).toBe(true);
    for (const lines of Object.values(chatterPools.zones)) for (const l of lines) expect(l).not.toMatch(/SECTOR/);
  });
  it("chatterZone: a docked destination's zone wins, then the probe in range, else none", () => {
    expect(chatterZone("career", "fuxx")).toBe("career");
    expect(chatterZone(null, "fuxx")).toBe("fuxx");
    expect(chatterZone(null, null)).toBeNull();
  });
});
