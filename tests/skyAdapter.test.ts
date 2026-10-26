import { afterEach, describe, it, expect, vi } from "vitest";
import worker, { Sky } from "../beacon-api/src/index";
import type { Pilot } from "../beacon-api/src/sky";
import type { RaceRoom } from "../beacon-api/src/raceRoom";
import { RACE_CENTRES, RING_RADIUS } from "../src/data/ringCourse";
import { encodeGhost } from "../src/utils/race";
import {
  ALONE_MS, GRID_MS, LOBBY_COUNTDOWN_MS, RACE_COURSE_ID, RACE_SPEED, type RaceServerMessage, type Stamp,
} from "../src/utils/raceProtocol";
import { sqliteD1 } from "./helpers/sqliteD1";
import { ghostThrough } from "./helpers/raceLap";

/** A hibernatable socket as the Sky adapter sees it. */
class FakeSocket {
  attachment: unknown;
  sent: string[] = [];
  closedWith: number | null = null;
  constructor(attachment: unknown) { this.attachment = attachment; }
  send(data: string) { this.sent.push(data); }
  close(code?: number) { this.closedWith = code ?? null; }
  serializeAttachment(v: unknown) { this.attachment = v; }
  deserializeAttachment() { return this.attachment; }
}

const pilot = (id: string): Pilot => ({
  id, cc: "ID", last: { p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock", ch: 0 }, lastAt: Date.now(), recent: [], visitor: null,
});
const me = JSON.stringify({ t: "me", p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock" });

/**
 * The Durable Object state: the sockets, and a storage whose get returns a
 * structured clone of what was put (as the runtime's does). `alarms` logs
 * every setAlarm time, and null for each deleteAlarm; `puts` logs each put's key.
 */
function state(sockets: FakeSocket[], stored = new Map<string, unknown>()) {
  const alarms: (number | null)[] = [];
  const puts: string[] = [];
  return {
    stored, alarms, puts,
    acceptWebSocket() {},
    getWebSockets: () => sockets,
    storage: {
      get: async (k: string) => (stored.has(k) ? structuredClone(stored.get(k)) : undefined),
      put: async (k: string, v: unknown) => { puts.push(k); stored.set(k, structuredClone(v)); },
      setAlarm: async (at: number) => { alarms.push(at); },
      deleteAlarm: async () => { alarms.push(null); },
    },
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn(),
  };
}
/** Lets the constructor's storage load (and any un-awaited persist) finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function room(...ids: string[]) {
  const sockets = ids.map((id) => new FakeSocket(pilot(id)));
  const ctx = state(sockets);
  return { sky: new Sky(ctx as never, {} as never), sockets, ctx };
}

describe("Sky adapter", () => {
  it("a flooder is closed, forgotten in its attachment, and leaves exactly once", () => {
    const { sky, sockets: [a, b] } = room("a", "b");
    for (let i = 0; i < 11; i++) sky.webSocketMessage(a as never, me);
    expect(a.closedWith).toBe(1008);
    expect(a.attachment).toBeNull();
    const peersBefore = b.sent.filter((m) => m.includes('"t":"peers"')).length;
    sky.webSocketClose(a as never); // the runtime's own close event follows
    expect(b.sent.filter((m) => m.includes('"t":"peers"')).length).toBe(peersBefore);
  });
  it("a room rebuilt from attachments skips a pilot that already left", () => {
    const { sky, sockets } = room("a", "b");
    sky.webSocketClose(sockets[0] as never);
    const rebuilt = new Sky(state(sockets) as never, {} as never);
    rebuilt.webSocketMessage(sockets[1] as never, me);
    const snap = sockets[1].sent.map((m) => JSON.parse(m)).filter((m) => m.t === "snap").at(-1);
    expect(snap.ships.map((s: { id: string }) => s.id)).not.toContain("a");
  });
  it("a pilot restored from a pre-C2 attachment can still announce", () => {
    const { sky, sockets: [a, b] } = room("a", "b");
    sky.webSocketMessage(a as never, JSON.stringify({ t: "me", p: [1, 2, 3], q: [0, 0, 0, 1], plume: "stock", ch: 5 }));
    sky.webSocketMessage(a as never, '{"t":"charted"}');
    expect(b.sent.filter((m) => m === '{"t":"charted","cc":"ID"}')).toHaveLength(1);
    expect(a.sent.some((m) => m.includes('"t":"charted"'))).toBe(false);
  });
});

// ---- the ring race through the adapter -------------------------------------

const SECRET = "s".repeat(32);
const T0 = 1_760_000_000_000;
const N = RACE_CENTRES.length;
const gate = (i: number) => [...RACE_CENTRES[i % N]] as [number, number, number];
const legMs = (i: number) => {
  const [a, b] = [gate(i - 1), gate(i)];
  return Math.ceil((Math.max(0, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) - 2 * RING_RADIUS) / RACE_SPEED) * 1000);
};
const msgs = (s: FakeSocket) => s.sent.map((m) => JSON.parse(m) as { t: string } & Record<string, unknown>);
const race = (s: FakeSocket) => msgs(s).filter((m) => m.t.startsWith("r")) as RaceServerMessage[];
const last = <T extends RaceServerMessage["t"]>(s: FakeSocket, t: T) =>
  race(s).filter((m) => m.t === t).at(-1) as Extract<RaceServerMessage, { t: T }> | undefined;
const storedRoom = (ctx: ReturnType<typeof state>) => ctx.stored.get("race") as RaceRoom | undefined;
const at = (ms: number) => vi.setSystemTime(ms);
const poseAt = (i: number) => JSON.stringify({ t: "me", p: gate(i), q: [0, 0, 0, 1], plume: "stock" });

/** A Sky with a race secret and a D1 holding race_best. Pilots are connected sockets. */
function raceSky(ids: string[], opts: { secret?: string; stored?: Map<string, unknown> } = {}) {
  const sockets = ids.map((id) => new FakeSocket(pilot(id)));
  const ctx = state(sockets, opts.stored);
  const d1 = sqliteD1("beacon-api/schema.sql");
  const sky = new Sky(ctx as never, { DB: d1.db, RACE_SECRET: opts.secret ?? SECRET } as never);
  return { sky, sockets, ctx, d1 };
}

describe("Sky adapter: the ring race", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("routes race messages to the room, persists it, and sets the alarm to nextAlarm; deletes it once no race is left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    const { sky, sockets: [a], ctx } = raceSky(["a"]);
    await settle();
    await sky.webSocketMessage(a as never, '{"t":"rjoin"}');
    expect(last(a, "rlobby")).toMatchObject({ kind: "public", pilots: [{ cc: "ID", you: true }] });
    expect(storedRoom(ctx)!.races[0].racers.map((r) => r.pilot)).toEqual(["a"]);
    expect(ctx.alarms.at(-1)).toBe(T0 + ALONE_MS);
    await sky.webSocketMessage(a as never, '{"t":"rleave"}');
    expect(storedRoom(ctx)!.races).toEqual([]);
    expect(ctx.alarms.at(-1)).toBeNull();
  });

  it("a pilot leaving the sky leaves its race, and the room is persisted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    const { sky, sockets: [a, b], ctx } = raceSky(["a", "b"]);
    await settle();
    await sky.webSocketMessage(a as never, '{"t":"rjoin"}');
    await sky.webSocketMessage(b as never, '{"t":"rjoin"}');
    expect(ctx.alarms.at(-1)).toBe(T0 + LOBBY_COUNTDOWN_MS);
    await sky.webSocketClose(b as never);
    expect(storedRoom(ctx)!.races[0].racers.map((r) => r.pilot)).toEqual(["a"]);
    expect(last(a, "rlobby")!.pilots).toHaveLength(1);
    expect(ctx.alarms.at(-1)).toBe(T0 + ALONE_MS);
  });

  it("a Sky rebuilt after hibernation loads the race from storage, and the alarm carries it on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    const first = raceSky(["a", "b"]);
    await settle();
    await first.sky.webSocketMessage(first.sockets[0] as never, '{"t":"rjoin"}');
    await first.sky.webSocketMessage(first.sockets[1] as never, '{"t":"rjoin"}');
    at(T0 + LOBBY_COUNTDOWN_MS);
    await first.sky.alarm();
    const goAt = T0 + LOBBY_COUNTDOWN_MS + GRID_MS;
    expect(last(first.sockets[1], "rgrid")).toMatchObject({ slot: 1, goAt });
    expect(first.ctx.alarms.at(-1)).toBe(goAt);

    // Hibernation: a new instance over the same sockets and storage.
    const woken = new Sky(state(first.sockets, first.ctx.stored) as never, { DB: first.d1.db, RACE_SECRET: SECRET } as never);
    await settle();
    at(goAt);
    await woken.alarm();
    for (const s of first.sockets) expect(last(s, "rgo")!.stamp).toMatchObject({ i: 0, at: goAt });
    expect((first.ctx.stored.get("race") as RaceRoom).races[0].phase).toBe("running");
  });

  it("a stored racer whose socket is gone (a restart, not hibernation) is unbound on load", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    const first = raceSky(["a", "b"]);
    await settle();
    await first.sky.webSocketMessage(first.sockets[0] as never, '{"t":"rjoin"}');
    await first.sky.webSocketMessage(first.sockets[1] as never, '{"t":"rjoin"}');
    // Only a reconnected (with the same attachment, for the test); b's socket is gone.
    const ctx = state([first.sockets[0]], first.ctx.stored);
    new Sky(ctx as never, { DB: first.d1.db, RACE_SECRET: SECRET } as never);
    await settle();
    expect((ctx.stored.get("race") as RaceRoom).races[0].racers.map((r) => r.pilot)).toEqual(["a"]);
    expect(ctx.alarms.at(-1)).toBe(T0 + ALONE_MS);
  });

  it("without RACE_SECRET (or a short one) racing answers rerr off; live-sky poses still relay", async () => {
    for (const secret of ["", "x".repeat(31)]) {
      const { sky, sockets: [a, b] } = raceSky(["a", "b"], { secret });
      await settle();
      await sky.webSocketMessage(a as never, '{"t":"rjoin"}');
      expect(race(a)).toEqual([{ t: "rerr", reason: "off" }]);
      await sky.webSocketMessage(a as never, me);
      expect(msgs(b).some((m) => m.t === "snap")).toBe(true);
    }
  });

  it("signs a ring against the pose's server receive time: a stale pose is refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    const { sky, sockets: [a] } = raceSky(["a"]);
    await settle();
    await sky.webSocketMessage(a as never, '{"t":"rjoin"}');
    await sky.webSocketMessage(a as never, '{"t":"rsolo"}');
    at(T0 + GRID_MS);
    await sky.alarm();
    at(T0 + GRID_MS + legMs(1) + 200);
    await sky.webSocketMessage(a as never, poseAt(1));
    at(T0 + GRID_MS + legMs(1) + 2_000);
    await sky.webSocketMessage(a as never, '{"t":"rring","i":1}');
    expect(race(a).at(-1)).toEqual({ t: "rerr", reason: "ring" });
    await sky.webSocketMessage(a as never, poseAt(1));
    await sky.webSocketMessage(a as never, '{"t":"rring","i":1}');
    expect(race(a).at(-1)).toMatchObject({ t: "rstamp", stamp: { i: 1 } });
  });

  it("a solo lap end to end: stamps, upload through Sky.fetch, the best lap in D1, then results", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    const { sky, sockets: [a], ctx, d1 } = raceSky(["a"]);
    await settle();
    await sky.webSocketMessage(a as never, '{"t":"rjoin"}');
    const token = last(a, "rlobby")!.token;
    await sky.webSocketMessage(a as never, '{"t":"rsolo"}');
    const { race: raceId, goAt } = last(a, "rgrid")!;
    at(goAt);
    await sky.alarm();
    const stamps: Stamp[] = [last(a, "rgo")!.stamp];
    let t = goAt;
    for (let i = 1; i <= N; i++) {
      t += legMs(i) + 200;
      at(t);
      await sky.webSocketMessage(a as never, poseAt(i));
      await sky.webSocketMessage(a as never, JSON.stringify({ t: "rring", i }));
      stamps.push(last(a, "rstamp")!.stamp);
    }
    expect(stamps.map((s) => s.i)).toEqual([...Array(N + 1).keys()]);
    const over = last(a, "rover")!;
    expect(ctx.alarms.at(-1)).toBe(over.uploadBy);

    at(t + 1_000);
    const body = JSON.stringify({ race: raceId, token, stamps, ghost: encodeGhost(ghostThrough(stamps)) });
    const res = await sky.fetch(new Request("https://sky/race/result", { method: "POST", body }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(token);
    const timeMs = t - goAt;
    expect(JSON.parse(text)).toEqual({ ok: true, entry: { cc: "ID", timeMs, rings: N, lastAt: t } });
    expect(d1.sql.prepare("SELECT course, time_ms, cc FROM race_best").all()).toEqual([{ course: RACE_COURSE_ID, time_ms: timeMs, cc: "ID" }]);
    expect(storedRoom(ctx)!.races[0].racers[0].entry).toMatchObject({ timeMs });

    // A second upload for the token is a 409, and writes nothing.
    const again = await sky.fetch(new Request("https://sky/race/result", { method: "POST", body }));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: false, reason: "duplicate" });

    at(over.uploadBy);
    await sky.alarm();
    expect(last(a, "rresults")!.rows).toEqual([{ place: 1, cc: "ID", timeMs, rings: N, you: true }]);
  });

  it("a race message that changes nothing writes nothing: no put, no alarm", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    const { sky, sockets: [a, b], ctx } = raceSky(["a", "b"]);
    await settle();
    // b is in a lobby, so a race exists; a is in none.
    await sky.webSocketMessage(b as never, '{"t":"rjoin"}');
    const [puts, alarms] = [ctx.puts.length, ctx.alarms.length];
    for (const m of ['{"t":"rleave"}', '{"t":"ragain"}', '{"t":"rring","i":1}', '{"t":"rsolo"}', '{"t":"rstart"}']) {
      await sky.webSocketMessage(a as never, m);
    }
    expect(ctx.puts.length).toBe(puts);
    expect(ctx.alarms.length).toBe(alarms);
    // A refused upload changes nothing either.
    const res = await sky.fetch(new Request("https://sky/race/result", { method: "POST", body: '{"race":"r","token":"t","stamps":[]}' }));
    expect(res.status).not.toBe(200);
    expect(ctx.puts.length).toBe(puts);
    expect(ctx.alarms.length).toBe(alarms);
    // A real change still persists and re-arms.
    await sky.webSocketMessage(a as never, '{"t":"rjoin"}');
    expect(ctx.puts.length).toBe(puts + 1);
    expect(ctx.alarms.length).toBe(alarms + 1);
    expect(ctx.alarms.at(-1)).toBe(T0 + LOBBY_COUNTDOWN_MS);
    expect(storedRoom(ctx)!.races[0].racers.map((r) => r.pilot)).toEqual(["b", "a"]);
  });

  it("with RACE_SECRET missing, race messages and disconnects write nothing", async () => {
    const { sky, sockets: [a, b], ctx } = raceSky(["a", "b"], { secret: "" });
    await settle();
    for (const m of ['{"t":"rjoin"}', '{"t":"rinvite"}', '{"t":"rring","i":1}', '{"t":"rleave"}']) {
      await sky.webSocketMessage(a as never, m);
    }
    await sky.webSocketClose(b as never);
    expect(race(a).every((m) => m.t === "rerr")).toBe(true);
    expect(ctx.puts).toEqual([]);
    expect(ctx.alarms).toEqual([]);
  });

  it("a disconnect from a pilot in no race writes nothing, while a race exists", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    const { sky, sockets: [a, b], ctx } = raceSky(["a", "b"]);
    await settle();
    await sky.webSocketMessage(a as never, '{"t":"rjoin"}');
    const [puts, alarms] = [ctx.puts.length, ctx.alarms.length];
    await sky.webSocketClose(b as never);
    expect(ctx.puts.length).toBe(puts);
    expect(ctx.alarms.length).toBe(alarms);
  });

  it("an alarm that changes nothing re-arms without a put", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    const { sky, sockets: [a], ctx } = raceSky(["a"]);
    await settle();
    await sky.webSocketMessage(a as never, '{"t":"rjoin"}');
    const puts = ctx.puts.length;
    at(T0 + 1_000); // early: the lone pilot's 30 s isn't up
    await sky.alarm();
    expect(ctx.puts.length).toBe(puts);
    expect(ctx.alarms.at(-1)).toBe(T0 + ALONE_MS);
  });

  it("an upload that is not JSON is a 400 malformed", async () => {
    const { sky } = raceSky(["a"]);
    await settle();
    const res = await sky.fetch(new Request("https://sky/race/result", { method: "POST", body: "{nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: "malformed" });
  });
});

// ---- the Worker's routes ---------------------------------------------------

describe("Worker fetch: race routes", () => {
  const ORIGIN = "https://fitzfitz.github.io";
  function env(over: Record<string, unknown> = {}) {
    const forwarded: Request[] = [];
    const getByName = vi.fn(() => ({ fetch: async (r: Request) => { forwarded.push(r); return new Response('{"ok":false,"reason":"late"}', { status: 409 }); } }));
    return {
      env: { DB: sqliteD1("beacon-api/schema.sql").db, SKY: { getByName }, ALLOWED_ORIGINS: ORIGIN, IP_SALT: "pepper-pepper-pepper", ...over },
      forwarded, getByName,
    };
  }
  const post = (body: string) => new Request("https://api.example/race/result", {
    method: "POST", body, headers: { Origin: ORIGIN, "Content-Type": "application/json" },
  });

  it("GET /race/best reads race_best; with no row, timeMs is null", async () => {
    const { env: e } = env();
    const res = await worker.fetch(new Request("https://api.example/race/best", { headers: { Origin: ORIGIN } }), e as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ course: RACE_COURSE_ID, timeMs: null });
  });
  it("POST /race/result forwards the raw body to the Sky room and passes its reply through", async () => {
    const { env: e, forwarded, getByName } = env({ RACE_SECRET: SECRET });
    const body = '{"race":"r","token":"t","stamps":[]}';
    const res = await worker.fetch(post(body), e as never);
    expect(getByName).toHaveBeenCalledWith("sky");
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].url).toBe("https://sky/race/result");
    expect(forwarded[0].method).toBe("POST");
    expect(await forwarded[0].text()).toBe(body);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, reason: "late" });
  });
  it("without a usable RACE_SECRET, POST /race/result is 503 while bottles still work", async () => {
    const { env: e, forwarded } = env({ RACE_SECRET: "short" });
    expect((await worker.fetch(post("{}"), e as never)).status).toBe(503);
    expect(forwarded).toEqual([]);
    const beacons = await worker.fetch(new Request("https://api.example/beacons", { headers: { Origin: ORIGIN } }), e as never);
    expect(beacons.status).toBe(200);
  });
});
