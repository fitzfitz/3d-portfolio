import { describe, it, expect, vi, beforeEach } from "vitest";
import { SYSTEM_RADIUS } from "../src/constants";
import type { Bottle } from "../src/utils/beacons";

const post = vi.fn();
const fetchSky = vi.fn();
vi.mock("../src/utils/beaconApi", async (orig) => ({
  ...(await orig<typeof import("../src/utils/beaconApi")>()),
  postBottle: (d: unknown) => post(d),
  fetchBottles: () => fetchSky(),
}));

import { dropBottle, loadBottles, openBottlePanel } from "../src/utils/beaconActions";
import { flight, useSpaceStore } from "../src/store/spaceStore";

const T0 = 1_760_000_000_000;
const bottle = (i: number): Bottle => ({ id: `b${i}`, x: 100, y: 0, z: 100, text: `note ${i}`, at: T0 + i, country: null });

beforeEach(() => {
  post.mockReset();
  fetchSky.mockReset();
  useSpaceStore.setState({ beacons: [], ownBottles: [], ownBeacons: [], showBottles: true, bottlePanelOpen: false });
});

describe("dropBottle", () => {
  it("clamps a drop beyond the edge onto the SYSTEM_RADIUS sphere, direction preserved", async () => {
    post.mockResolvedValue({ ok: false, reason: "offline" });
    flight.x = SYSTEM_RADIUS + 30; flight.y = 0; flight.z = 0;
    await dropBottle("Hello there");
    const sent = post.mock.calls[0][0] as { x: number; y: number; z: number; text: string };
    expect(Math.hypot(sent.x, sent.y, sent.z)).toBeCloseTo(SYSTEM_RADIUS, 6);
    expect(sent.y).toBeCloseTo(0, 6); expect(sent.z).toBeCloseTo(0, 6);
    expect(sent.text).toBe("Hello there");
  });
  it("leaves an inside drop untouched", async () => {
    post.mockResolvedValue({ ok: false, reason: "offline" });
    flight.x = 100; flight.y = 20; flight.z = -50;
    await dropBottle("Hello there");
    expect(post.mock.calls[0][0]).toMatchObject({ x: 100, y: 20, z: -50 });
  });
  it("on success remembers the bottle as the pilot's own and shows it at once", async () => {
    useSpaceStore.setState({ beacons: Array.from({ length: 30 }, (_, i) => bottle(i)) });
    const mine = bottle(999);
    post.mockResolvedValue({ ok: true, bottle: mine });
    const r = await dropBottle("note 999");
    expect(r).toEqual({ ok: true, bottle: mine });
    const s = useSpaceStore.getState();
    expect(s.ownBeacons).toEqual(["b999"]);
    expect(s.ownBottles).toEqual([mine]);
    expect(s.beacons[0]).toEqual(mine);
    expect(s.beacons).toHaveLength(30);
    expect(s.broadcast?.text).toMatch(/^BOTTLE DROPPED/);
  });
  it("returns the failure for the panel and puts the same words on the radio", async () => {
    post.mockResolvedValue({ ok: false, reason: "rate", rate: "wait", retryAfter: 372 });
    const r = await dropBottle("Hello there");
    expect(r).toEqual({ ok: false, reason: "rate", rate: "wait", retryAfter: 372 });
    expect(useSpaceStore.getState().broadcast?.text).toBe("BOTTLE // ONE BOTTLE EVERY 10 MINUTES. NEXT IN 6:12.");
    expect(useSpaceStore.getState().ownBottles).toEqual([]);
  });
});

describe("loadBottles", () => {
  it("merges the sky with the pilot's own bottles", async () => {
    const mine = bottle(-5);
    useSpaceStore.setState({ ownBottles: [mine] });
    fetchSky.mockResolvedValue(Array.from({ length: 30 }, (_, i) => bottle(i)));
    await loadBottles();
    const ids = useSpaceStore.getState().beacons.map((b) => b.id);
    expect(ids).toHaveLength(31);
    expect(ids).toContain("b-5");
  });
  // Spec, "The visitor setting": off means nothing is fetched.
  it("fetches nothing while Show bottles is off", async () => {
    useSpaceStore.setState({ showBottles: false });
    await loadBottles();
    expect(fetchSky).not.toHaveBeenCalled();
    expect(useSpaceStore.getState().beacons).toEqual([]);
  });
});

describe("openBottlePanel", () => {
  it("opens the panel and releases held flight keys, whose keyups the panel will swallow", () => {
    flight.input.forward = true;
    openBottlePanel();
    expect(useSpaceStore.getState().bottlePanelOpen).toBe(true);
    expect(flight.input.forward).toBe(false);
  });
  // Writing still works with bottles hidden (spec, "The visitor setting").
  it("opens with Show bottles off too", () => {
    useSpaceStore.setState({ showBottles: false });
    openBottlePanel();
    expect(useSpaceStore.getState().bottlePanelOpen).toBe(true);
  });
});
