import { describe, it, expect, beforeEach } from "vitest";
import {
  RACE_IDLE, raceReduce, syncWithRun, loadRun, withStamp, uploadRun, raceCodeFromUrl, RUN_TTL_MS,
  type RaceView, type RaceRun,
} from "../src/utils/raceSession";
import { RACE_LIMIT_MS, UPLOAD_WINDOW_MS, type RaceServerMessage, type Stamp } from "../src/utils/raceProtocol";
import { RING_GATES } from "../src/data/ringCourse";
import { LiveSkyConnection, type SocketLike } from "../src/utils/liveSkyConnection";
import type { ShipState } from "../src/utils/liveSkyProtocol";

const N = RING_GATES.length;
const TOKEN = "0123456789abcdef0123456789abcdef";
const SIG = "fedcba9876543210fedcba9876543210";
const stamp = (i: number, at: number, r = "race-1"): Stamp => ({ r, k: TOKEN, i, at, sig: SIG });

/** Server and local clocks agree unless a test says otherwise. */
const T = 1_000_000;
const lobbyMsg = (over: Partial<Extract<RaceServerMessage, { t: "rlobby" }>> = {}): RaceServerMessage => ({
  t: "rlobby", race: "race-1", kind: "public", code: null, host: false, token: TOKEN,
  pilots: [{ cc: "ID", you: true }, { cc: null, you: false }], startsAt: T + 12_000, now: T, ...over,
});
const gridMsg = (race = "race-1", now = T): RaceServerMessage => ({ t: "rgrid", race, kind: "public", slot: 1, goAt: now + 3000, now });
const running = (over: Partial<Extract<RaceView, { phase: "running" }>> = {}): RaceView =>
  ({ phase: "running", race: "race-1", kind: "public", next: 1, goAt: T, finalEndsAt: null, finished: false, ...over });

const reduceAll = (v: RaceView, ms: RaceServerMessage[], localNow = T) => ms.reduce((acc, m) => raceReduce(acc, m, localNow), v);

describe("raceReduce", () => {
  it("starts idle", () => {
    expect(RACE_IDLE).toEqual({ phase: "idle" });
  });

  it("rlobby → lobby", () => {
    expect(raceReduce(RACE_IDLE, lobbyMsg(), T)).toEqual({
      phase: "lobby", race: "race-1", kind: "public", code: null, host: false,
      pilots: [{ cc: "ID", you: true }, { cc: null, you: false }], startsAt: T + 12_000,
    });
    const v = raceReduce(RACE_IDLE, lobbyMsg({ startsAt: null, kind: "private", code: "ABC234", host: true }), T);
    expect(v).toMatchObject({ phase: "lobby", kind: "private", code: "ABC234", host: true, startsAt: null });
  });

  it("rgrid → grid", () => {
    const lobby = raceReduce(RACE_IDLE, lobbyMsg(), T);
    expect(raceReduce(lobby, gridMsg(), T)).toEqual({ phase: "grid", race: "race-1", kind: "public", slot: 1, goAt: T + 3000 });
  });

  it("rgo → running from the GO stamp, keeping the grid's kind", () => {
    const grid: RaceView = { phase: "grid", race: "race-1", kind: "solo", slot: 0, goAt: T };
    expect(raceReduce(grid, { t: "rgo", stamp: stamp(0, T), now: T + 50 }, T + 50)).toEqual({
      phase: "running", race: "race-1", kind: "solo", next: 1, goAt: T, finalEndsAt: null, finished: false,
    });
  });

  it("rstamp with i === next advances next; other rings and other races change nothing", () => {
    const v = running({ next: 3 });
    expect(raceReduce(v, { t: "rstamp", stamp: stamp(3, T + 9000) }, T)).toEqual(running({ next: 4 }));
    expect(raceReduce(v, { t: "rstamp", stamp: stamp(2, T + 9000) }, T)).toBe(v);
    expect(raceReduce(v, { t: "rstamp", stamp: stamp(5, T + 9000) }, T)).toBe(v);
    expect(raceReduce(v, { t: "rstamp", stamp: stamp(3, T + 9000, "race-2") }, T)).toBe(v);
  });

  it("rstamp with i === N sets finished", () => {
    const v = raceReduce(running({ next: N }), { t: "rstamp", stamp: stamp(N, T + 40_000) }, T);
    expect(v).toMatchObject({ phase: "running", finished: true, next: N + 1 });
  });

  it("rfinal sets the final call while running", () => {
    expect(raceReduce(running(), { t: "rfinal", endsAt: T + 30_000, now: T }, T)).toEqual(running({ finalEndsAt: T + 30_000 }));
  });

  it("rover → over, carrying whether the pilot finished", () => {
    expect(raceReduce(running({ finished: true, next: N + 1 }), { t: "rover", race: "race-1", uploadBy: T + 30_000, now: T }, T))
      .toEqual({ phase: "over", race: "race-1", uploadBy: T + 30_000, finished: true });
    expect(raceReduce(running(), { t: "rover", race: "race-1", uploadBy: T + 30_000, now: T }, T))
      .toEqual({ phase: "over", race: "race-1", uploadBy: T + 30_000, finished: false });
  });

  it("rresults → results", () => {
    const rows = [{ place: 1, cc: "ID", timeMs: 45_000, rings: N, you: true }];
    const over: RaceView = { phase: "over", race: "race-1", uploadBy: T, finished: true };
    expect(raceReduce(over, { t: "rresults", race: "race-1", rows, againBy: T + 20_000, now: T }, T))
      .toEqual({ phase: "results", race: "race-1", rows, againBy: T + 20_000 });
  });

  it("rerr expired, off and full go back to idle; ring and busy change nothing", () => {
    const lobby = raceReduce(RACE_IDLE, lobbyMsg(), T);
    for (const reason of ["expired", "off", "full"] as const) {
      expect(raceReduce(lobby, { t: "rerr", reason }, T)).toEqual(RACE_IDLE);
    }
    const v = running();
    expect(raceReduce(v, { t: "rerr", reason: "ring" }, T)).toBe(v);
    expect(raceReduce(v, { t: "rerr", reason: "busy" }, T)).toBe(v);
  });

  it("rwait changes nothing", () => {
    expect(raceReduce(RACE_IDLE, { t: "rwait", cc: "ID" }, T)).toBe(RACE_IDLE);
  });

  it("a solo finish (rstamp, rfinal, rover back to back) ends in over, and a late rerr ring keeps it there", () => {
    const v = reduceAll(running({ kind: "solo", next: N }), [
      { t: "rstamp", stamp: stamp(N, T + 45_000) },
      { t: "rfinal", endsAt: T + 75_000, now: T + 45_000 },
      { t: "rover", race: "race-1", uploadBy: T + 75_000, now: T + 45_000 },
      { t: "rerr", reason: "ring" },
    ]);
    // Reduced at local T: the upload window is 30 s from the message's own now.
    expect(v).toEqual({ phase: "over", race: "race-1", uploadBy: T + 30_000, finished: true });
  });

  it("race again: a new grid with a new race id and no lobby first", () => {
    const results: RaceView = { phase: "results", race: "race-1", rows: [], againBy: T + 20_000 };
    expect(raceReduce(results, gridMsg("race-2"), T)).toEqual({ phase: "grid", race: "race-2", kind: "public", slot: 1, goAt: T + 3000 });
  });

  it("rejoin resends are idempotent", () => {
    const lobby = raceReduce(RACE_IDLE, lobbyMsg(), T);
    expect(raceReduce(lobby, lobbyMsg(), T)).toEqual(lobby);
    const grid = raceReduce(lobby, gridMsg(), T);
    expect(raceReduce(grid, gridMsg(), T)).toEqual(grid);
    // Mid-race: the same start stamp again, then the final call again.
    const v = running({ next: 5, finalEndsAt: T + 30_000 });
    const again = reduceAll(v, [{ t: "rgo", stamp: stamp(0, T), now: T + 20_000 }, { t: "rfinal", endsAt: T + 30_000, now: T + 20_000 }], T + 20_000);
    expect(again).toEqual(v);
    const over: RaceView = { phase: "over", race: "race-1", uploadBy: T + 30_000, finished: true };
    expect(raceReduce(over, { t: "rover", race: "race-1", uploadBy: T + 30_000, now: T }, T)).toEqual(over);
  });

  it("a rejoin after a reload (idle) picks the race up from rgo", () => {
    expect(raceReduce(RACE_IDLE, { t: "rgo", stamp: stamp(0, T), now: T + 10_000 }, T + 10_000))
      .toMatchObject({ phase: "running", race: "race-1", next: 1, goAt: T, finished: false });
  });

  it("clock skew: server times come out as localNow + (serverTime - m.now)", () => {
    const local = 50_000;
    const now = local + 5 * 60_000; // the server's clock reads 5 minutes ahead
    const lobby = raceReduce(RACE_IDLE, lobbyMsg({ startsAt: now + 12_000, now }), local);
    expect(lobby).toMatchObject({ startsAt: local + 12_000 });
    const grid = raceReduce(lobby, { t: "rgrid", race: "race-1", kind: "public", slot: 0, goAt: now + 3000, now }, local);
    expect(grid).toMatchObject({ goAt: local + 3000 });
    // GO's message arrives 40 ms after the tick that stamped it.
    const run = raceReduce(grid, { t: "rgo", stamp: stamp(0, now + 3000), now: now + 3040 }, local + 3040);
    expect(run).toMatchObject({ goAt: local + 3000 });
    const fin = raceReduce(run, { t: "rfinal", endsAt: now + 50_000, now: now + 20_000 }, local + 20_000);
    expect(fin).toMatchObject({ finalEndsAt: local + 50_000 });
    const over = raceReduce(fin, { t: "rover", race: "race-1", uploadBy: now + 80_000, now: now + 50_000 }, local + 50_000);
    expect(over).toMatchObject({ uploadBy: local + 80_000 });
    const res = raceReduce(over, { t: "rresults", race: "race-1", rows: [], againBy: now + 100_000, now: now + 80_000 }, local + 80_000);
    expect(res).toMatchObject({ againBy: local + 100_000 });
  });
});

describe("syncWithRun", () => {
  const run: RaceRun = { v: 1, race: "race-1", token: TOKEN, stamps: [stamp(0, T), stamp(1, T + 5000), stamp(2, T + 9000)], expiresAt: T + RUN_TTL_MS };

  it("a reload mid-race picks next up from the stored stamps", () => {
    expect(syncWithRun(running(), run)).toEqual(running({ next: 3 }));
    const done = { ...run, stamps: Array.from({ length: N + 1 }, (_, i) => stamp(i, T + i * 4000)) };
    expect(syncWithRun(running(), done)).toEqual(running({ next: N + 1, finished: true }));
    const over: RaceView = { phase: "over", race: "race-1", uploadBy: T, finished: false };
    expect(syncWithRun(over, done)).toEqual({ ...over, finished: true });
  });

  it("takes the stored kind for a running view of the same race", () => {
    expect(syncWithRun(running(), { ...run, kind: "solo" })).toEqual(running({ next: 3, kind: "solo" }));
    expect(syncWithRun(running(), run)).toEqual(running({ next: 3 }));
    const v = running({ kind: "solo", next: 3 });
    expect(syncWithRun(v, { ...run, kind: "solo" })).toBe(v);
  });

  it("ignores another race's run and never moves next back", () => {
    const v = running({ next: 3 });
    expect(syncWithRun(v, { ...run, race: "race-2" })).toBe(v);
    expect(syncWithRun(v, null)).toBe(v);
    const ahead = running({ next: 6 });
    expect(syncWithRun(ahead, run)).toBe(ahead);
  });
});

describe("run storage", () => {
  const run: RaceRun = { v: 1, race: "race-1", token: TOKEN, stamps: [stamp(0, T)], expiresAt: T + RUN_TTL_MS };

  it("RUN_TTL_MS covers the race, the upload window and a minute", () => {
    expect(RUN_TTL_MS).toBe(RACE_LIMIT_MS + UPLOAD_WINDOW_MS + 60_000);
  });

  it("loadRun returns null for garbage, a wrong v, a bad stamp or a past expiresAt", () => {
    expect(loadRun(null, T)).toBeNull();
    expect(loadRun("{", T)).toBeNull();
    expect(loadRun('"run"', T)).toBeNull();
    expect(loadRun("[]", T)).toBeNull();
    expect(loadRun(JSON.stringify({ ...run, v: 2 }), T)).toBeNull();
    expect(loadRun(JSON.stringify({ ...run, token: "nope" }), T)).toBeNull();
    expect(loadRun(JSON.stringify({ ...run, race: "a|b" }), T)).toBeNull();
    expect(loadRun(JSON.stringify({ ...run, stamps: [{ ...stamp(0, T), sig: "x" }] }), T)).toBeNull();
    expect(loadRun(JSON.stringify({ ...run, stamps: "x" }), T)).toBeNull();
    expect(loadRun(JSON.stringify({ ...run, expiresAt: "soon" }), T)).toBeNull();
    expect(loadRun(JSON.stringify(run), run.expiresAt)).toBeNull();
    expect(loadRun(JSON.stringify(run), run.expiresAt - 1)).toEqual(run);
  });

  it("loadRun keeps a valid kind, and tolerates a missing or unknown one", () => {
    expect(loadRun(JSON.stringify({ ...run, kind: "solo" }), T)).toEqual({ ...run, kind: "solo" });
    expect(loadRun(JSON.stringify(run), T)).not.toHaveProperty("kind");
    expect(loadRun(JSON.stringify({ ...run, kind: "drag" }), T)).not.toHaveProperty("kind");
    expect(loadRun(JSON.stringify({ ...run, kind: "drag" }), T)).toEqual(run);
  });

  it("a reload keeps the stamps intact", () => {
    let r = run;
    for (let i = 1; i <= 4; i++) r = withStamp(r, stamp(i, T + i * 4000));
    const saved = JSON.stringify(r);
    const back = loadRun(saved, T + 20_000);
    expect(back).toEqual(r);
    expect(back!.stamps.map((s) => s.i)).toEqual([0, 1, 2, 3, 4]);
    expect(back!.stamps[3]).toEqual(stamp(3, T + 12_000));
  });

  it("withStamp replaces a stamp with the same i, keeps ring order and leaves the run untouched", () => {
    const a = withStamp(run, stamp(2, T + 9000));
    const b = withStamp(a, stamp(1, T + 5000));
    expect(b.stamps.map((s) => s.i)).toEqual([0, 1, 2]);
    const c = withStamp(b, stamp(1, T + 5500));
    expect(c.stamps.map((s) => s.at)).toEqual([T, T + 5500, T + 9000]);
    expect(run.stamps).toHaveLength(1);
    expect(b.stamps[1].at).toBe(T + 5000);
  });
});

describe("uploadRun", () => {
  const run: RaceRun = { v: 1, race: "race-1", token: TOKEN, stamps: [stamp(0, T), stamp(1, T + 5000)], expiresAt: T + RUN_TTL_MS };
  const calls: { url: string; init: RequestInit }[] = [];
  const replying = (status: number, body: unknown = {}) => (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

  beforeEach(() => { calls.length = 0; });

  it("posts { race, token, stamps } to /race/result, with the ghost only when there is one", async () => {
    expect(await uploadRun("https://api.example", run, null, replying(200, { ok: true, entry: {} }))).toBe("ok");
    expect(calls[0].url).toBe("https://api.example/race/result");
    expect(calls[0].init.method).toBe("POST");
    expect(new Headers(calls[0].init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ race: "race-1", token: TOKEN, stamps: run.stamps });
    await uploadRun("https://api.example", run, '{"v":1}', replying(200, { ok: true, entry: {} }));
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ race: "race-1", token: TOKEN, stamps: run.stamps, ghost: '{"v":1}' });
  });

  it("maps the replies", async () => {
    const base = "https://api.example";
    expect(await uploadRun(base, run, null, replying(409, { ok: false, reason: "late" }))).toBe("late");
    expect(await uploadRun(base, run, null, replying(400, { ok: false, reason: "sig" }))).toBe("rejected");
    expect(await uploadRun(base, run, null, replying(404, { ok: false, reason: "token" }))).toBe("rejected");
    expect(await uploadRun(base, run, null, replying(503))).toBe("failed");
    expect(await uploadRun(base, run, null, replying(413))).toBe("failed");
    const offline = (async () => { throw new TypeError("network"); }) as typeof fetch;
    expect(await uploadRun(base, run, null, offline)).toBe("failed");
  });

  it("fails without a fetch when the API is not configured", async () => {
    expect(await uploadRun("", run, null, replying(200))).toBe("failed");
    expect(calls).toHaveLength(0);
  });
});

describe("raceCodeFromUrl", () => {
  it("reads a valid invite code only", () => {
    expect(raceCodeFromUrl("?race=ABC234")).toBe("ABC234");
    expect(raceCodeFromUrl("?x=1&race=ABC234")).toBe("ABC234");
    expect(raceCodeFromUrl("?race=abc234")).toBeNull();
    expect(raceCodeFromUrl("?race=ABC23")).toBeNull();
    expect(raceCodeFromUrl("?race=ABC230")).toBeNull(); // 0 is a look-alike, never in a code
    expect(raceCodeFromUrl("")).toBeNull();
  });
});

// ---- the live-sky socket carries race messages -----------------------------

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open() { this.readyState = 1; this.onopen?.(); }
  serve(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
}

function connection() {
  const sockets: FakeSocket[] = [];
  const race: RaceServerMessage[] = [];
  let clock = 0;
  const conn = new LiveSkyConnection({
    url: "wss://sky.example/live",
    createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    now: () => clock,
    setTimer: () => 0,
    clearTimer: () => {},
    random: () => 0.5,
    onRace: (m) => race.push(m),
  });
  return { conn, sockets, race, advance: (ms: number) => { clock += ms; } };
}

const ME: ShipState = { p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock", ch: 0 };

describe("LiveSkyConnection race traffic", () => {
  it("hands a race message from the server to onRace, and nothing else", () => {
    const { conn, sockets, race } = connection();
    conn.setWanted(true);
    sockets[0].open();
    sockets[0].serve({ t: "hello", id: "me", peers: 0 });
    sockets[0].serve({ t: "rerr", reason: "full" });
    sockets[0].serve({ t: "rwait", cc: "ID" });
    sockets[0].serve({ t: "rbogus" });
    expect(race).toEqual([{ t: "rerr", reason: "full" }, { t: "rwait", cc: "ID" }]);
  });

  it("sendRace sends when open, and says false otherwise", () => {
    const { conn, sockets } = connection();
    expect(conn.sendRace({ t: "rjoin" })).toBe(false);
    conn.setWanted(true);
    expect(conn.sendRace({ t: "rjoin" })).toBe(false);
    sockets[0].open();
    expect(conn.sendRace({ t: "rring", i: 3 })).toBe(true);
    expect(sockets[0].sent).toEqual(['{"t":"rring","i":3}']);
  });

  it("while racing, tick sends poses with no other pilot in the sky", () => {
    const { conn, sockets, advance } = connection();
    conn.setWanted(true);
    sockets[0].open();
    sockets[0].serve({ t: "hello", id: "me", peers: 0 });
    advance(1000);
    conn.tick(ME);
    expect(sockets[0].sent).toHaveLength(0);
    conn.racing = true;
    conn.tick(ME);
    expect(sockets[0].sent).toHaveLength(1);
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({ t: "me", p: [1, 2, 3] });
  });
});
