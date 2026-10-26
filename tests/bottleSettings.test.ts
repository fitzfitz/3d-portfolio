import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSpaceStore } from "../src/store/spaceStore";
import { STORE_KEYS } from "../src/store/persist";
import { OWN_BOTTLES_KEPT, type Bottle } from "../src/utils/beacons";

/** Spec "The visitor setting: Show bottles", and the visitor's own bottles kept across visits. */

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}
const bottle = (i: number): Bottle => ({ id: `b${i}`, x: 100, y: 0, z: 100, text: `note ${i}`, at: 1_760_000_000_000 + i, country: "ID" });

beforeEach(() => useSpaceStore.setState({ showBottles: true, ownBottles: [], ownBeacons: [] }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("Show bottles", () => {
  it("defaults to on", () => {
    expect(useSpaceStore.getInitialState().showBottles).toBe(true);
    expect(STORE_KEYS.showBottles).toBe("fitz-bottles");
  });
  it("setShowBottles toggles and persists as fitz-bottles", () => {
    const ls = memoryStorage();
    vi.stubGlobal("localStorage", ls);
    useSpaceStore.getState().setShowBottles(false);
    expect(useSpaceStore.getState().showBottles).toBe(false);
    expect(ls.map.get("fitz-bottles")).toBe("0");
    useSpaceStore.getState().setShowBottles(true);
    expect(ls.map.get("fitz-bottles")).toBe("1");
  });
  it("is read back on the next visit", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ "fitz-bottles": "0" }));
    vi.resetModules();
    const fresh = await import("../src/store/spaceStore");
    expect(fresh.useSpaceStore.getState().showBottles).toBe(false);
  });
  it("survives blocked storage", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
    expect(() => useSpaceStore.getState().setShowBottles(false)).not.toThrow();
    expect(useSpaceStore.getState().showBottles).toBe(false);
  });
});

describe("the visitor's own bottles", () => {
  it("addOwnBottle keeps the newest OWN_BOTTLES_KEPT, persisted as fitz-own-bottles, and marks the id as own", () => {
    const ls = memoryStorage();
    vi.stubGlobal("localStorage", ls);
    for (let i = 0; i < OWN_BOTTLES_KEPT + 3; i++) useSpaceStore.getState().addOwnBottle(bottle(i));
    const s = useSpaceStore.getState();
    expect(s.ownBottles).toHaveLength(OWN_BOTTLES_KEPT);
    expect(s.ownBottles[0].id).toBe(`b${OWN_BOTTLES_KEPT + 2}`);
    expect(s.ownBeacons[0]).toBe(`b${OWN_BOTTLES_KEPT + 2}`);
    expect(JSON.parse(ls.map.get("fitz-own-bottles")!)).toEqual(s.ownBottles);
    expect(STORE_KEYS.ownBottles).toBe("fitz-own-bottles");
  });
  it("reads them back on the next visit, dropping anything malformed", async () => {
    vi.stubGlobal("localStorage", memoryStorage({
      "fitz-own-bottles": JSON.stringify([bottle(1), { id: "<x>", text: 3 }, "junk", bottle(2)]),
    }));
    vi.resetModules();
    const fresh = await import("../src/store/spaceStore");
    expect(fresh.useSpaceStore.getState().ownBottles).toEqual([bottle(1), bottle(2)]);
  });
  it("starts empty on unreadable storage", async () => {
    vi.stubGlobal("localStorage", memoryStorage({ "fitz-own-bottles": "{not json" }));
    vi.resetModules();
    const fresh = await import("../src/store/spaceStore");
    expect(fresh.useSpaceStore.getState().ownBottles).toEqual([]);
  });
});
