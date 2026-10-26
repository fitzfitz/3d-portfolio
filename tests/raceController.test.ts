import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSpaceStore } from "../src/store/spaceStore";
import { onRaceServer, onRaceOver, resetRaceController } from "../src/utils/raceController";
import { RACE_IDLE, RUN_TTL_MS, loadRun } from "../src/utils/raceSession";
import { STORE_KEYS } from "../src/store/persist";
import { RING_GATES } from "../src/data/ringCourse";
import type { RaceServerMessage, Stamp } from "../src/utils/raceProtocol";

const N = RING_GATES.length;
const TOKEN = "0123456789abcdef0123456789abcdef";
const SIG = "fedcba9876543210fedcba9876543210";
const stamp = (i: number, at: number, r = "race-1"): Stamp => ({ r, k: TOKEN, i, at, sig: SIG });
const T = 1_000_000;

let stored: Map<string, string>;
const s = () => useSpaceStore.getState();
const run = () => loadRun(stored.get(STORE_KEYS.raceRun) ?? null, T);
const lobby = (race = "race-1"): RaceServerMessage => ({
  t: "rlobby", race, kind: "public", code: null, host: false, token: TOKEN,
  pilots: [{ cc: "ID", you: true }], startsAt: null, now: T,
});

beforeEach(() => {
  // Date.now() reads T: onRaceOver loads the run at the current time, and the badge line's timers stay in the test.
  vi.useFakeTimers({ now: T });
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => { stored.set(k, v); },
    removeItem: (k: string) => { stored.delete(k); },
  });
  resetRaceController();
  useSpaceStore.setState({
    raceView: RACE_IDLE, raceLiveSkyRestore: false, raceBest: null, badges: [], broadcast: null, logbookLineAt: 0, liveSky: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("raceController", () => {
  it("rlobby stores a fresh run, once per race and token", () => {
    onRaceServer(lobby(), T);
    expect(s().raceView.phase).toBe("lobby");
    expect(run()).toEqual({ v: 1, race: "race-1", token: TOKEN, stamps: [], expiresAt: T + RUN_TTL_MS });
    onRaceServer({ t: "rgrid", race: "race-1", kind: "public", slot: 0, goAt: T + 3000, now: T }, T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 3000 }, T + 3000);
    onRaceServer(lobby(), T + 4000);
    expect(run()!.stamps).toEqual([stamp(0, T + 3000)]);
  });

  it("rgo and rstamp add stamps; the view follows", () => {
    onRaceServer(lobby(), T);
    onRaceServer({ t: "rgrid", race: "race-1", kind: "public", slot: 0, goAt: T + 3000, now: T }, T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 3000 }, T + 3000);
    onRaceServer({ t: "rstamp", stamp: stamp(1, T + 8000) }, T + 8000);
    expect(run()!.stamps.map((x) => x.i)).toEqual([0, 1]);
    expect(s().raceView).toMatchObject({ phase: "running", next: 2 });
  });

  it("a reload mid-race: the rejoin's rgo picks next up from the stored run", () => {
    stored.set(STORE_KEYS.raceRun, JSON.stringify({ v: 1, race: "race-1", token: TOKEN, stamps: [stamp(0, T), stamp(1, T + 5000), stamp(2, T + 9000)], expiresAt: T + RUN_TTL_MS }));
    onRaceServer({ t: "rgo", stamp: stamp(0, T), now: T + 12_000 }, T + 12_000);
    expect(s().raceView).toMatchObject({ phase: "running", next: 3 });
    onRaceServer({ t: "rstamp", stamp: stamp(3, T + 14_000) }, T + 14_000);
    expect(run()!.stamps.map((x) => x.i)).toEqual([0, 1, 2, 3]);
  });

  it("race again: a new grid starts a new run with the same token", () => {
    onRaceServer(lobby(), T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 3000 }, T + 3000);
    onRaceServer({ t: "rresults", race: "race-1", rows: [], againBy: T + 20_000, now: T }, T);
    expect(stored.has(STORE_KEYS.raceRun)).toBe(false);
    onRaceServer({ t: "rgrid", race: "race-2", kind: "solo", slot: 0, goAt: T + 3000, now: T }, T);
    expect(run()).toEqual({ v: 1, race: "race-2", token: TOKEN, stamps: [], expiresAt: T + RUN_TTL_MS });
    expect(s().raceView).toMatchObject({ phase: "grid", race: "race-2" });
  });

  it("rresults with an own finish records the badge and the best, says the place and clears the run", async () => {
    onRaceServer(lobby(), T);
    onRaceServer({
      t: "rresults", race: "race-1", againBy: T + 20_000, now: T,
      rows: [{ place: 1, cc: "MY", timeMs: 44_000, rings: N, you: false }, { place: 2, cc: "ID", timeMs: 52_400, rings: N, you: true }],
    }, T);
    expect(s().raceView.phase).toBe("results");
    expect(s().broadcast?.text).toBe("RACE // P2 OF 2 · 0:52.4");
    expect(s().badges.map((b) => b.id)).toEqual(["ring"]);
    expect(s().raceBest).toBe(52.4);
    expect(stored.get(STORE_KEYS.raceBest)).toBe("52.4");
    expect(stored.has(STORE_KEYS.raceRun)).toBe(false);
  });

  it("rresults keeps a better best, and a DNF earns nothing", () => {
    useSpaceStore.setState({ raceBest: 40 });
    onRaceServer({ t: "rresults", race: "race-1", againBy: T, now: T, rows: [{ place: 1, cc: "ID", timeMs: 52_400, rings: N, you: true }] }, T);
    expect(s().raceBest).toBe(40);
    useSpaceStore.setState({ badges: [], raceBest: null });
    onRaceServer({ t: "rresults", race: "race-2", againBy: T, now: T, rows: [{ place: 1, cc: "ID", timeMs: null, rings: 7, you: true }] }, T);
    expect(s().broadcast?.text).toBe(`RACE // DNF · 7/${N} RINGS`);
    expect(s().badges).toEqual([]);
    expect(s().raceBest).toBeNull();
  });

  it("rerr expired, full and off go back to idle with their radio lines; rerr ring is ignored", () => {
    const lines: Record<string, string> = {
      expired: "RACE // THAT RACE HAS ENDED · THE START GATE IS STILL OPEN",
      full: "RACE // THE RACE IS FULL · TRY THE NEXT ONE",
      off: "RACE // RACING IS OFFLINE RIGHT NOW",
    };
    for (const reason of ["expired", "full", "off"] as const) {
      onRaceServer(lobby(), T);
      onRaceServer({ t: "rerr", reason }, T);
      expect(s().raceView).toEqual(RACE_IDLE);
      expect(s().broadcast?.text).toBe(lines[reason]);
    }
    onRaceServer(lobby(), T);
    useSpaceStore.setState({ broadcast: null });
    onRaceServer({ t: "rerr", reason: "ring" }, T);
    expect(s().raceView.phase).toBe("lobby");
    expect(s().broadcast).toBeNull();
  });

  it("back to idle turns live sky off again when racing turned it on", () => {
    useSpaceStore.setState({ liveSky: true, raceLiveSkyRestore: true });
    onRaceServer(lobby(), T);
    expect(s().liveSky).toBe(true);
    onRaceServer({ t: "rerr", reason: "expired" }, T);
    expect(s().liveSky).toBe(false);
    expect(s().raceLiveSkyRestore).toBe(false);
    expect(stored.get(STORE_KEYS.liveSky)).toBe("0");
  });

  it("back to idle leaves live sky alone when the pilot had it on", () => {
    onRaceServer(lobby(), T);
    onRaceServer({ t: "rerr", reason: "expired" }, T);
    expect(s().liveSky).toBe(true);
  });

  it("onRaceOver uploads the stored run once, and says so on the radio when it does not land", async () => {
    stored.set("fitz-beacon-api-dev", "https://api.example");
    const fetch = vi.fn(async () => new Response('{"ok":false,"reason":"late"}', { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    onRaceServer(lobby(), T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 3000 }, T + 3000);
    onRaceServer({ t: "rover", race: "race-1", uploadBy: T + 33_000, now: T + 3000 }, T + 3000);
    await onRaceOver("ghost");
    await onRaceOver("ghost");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/race/result");
    expect(JSON.parse(init.body as string)).toEqual({ race: "race-1", token: TOKEN, stamps: [stamp(0, T + 3000)], ghost: "ghost" });
    expect(s().broadcast?.text).toBe("RACE // RESULT NOT RECEIVED IN TIME");
  });

  it("onRaceOver says nothing when the upload lands", async () => {
    stored.set("fitz-beacon-api-dev", "https://api.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true,"entry":{}}', { status: 200 })));
    onRaceServer(lobby(), T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 3000 }, T + 3000);
    useSpaceStore.setState({ broadcast: null });
    await onRaceOver(null);
    expect(s().broadcast).toBeNull();
  });
});
