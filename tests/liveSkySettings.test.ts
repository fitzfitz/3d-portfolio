import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSpaceStore, flight } from "../src/store/spaceStore";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

beforeEach(() => useSpaceStore.setState({ liveSky: true, liveSkySeen: false }));
afterEach(() => vi.unstubAllGlobals());

describe("live sky settings", () => {
  it("defaults to on, with the notice unseen", () => {
    const init = useSpaceStore.getInitialState();
    expect(init.liveSky).toBe(true);
    expect(init.liveSkySeen).toBe(false);
  });
  it("setLiveSky toggles and persists as fitz-live-sky", () => {
    const ls = memoryStorage();
    vi.stubGlobal("localStorage", ls);
    useSpaceStore.getState().setLiveSky(false);
    expect(useSpaceStore.getState().liveSky).toBe(false);
    expect(ls.map.get("fitz-live-sky")).toBe("0");
    useSpaceStore.getState().setLiveSky(true);
    expect(ls.map.get("fitz-live-sky")).toBe("1");
  });
  it("setLiveSkySeen persists as fitz-live-seen", () => {
    const ls = memoryStorage();
    vi.stubGlobal("localStorage", ls);
    useSpaceStore.getState().setLiveSkySeen(true);
    expect(useSpaceStore.getState().liveSkySeen).toBe(true);
    expect(ls.map.get("fitz-live-seen")).toBe("1");
  });
  it("survives blocked storage", () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
    expect(() => useSpaceStore.getState().setLiveSky(false)).not.toThrow();
    expect(useSpaceStore.getState().liveSky).toBe(false);
  });
  it("flight.hasFlown starts false", () => {
    expect(flight.hasFlown).toBe(false);
  });
});
