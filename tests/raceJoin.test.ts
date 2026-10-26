import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useSpaceStore, flight } from "../src/store/spaceStore";
import {
  requestJoin, raceKey, onLiveSkyHello, watchRaceJoin, joinPending, startRaceLink, resetRaceJoin, nearStartGate, JOIN_TIMEOUT_MS,
} from "../src/utils/raceJoin";
import { onRaceServer, resetRaceController } from "../src/utils/raceController";
import { raceLink } from "../src/utils/raceLink";
import { RACE_IDLE, RUN_TTL_MS, type RaceView } from "../src/utils/raceSession";
import { STORE_KEYS } from "../src/store/persist";
import { START_GATE } from "../src/data/ringCourse";
import { JOIN_RADIUS } from "../src/utils/raceProtocol";
import { DESTINATIONS } from "../src/data/destinations";
import type { LiveSkyConnection } from "../src/utils/liveSkyConnection";

const T = 1_000_000;
const TOKEN = "0123456789abcdef0123456789abcdef";
const OFF_LINE = "RACE // RACING IS OFFLINE RIGHT NOW";
const s = () => useSpaceStore.getState();

let stored: Map<string, string>;
let sent: unknown[];
let connected: boolean;
let unwatch: () => void;

beforeEach(() => {
  vi.useFakeTimers({ now: T });
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => { stored.set(k, v); },
    removeItem: (k: string) => { stored.delete(k); },
  });
  sent = [];
  connected = true;
  raceLink.conn = {
    get connected() { return connected; },
    sendRace: (m: unknown) => { if (!connected) return false; sent.push(m); return true; },
  } as unknown as LiveSkyConnection;
  resetRaceJoin();
  resetRaceController();
  flight.racing = false;
  useSpaceStore.setState({
    raceView: RACE_IDLE, raceLiveSkyRestore: false, liveSky: true, liveSkySeen: true, broadcast: null, logbookLineAt: 0,
    isOrbitLocked: false, activeZone: null, isOrbitCooldown: false, openDossier: null,
  });
  unwatch = watchRaceJoin();
});

afterEach(() => {
  unwatch();
  raceLink.conn = null;
  resetRaceJoin();
  flight.racing = false;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const atGate = () => { flight.x = START_GATE.c.x; flight.y = START_GATE.c.y + JOIN_RADIUS - 1; flight.z = START_GATE.c.z; };
const farAway = () => { flight.x = START_GATE.c.x + JOIN_RADIUS + 1; flight.y = START_GATE.c.y; flight.z = START_GATE.c.z; };
const saveRun = (expiresAt = T + RUN_TTL_MS) =>
  stored.set(STORE_KEYS.raceRun, JSON.stringify({ v: 1, race: "race-1", token: TOKEN, kind: "public", stamps: [], expiresAt }));

describe("joining", () => {
  it("nearStartGate is JOIN_RADIUS from the gate's centre", () => {
    const c = START_GATE.c;
    expect(nearStartGate({ x: c.x, y: c.y, z: c.z + JOIN_RADIUS })).toBe(true);
    expect(nearStartGate({ x: c.x, y: c.y, z: c.z + JOIN_RADIUS + 0.01 })).toBe(false);
  });

  it("a first-time visitor with live sky off: it turns on, and no join goes out before the notice has played", () => {
    connected = false;
    useSpaceStore.setState({ liveSky: false, liveSkySeen: false });
    requestJoin();
    expect(s().liveSky).toBe(true);
    expect(s().raceLiveSkyRestore).toBe(true);
    expect(joinPending()).toBe(true);
    // Live sky connects (the notice is queued, not yet on the radio): still nothing.
    connected = true;
    onLiveSkyHello();
    expect(sent).toEqual([]);
    // The notice reaches the radio (Ghosts sets liveSkySeen): the join goes out.
    s().setLiveSkySeen(true);
    expect(sent).toEqual([{ t: "rjoin" }]);
    expect(joinPending()).toBe(false);
  });

  it("not connected within 10 s: the offline line, back to idle, live sky off again", () => {
    connected = false;
    useSpaceStore.setState({ liveSky: false });
    requestJoin();
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS - 1);
    expect(s().broadcast).toBeNull();
    vi.advanceTimersByTime(1);
    expect(s().broadcast?.text).toBe(OFF_LINE);
    expect(joinPending()).toBe(false);
    expect(s().raceView).toEqual(RACE_IDLE);
    expect(s().liveSky).toBe(false);
    expect(s().raceLiveSkyRestore).toBe(false);
  });

  it("connected but still waiting on the notice at 10 s: waits once more before giving up", () => {
    useSpaceStore.setState({ liveSkySeen: false });
    requestJoin();
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS);
    expect(joinPending()).toBe(true);
    expect(s().broadcast).toBeNull();
    s().setLiveSkySeen(true);
    expect(sent).toEqual([{ t: "rjoin" }]);
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS);
    expect(s().broadcast).toBeNull();
  });

  it("R: joins at the gate only, cancels a pending join, leaves a lobby", () => {
    farAway();
    raceKey();
    expect(sent).toEqual([]);
    atGate();
    connected = false;
    raceKey();
    expect(joinPending()).toBe(true);
    raceKey();
    expect(joinPending()).toBe(false);
    connected = true;
    raceKey();
    expect(sent).toEqual([{ t: "rjoin" }]);
    const lobby: RaceView = { phase: "lobby", race: "race-1", kind: "public", code: null, host: false, pilots: [{ cc: "ID", you: true }], startsAt: null };
    s().setRaceView(lobby);
    raceKey();
    expect(sent.at(-1)).toEqual({ t: "rleave" });
    expect(s().raceView).toEqual(RACE_IDLE);
    // Mid-race R does nothing: a stray key must not forfeit.
    s().setRaceView({ phase: "running", race: "race-1", kind: "public", next: 2, goAt: T, finalEndsAt: null, finished: false });
    const before = sent.length;
    raceKey();
    expect(sent.length).toBe(before);
  });
});

describe("R10: a reload or reconnect mid-race rejoins with the stored token", () => {
  it("live sky's hello with an unexpired run sends rjoin with the token, ahead of a pending invite code", () => {
    saveRun();
    connected = false;
    requestJoin({ t: "rjoin", code: "ABC234" });
    connected = true;
    onLiveSkyHello();
    expect(sent).toEqual([{ t: "rjoin", token: TOKEN }]);
    expect(joinPending()).toBe(false);
  });

  it("an expired or missing run: the hello sends nothing of its own; a pending join goes out", () => {
    saveRun(T - 1);
    onLiveSkyHello();
    expect(sent).toEqual([]);
    connected = false;
    requestJoin();
    connected = true;
    onLiveSkyHello();
    expect(sent).toEqual([{ t: "rjoin" }]);
  });

  it("waits for the notice too (consent): the rejoin goes out once it has played", () => {
    saveRun();
    useSpaceStore.setState({ liveSkySeen: false });
    onLiveSkyHello();
    expect(sent).toEqual([]);
    s().setLiveSkySeen(true);
    expect(sent).toEqual([{ t: "rjoin", token: TOKEN }]);
  });

  it("every reconnect rejoins again", () => {
    saveRun();
    onLiveSkyHello();
    onLiveSkyHello();
    expect(sent).toEqual([{ t: "rjoin", token: TOKEN }, { t: "rjoin", token: TOKEN }]);
  });

  it("a rejoin the room no longer knows (rerr expired) drops the run, so the next hello does not ask again", () => {
    saveRun();
    onLiveSkyHello();
    onRaceServer({ t: "rerr", reason: "expired" }, T);
    expect(stored.has(STORE_KEYS.raceRun)).toBe(false);
    onLiveSkyHello();
    expect(sent).toEqual([{ t: "rjoin", token: TOKEN }]);
  });
});

describe("the ?race= deep link", () => {
  it("drops the code from the URL and joins that race once live sky connects", () => {
    const replaceState = vi.fn();
    connected = false;
    startRaceLink({ search: "?race=ABC234&x=1", pathname: "/p/", hash: "#h" }, { state: null, replaceState });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/p/?x=1#h");
    expect(joinPending()).toBe(true);
    connected = true;
    onLiveSkyHello();
    expect(sent).toEqual([{ t: "rjoin", code: "ABC234" }]);
  });

  it("a bad code is dropped from the URL and joins nothing; no ?race= changes nothing", () => {
    const replaceState = vi.fn();
    startRaceLink({ search: "?race=abc", pathname: "/", hash: "" }, { state: null, replaceState });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/");
    expect(joinPending()).toBe(false);
    resetRaceJoin();
    const untouched = vi.fn();
    startRaceLink({ search: "?x=1", pathname: "/", hash: "" }, { state: null, replaceState: untouched });
    expect(untouched).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});

describe("R15: no docking while racing", () => {
  const dest = DESTINATIONS[0];

  it("setOrbitLocked refuses a lock while flight.racing or while the view is on the grid or running", () => {
    s().setActiveZone(dest.id);
    flight.racing = true;
    s().setOrbitLocked(true);
    expect(s().isOrbitLocked).toBe(false);
    flight.racing = false;
    s().setRaceView({ phase: "grid", race: "race-1", kind: "public", slot: 0, goAt: T + 3000 });
    s().setOrbitLocked(true);
    expect(s().isOrbitLocked).toBe(false);
    s().setRaceView(RACE_IDLE);
    s().setOrbitLocked(true);
    expect(s().isOrbitLocked).toBe(true);
  });

  it("a pilot docked or reading a dossier when the grid comes is released, so the frozen scene runs and places the ship", () => {
    s().setActiveZone(dest.id);
    s().setOrbitLocked(true);
    expect(s().isOrbitLocked).toBe(true);
    onRaceServer({ t: "rgrid", race: "race-1", kind: "public", slot: 1, goAt: T + 3000, now: T }, T);
    expect(s().isOrbitLocked).toBe(false);
    useSpaceStore.setState({ openDossier: "ruangrapi" });
    onRaceServer({ t: "rgrid", race: "race-2", kind: "public", slot: 0, goAt: T + 3000, now: T }, T);
    expect(s().openDossier).toBeNull();
  });
});
