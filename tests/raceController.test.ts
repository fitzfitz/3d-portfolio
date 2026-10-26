import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSpaceStore } from "../src/store/spaceStore";
import { onRaceServer, onRaceOver, resetRaceController, leaveRace, watchRaceOver, UPLOAD_RETRY_MS } from "../src/utils/raceController";
import { raceLink } from "../src/utils/raceLink";
import type { LiveSkyConnection } from "../src/utils/liveSkyConnection";
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
    expect(run()).toEqual({ v: 1, race: "race-1", token: TOKEN, kind: "public", stamps: [], expiresAt: T + RUN_TTL_MS });
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

  it("the run keeps the race's kind: the lobby's, then the grid's (a lone pilot's race turns solo)", () => {
    onRaceServer(lobby(), T);
    expect(run()!.kind).toBe("public");
    onRaceServer({ t: "rgrid", race: "race-1", kind: "solo", slot: 0, goAt: T + 3000, now: T }, T);
    expect(run()!.kind).toBe("solo");
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 3000 }, T + 3000);
    expect(run()!.kind).toBe("solo");
    expect(run()!.stamps.map((x) => x.i)).toEqual([0]);
  });

  it("a solo race resumed after a reload stays solo: the rejoin's rgo on an idle view takes the stored kind", () => {
    stored.set(STORE_KEYS.raceRun, JSON.stringify({ v: 1, race: "race-1", token: TOKEN, kind: "solo", stamps: [stamp(0, T), stamp(1, T + 5000)], expiresAt: T + RUN_TTL_MS }));
    onRaceServer({ t: "rgo", stamp: stamp(0, T), now: T + 8000 }, T + 8000);
    expect(s().raceView).toMatchObject({ phase: "running", kind: "solo", next: 2 });
  });

  it("a stored run from before kinds were kept resumes as public", () => {
    stored.set(STORE_KEYS.raceRun, JSON.stringify({ v: 1, race: "race-1", token: TOKEN, stamps: [stamp(0, T)], expiresAt: T + RUN_TTL_MS }));
    onRaceServer({ t: "rgo", stamp: stamp(0, T), now: T + 8000 }, T + 8000);
    expect(s().raceView).toMatchObject({ phase: "running", kind: "public" });
  });

  it("race again: a new grid starts a new run with the same token", () => {
    onRaceServer(lobby(), T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 3000 }, T + 3000);
    onRaceServer({ t: "rresults", race: "race-1", rows: [], againBy: T + 20_000, now: T }, T);
    expect(stored.has(STORE_KEYS.raceRun)).toBe(false);
    onRaceServer({ t: "rgrid", race: "race-2", kind: "solo", slot: 0, goAt: T + 3000, now: T }, T);
    expect(run()).toEqual({ v: 1, race: "race-2", token: TOKEN, kind: "solo", stamps: [], expiresAt: T + RUN_TTL_MS });
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

  /** A finished solo lap, over with the upload window open until `uploadBy`. */
  function overAt(uploadBy: number) {
    stored.set("fitz-beacon-api-dev", "https://api.example");
    onRaceServer(lobby(), T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T), now: T }, T);
    onRaceServer({ t: "rover", race: "race-1", uploadBy, now: T }, T);
    useSpaceStore.setState({ broadcast: null });
  }
  const replies = (...statuses: number[]) => {
    const f = vi.fn(async () => new Response("{}", { status: statuses.shift() ?? 500 }));
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("onRaceOver retries a failed upload once while the window is open", async () => {
    overAt(T + 30_000);
    const f = replies(503, 200);
    const p = onRaceOver(null);
    await vi.advanceTimersByTimeAsync(UPLOAD_RETRY_MS);
    await p;
    expect(f).toHaveBeenCalledTimes(2);
    expect(s().broadcast).toBeNull();
  });

  it("onRaceOver retries once only, then says the result was lost", async () => {
    overAt(T + 30_000);
    const f = replies(503, 503, 200);
    const p = onRaceOver(null);
    await vi.advanceTimersByTimeAsync(UPLOAD_RETRY_MS * 3);
    await p;
    expect(f).toHaveBeenCalledTimes(2);
    expect(s().broadcast?.text).toBe("RACE // RESULT NOT RECEIVED IN TIME");
  });

  it("onRaceOver does not retry once the window has closed", async () => {
    overAt(T + UPLOAD_RETRY_MS - 1);
    const f = replies(503, 200);
    const p = onRaceOver(null);
    await vi.advanceTimersByTimeAsync(UPLOAD_RETRY_MS);
    await p;
    expect(f).toHaveBeenCalledTimes(1);
    expect(s().broadcast?.text).toBe("RACE // RESULT NOT RECEIVED IN TIME");
  });

  it("leaveRace sends rleave, drops the run and goes back to idle", () => {
    const sent: unknown[] = [];
    raceLink.conn = { sendRace: (m: unknown) => { sent.push(m); return true; } } as unknown as LiveSkyConnection;
    try {
      onRaceServer(lobby(), T);
      onRaceServer({ t: "rgo", stamp: stamp(0, T), now: T }, T);
      leaveRace();
      expect(sent).toEqual([{ t: "rleave" }]);
      expect(stored.has(STORE_KEYS.raceRun)).toBe(false);
      expect(s().raceView).toEqual(RACE_IDLE);
    } finally {
      raceLink.conn = null;
    }
  });

  it("watchRaceOver uploads at over without any frame, once per race", () => {
    const over = vi.fn(async () => {});
    const ghostFor = vi.fn(() => "path");
    const stop = watchRaceOver(ghostFor, over);
    try {
      onRaceServer(lobby(), T);
      onRaceServer({ t: "rgo", stamp: stamp(0, T), now: T }, T);
      expect(over).not.toHaveBeenCalled();
      onRaceServer({ t: "rover", race: "race-1", uploadBy: T + 30_000, now: T }, T);
      expect(over).toHaveBeenCalledTimes(1);
      expect(over).toHaveBeenCalledWith("path");
      expect(ghostFor).toHaveBeenCalledWith(expect.objectContaining({ phase: "over", race: "race-1" }));
      // A resent rover changes the view's uploadBy; still one upload for the race.
      onRaceServer({ t: "rover", race: "race-1", uploadBy: T + 31_000, now: T }, T);
      expect(over).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
    onRaceServer({ t: "rover", race: "race-2", uploadBy: T + 30_000, now: T }, T);
    expect(over).toHaveBeenCalledTimes(1);
  });

  it("watchRaceOver handles a view already over when it starts", () => {
    useSpaceStore.setState({ raceView: { phase: "over", race: "race-1", uploadBy: T + 30_000, finished: false } });
    const over = vi.fn(async () => {});
    const stop = watchRaceOver(() => null, over);
    stop();
    expect(over).toHaveBeenCalledWith(null);
  });

  it("onRaceOver never retries late or rejected", async () => {
    for (const status of [409, 400, 404]) {
      resetRaceController();
      overAt(T + 30_000);
      const f = replies(status, 200);
      const p = onRaceOver(null);
      await vi.advanceTimersByTimeAsync(UPLOAD_RETRY_MS);
      await p;
      expect(f, String(status)).toHaveBeenCalledTimes(1);
      expect(s().broadcast?.text).toBe("RACE // RESULT NOT RECEIVED IN TIME");
    }
  });
});

describe("raceController radio copy (Task 7)", () => {
  const grid = (kind: "public" | "solo" = "public", race = "race-1"): RaceServerMessage =>
    ({ t: "rgrid", race, kind, slot: 0, goAt: T + 3000, now: T });
  const text = () => s().broadcast?.text ?? null;

  it("rwait: who is waiting at the gate, heard only off a race", () => {
    onRaceServer({ t: "rwait", cc: "ID" }, T);
    expect(text()).toBe("RACE // A PILOT FROM ID IS WAITING AT THE START GATE");
    onRaceServer({ t: "rwait", cc: null }, T);
    expect(text()).toBe("RACE // A PILOT FROM DEEP SPACE IS WAITING AT THE START GATE");
    onRaceServer(lobby(), T);
    useSpaceStore.setState({ broadcast: null });
    onRaceServer({ t: "rwait", cc: "MY" }, T);
    expect(s().broadcast).toBeNull();
  });

  it("a solo grid says there are no rivals, once per race", () => {
    onRaceServer(lobby(), T);
    onRaceServer(grid("solo"), T);
    expect(text()).toBe("RACE // NO RIVALS ONLINE · RACING THE BEST LAP");
    useSpaceStore.setState({ broadcast: null });
    onRaceServer(grid("solo"), T);
    expect(s().broadcast).toBeNull();
    onRaceServer(grid("public", "race-2"), T);
    expect(s().broadcast).toBeNull();
  });

  it("GO from the grid, not from a rejoin's rgo", () => {
    onRaceServer(lobby(), T);
    onRaceServer(grid(), T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 3000 }, T + 3000);
    expect(text()).toBe(`RACE // GO · ${N} RINGS · NORMAL WARP ONLY`);
    useSpaceStore.setState({ broadcast: null, raceView: RACE_IDLE });
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 9000 }, T + 9000);
    expect(s().raceView.phase).toBe("running");
    expect(s().broadcast).toBeNull();
  });

  it("FINAL CALL once, and not in a race of one", () => {
    onRaceServer(lobby(), T);
    onRaceServer(grid(), T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000), now: T + 3000 }, T + 3000);
    onRaceServer({ t: "rfinal", endsAt: T + 60_000, now: T + 30_000 }, T + 30_000);
    expect(text()).toBe("RACE // FINAL CALL · 30 SECONDS");
    useSpaceStore.setState({ broadcast: null });
    onRaceServer({ t: "rfinal", endsAt: T + 60_000, now: T + 31_000 }, T + 31_000);
    expect(s().broadcast).toBeNull();
    useSpaceStore.setState({ raceView: RACE_IDLE });
    onRaceServer(grid("solo", "race-2"), T);
    onRaceServer({ t: "rgo", stamp: stamp(0, T + 3000, "race-2"), now: T + 3000 }, T + 3000);
    useSpaceStore.setState({ broadcast: null });
    onRaceServer({ t: "rfinal", endsAt: T + 60_000, now: T + 30_000 }, T + 30_000);
    expect(s().broadcast).toBeNull();
  });

  it("rerr busy: the race is open in another tab; this tab keeps its view", () => {
    onRaceServer(lobby(), T);
    onRaceServer({ t: "rerr", reason: "busy" }, T);
    expect(text()).toBe("RACE // THIS RACE IS OPEN IN ANOTHER TAB");
    expect(s().raceView.phase).toBe("lobby");
  });
});
