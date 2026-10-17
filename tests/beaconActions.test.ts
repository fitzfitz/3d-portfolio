import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SYSTEM_RADIUS } from "../src/constants";
import { SPAWN } from "../src/data/spawn";

const post = vi.fn();
vi.mock("../src/utils/beaconApi", async (orig) => ({ ...(await orig<typeof import("../src/utils/beaconApi")>()), postBeacon: (d: unknown) => post(d) }));

import { dropBeacon } from "../src/utils/beaconActions";
import { flight, useSpaceStore } from "../src/store/spaceStore";

beforeEach(() => { post.mockReset(); });

describe("dropBeacon", () => {
  it("clamps a drop beyond the edge onto the SYSTEM_RADIUS sphere, direction preserved", async () => {
    post.mockResolvedValue({ ok: false, reason: "offline" });
    flight.x = 430; flight.y = 0; flight.z = 0;
    await dropBeacon(0);
    const sent = post.mock.calls[0][0] as { x: number; y: number; z: number };
    expect(Math.hypot(sent.x, sent.y, sent.z)).toBeCloseTo(SYSTEM_RADIUS, 6);
    expect(sent.y).toBeCloseTo(0, 6); expect(sent.z).toBeCloseTo(0, 6);
  });
  it("leaves an inside drop untouched", async () => {
    post.mockResolvedValue({ ok: false, reason: "offline" });
    flight.x = 100; flight.y = 20; flight.z = -50;
    await dropBeacon(0);
    expect(post.mock.calls[0][0]).toMatchObject({ x: 100, y: 20, z: -50 });
  });
  it("keeps the spawn-pad line for a local refusal and uses the relay line for a server 400", async () => {
    flight.x = SPAWN.x; flight.y = SPAWN.y; flight.z = SPAWN.z;
    post.mockResolvedValue({ ok: false, reason: "invalid" });
    await dropBeacon(0);
    expect(useSpaceStore.getState().broadcast?.text).toMatch(/TOO CLOSE TO THE SPAWN PAD/);
    post.mockResolvedValue({ ok: false, reason: "refused" });
    await dropBeacon(0);
    expect(useSpaceStore.getState().broadcast?.text).toBe("BEACON REFUSED BY RELAY");
  });
});

describe("postBeacon reasons", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.unstubAllGlobals(); });
  async function run(status: number | "spawn") {
    const store: Record<string, string> = { "fitz-beacon-api-dev": "http://relay.test" };
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null });
    const fetchMock = vi.fn(async () => new Response("{}", { status: status === "spawn" ? 200 : status }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const actual = await vi.importActual<typeof import("../src/utils/beaconApi")>("../src/utils/beaconApi");
    const drop = status === "spawn" ? { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z, phrase: 0 } : { x: 100, y: 0, z: 100, phrase: 0 };
    return { r: await actual.postBeacon(drop), fetchMock };
  }
  it("local validation failure is invalid and never hits the network", async () => {
    const { r, fetchMock } = await run("spawn");
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("a server 400 is refused, not invalid", async () => {
    expect((await run(400)).r).toEqual({ ok: false, reason: "refused" });
  });
  it("429 stays rate and 500 stays offline", async () => {
    expect((await run(429)).r).toEqual({ ok: false, reason: "rate" });
    expect((await run(500)).r).toEqual({ ok: false, reason: "offline" });
  });
});
