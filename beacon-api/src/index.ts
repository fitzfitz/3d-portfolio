import { handleRequest, withListCache, type BeaconStore, type RequestLimiter } from "./handler";
import { d1Store, type D1Database } from "./d1Store";
import { handleContent, withContentCache, CONTENT_CACHE_MS, type ContentStore } from "./content";
import { refuseLive, skyRequest, visitorKey, VISITOR_HEADER } from "./liveRoute";
import { newRoom, onJoin, onLeave, onMessage, onTrailing, randomPilotId, type Outgoing, type Pilot } from "./sky";
import {
  newRaceRoom, nextAlarm, onRaceMessage, onRacePilotLeft, onRaceTick, onRaceUpload, type RaceCtx, type RaceRoom,
} from "./raceRoom";
import {
  bestCandidate, handleRaceHttp, maybeStoreBest, raceSecret, readBestLap, uploadReply, withBestCache, type BestLap,
} from "./raceHttp";
import { publicCountry } from "../../src/utils/liveSkyProtocol";

/**
 * Cloudflare Worker entry: binds the beacon handler and GET /content to D1,
 * GET /live to the Sky room, and the ring race's GET /race/best and
 * POST /race/result (raceHttp.ts) to D1 and the Sky room. Deploy steps are in
 * beacon-api/README.md.
 */

// The slice of the Durable Objects and hibernatable WebSocket API used by Sky,
// declared locally so the repo needs no @cloudflare/workers-types dependency
// (as with D1, in d1Store.ts).
interface HibernatableSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
interface DurableObjectState {
  acceptWebSocket(ws: HibernatableSocket): void;
  getWebSockets(): HibernatableSocket[];
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}
interface DurableObjectNamespace { getByName(name: string): { fetch(req: Request): Promise<Response> } }
declare const WebSocketPair: { new (): { 0: HibernatableSocket; 1: HibernatableSocket } };

interface Env {
  DB: D1Database;
  /** The live sky room (Sky, below; [[durable_objects.bindings]] in wrangler.toml). */
  SKY: DurableObjectNamespace;
  /** Workers Rate Limiting binding ([[ratelimits]] in wrangler.toml). */
  LIMITER?: RequestLimiter;
  /** Comma-separated origins allowed to read and drop, e.g. the Pages and Cloudflare hosts. */
  ALLOWED_ORIGINS: string;
  /** Secret (wrangler secret put IP_SALT), 16+ chars or POSTs fail closed. HMAC key for IP hashes; rotate to forget them. */
  IP_SALT: string;
  /** Secret (wrangler secret put RACE_SECRET), 32+ chars or racing fails closed. HMAC key for ring stamps. */
  RACE_SECRET?: string;
}

/**
 * The content tables (beacon-api/content.sql), with an explicit column list:
 * it is the wire contract src/utils/contentParse.ts validates. Missing tables
 * throw, which handleContent turns into a 503 and the site into its bundled
 * content.
 */
function d1Content(db: D1Database): ContentStore {
  return {
    async read() {
      const [projects, career] = await Promise.all([
        db.prepare("SELECT id, sort, title, role, duration, short, description, tech, color, repo FROM projects ORDER BY sort, id")
          .all<Record<string, unknown>>(),
        db.prepare('SELECT id, sort, role, company, note, start, "end", employment, location, summary FROM career ORDER BY sort, id')
          .all<Record<string, unknown>>(),
      ]);
      return { projects: projects.results, career: career.results };
    },
  };
}

/** Per isolate: survives across requests, so repeat GETs skip D1 for 30s. */
let store: BeaconStore | null = null;
/** Per isolate, like `store`: repeat GET /content skips D1 for CONTENT_CACHE_MS. */
let content: ContentStore | null = null;
/** Per isolate, like `store`: repeat GET /race/best skips D1 for 30s (a new best shows up to 30s late). */
let best: (() => Promise<BestLap | null>) | null = null;

const origins = (env: Env) => env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    best ??= withBestCache(() => readBestLap(env.DB), 30_000, Date.now);
    const race = await handleRaceHttp(req, {
      limiter: env.LIMITER,
      allowedOrigins: origins(env),
      secret: raceSecret(env.RACE_SECRET),
      readBest: best,
      forwardResult: (body) => env.SKY.getByName("sky").fetch(new Request("https://sky/race/result", { method: "POST", body })),
    });
    if (race) return race;
    if (new URL(req.url).pathname === "/live") {
      const refusal = await refuseLive(req, { allowedOrigins: origins(env), limiter: env.LIMITER });
      if (refusal) return refusal;
      const visitor = await visitorKey(req.headers.get("CF-Connecting-IP") ?? "unknown", env.IP_SALT ?? "");
      return env.SKY.getByName("sky").fetch(skyRequest(req, visitor));
    }
    if (new URL(req.url).pathname === "/content") {
      content ??= withContentCache(d1Content(env.DB), CONTENT_CACHE_MS, Date.now);
      return handleContent(req, { store: content, limiter: env.LIMITER, allowedOrigins: origins(env) });
    }
    store ??= withListCache(d1Store(env.DB), 30_000, Date.now);
    return handleRequest(req, {
      store,
      limiter: env.LIMITER,
      allowedOrigins: origins(env),
      salt: env.IP_SALT,
      now: () => Date.now(),
    });
  },
};

/**
 * The live sky room: one Durable Object of hibernatable WebSockets. With
 * nobody moving it gets no events and hibernates, so an empty or solo sky
 * costs nothing. The room logic lives in sky.ts; this is the adapter.
 *
 * It also runs the ring races (raceRoom.ts). The race room is the one thing
 * stored: it is put only when an event changed it (a no-op message writes
 * nothing, so a flood can't burn the daily write quota), and an alarm at
 * nextAlarm() carries it on through hibernation.
 */
export class Sky {
  private ctx: DurableObjectState;
  private env: Env;
  private room = newRoom();
  private race: RaceRoom = newRaceRoom();
  private secret: string | null;
  private sockets = new Map<string, HibernatableSocket>();
  private trailing: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.secret = raceSecret(env.RACE_SECRET);
    // Waking from hibernation: the sockets' attachments are the whole room.
    for (const ws of ctx.getWebSockets()) {
      const p = ws.deserializeAttachment() as Pilot | null;
      if (p) { this.room.pilots.push(p); this.sockets.set(p.id, ws); }
    }
    // The race room is stored; no event runs until it is loaded.
    void ctx.blockConcurrencyWhile(async () => {
      this.race = (await ctx.storage.get<RaceRoom>("race")) ?? newRaceRoom();
      // After a restart (not a hibernation) the old sockets are gone: their
      // racers are unbound, as if they had left, and may rejoin by token.
      const here = new Set(this.room.pilots.map((p) => p.id));
      const gone = new Set(this.race.races.flatMap((r) => r.racers.map((x) => x.pilot)).filter((id) => id !== null && !here.has(id)));
      if (gone.size === 0) return;
      for (const id of gone) this.deliver(onRacePilotLeft(this.race, id!, this.raceCtx()).out);
      await this.persistRace();
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (new URL(req.url).pathname === "/race/result" && req.method === "POST") return this.raceResult(req);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    const joined = onJoin(this.room, randomPilotId(), publicCountry(req.headers.get("CF-IPCountry")), Date.now(),
      req.headers.get(VISITOR_HEADER));
    if (!joined.ok) {
      // No attachment: webSocketClose ignores this socket.
      server.send(JSON.stringify(joined.out));
      server.close(1013, "full");
    } else {
      server.serializeAttachment(joined.pilot);
      this.sockets.set(joined.pilot.id, server);
      this.deliver(joined.out);
    }
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async webSocketMessage(ws: HibernatableSocket, message: string | ArrayBuffer): Promise<void> {
    const id = (ws.deserializeAttachment() as Pilot | null)?.id;
    const pilot = this.room.pilots.find((p) => p.id === id);
    if (!pilot) return;
    const r = onMessage(this.room, pilot, message, Date.now());
    ws.serializeAttachment(pilot);
    if (r.close) {
      ws.close(1008, "too many messages");
      await this.leave(ws);
      return;
    }
    this.deliver(r.out);
    if (r.trailingIn !== null && !this.trailing) {
      this.trailing = setTimeout(() => {
        this.trailing = null;
        this.deliver(onTrailing(this.room, Date.now()));
      }, r.trailingIn);
    }
    if (r.race) {
      const before = this.raceSnapshot();
      this.deliver((await onRaceMessage(this.race, pilot.id, pilot.cc, r.race, this.raceCtx())).out);
      await this.persistIfChanged(before);
    }
  }

  webSocketClose(ws: HibernatableSocket): Promise<void> { return this.leave(ws); }
  webSocketError(ws: HibernatableSocket): Promise<void> { return this.leave(ws); }

  /** A race deadline (nextAlarm): lobby countdowns, GO, the final call, the upload window, race again. */
  async alarm(): Promise<void> {
    const before = this.raceSnapshot();
    this.deliver((await onRaceTick(this.race, this.raceCtx())).out);
    // The runtime clears an alarm as it fires, so a tick that changed nothing still re-arms.
    if (this.raceSnapshot() !== before) await this.persistRace();
    else await this.armRaceAlarm();
  }

  private async leave(ws: HibernatableSocket): Promise<void> {
    const id = (ws.deserializeAttachment() as Pilot | null)?.id;
    if (!id) return;
    // Forget it in the attachment too: a room rebuilt while this socket is
    // still closing must not count the pilot again.
    ws.serializeAttachment(null);
    this.sockets.delete(id);
    this.deliver(onLeave(this.room, id, Date.now()));
    // A pilot in no race changes nothing, so the common disconnect writes nothing.
    if (this.race.races.length === 0) return;
    const before = this.raceSnapshot();
    this.deliver(onRacePilotLeft(this.race, id, this.raceCtx()).out);
    await this.persistIfChanged(before);
  }

  /** POST /race/result from the Worker: the upload, then (on a finished 200) the best lap. */
  private async raceResult(req: Request): Promise<Response> {
    const raw = await req.text();
    let body: unknown = null;
    try { body = JSON.parse(raw); } catch { /* onRaceUpload answers 400 malformed */ }
    const before = this.raceSnapshot();
    const res = await onRaceUpload(this.race, body, this.raceCtx());
    // Only a change is stored (a 200 sets the racer's entry); a refusal writes nothing.
    await this.persistIfChanged(before);
    const best = bestCandidate(body, res);
    if (best) {
      try {
        await maybeStoreBest(this.env.DB, best.entry, best.stamps, best.ghost, best.cc, Date.now());
      } catch (e) {
        // The result stands without it; the best lap is a bonus.
        console.error("race_best write failed", e);
      }
    }
    return uploadReply(res);
  }

  /** The race room's view of this sky. A pose's time is when the room received it, never the client's. */
  private raceCtx(): RaceCtx {
    return {
      now: Date.now(),
      secret: this.secret,
      poseOf: (id) => {
        const p = this.room.pilots.find((x) => x.id === id);
        return p?.last ? { p: p.last.p, at: p.lastAt } : null;
      },
      pilotIds: () => this.room.pilots.map((p) => p.id),
    };
  }

  /** The race room as plain JSON, to tell whether an event changed it. The room is a few KB. */
  private raceSnapshot(): string { return JSON.stringify(this.race); }

  /** Stores the room (and re-arms) only if it differs from `before`: a no-op writes nothing. */
  private async persistIfChanged(before: string): Promise<void> {
    if (this.raceSnapshot() !== before) await this.persistRace();
  }

  /** Stores the race room and points the alarm at its next deadline (or clears it). */
  private async persistRace(): Promise<void> {
    await this.ctx.storage.put("race", this.race);
    await this.armRaceAlarm();
  }

  /** Points the alarm at the room's next deadline, or clears it. */
  private async armRaceAlarm(): Promise<void> {
    const at = nextAlarm(this.race);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  private deliver(out: readonly Outgoing[]) {
    for (const o of out) {
      try { this.sockets.get(o.to)?.send(JSON.stringify(o.msg)); } catch { /* closing socket */ }
    }
  }
}
