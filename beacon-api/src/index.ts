import { handleRequest, withListCache, type BeaconStore, type RequestLimiter, type StoredBeacon } from "./handler";
import { refuseLive, skyRequest, visitorKey, VISITOR_HEADER } from "./liveRoute";
import { newRoom, onJoin, onLeave, onMessage, onTrailing, randomPilotId, type Outgoing, type Pilot } from "./sky";
import { publicCountry } from "../../src/utils/liveSkyProtocol";

/**
 * Cloudflare Worker entry: binds the beacon handler to D1, and GET /live to
 * the Sky room. Deploy steps are in beacon-api/README.md.
 */

// The slice of the D1 API used here, declared locally so the repo needs no
// @cloudflare/workers-types dependency.
interface D1Result<T> { results: T[] }
interface D1RunResult { meta: { changes: number } }
interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1RunResult>;
}
interface D1Database { prepare(sql: string): D1Stmt }

// The slice of the Durable Objects and hibernatable WebSocket API used by Sky,
// declared locally for the same reason as D1 above.
interface HibernatableSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
interface DurableObjectState {
  acceptWebSocket(ws: HibernatableSocket): void;
  getWebSockets(): HibernatableSocket[];
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
}

interface Row { id: string; x: number; y: number; z: number; phrase: number; at: number; country: string | null; ip_hash: string }

function d1Store(db: D1Database): BeaconStore {
  const fromRow = (r: Row): StoredBeacon => ({
    id: r.id, x: r.x, y: r.y, z: r.z, phrase: r.phrase, at: r.at, country: r.country, ipHash: r.ip_hash,
  });
  return {
    async list(limit) {
      const { results } = await db.prepare("SELECT * FROM beacons ORDER BY at DESC LIMIT ?").bind(limit).all<Row>();
      return results.map(fromRow);
    },
    // One statement, so SQLite makes check-and-insert atomic: a parallel burst
    // cannot all pass the check before the first row lands.
    async insertIfAllowed(b, keySince, globalSince, globalMax) {
      const r = await db.prepare(
        `INSERT INTO beacons (id, x, y, z, phrase, at, country, ip_hash)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM beacons WHERE ip_hash = ? AND at >= ?)
           AND (SELECT COUNT(*) FROM beacons WHERE at >= ?) < ?`,
      ).bind(b.id, b.x, b.y, b.z, b.phrase, b.at, b.country, b.ipHash, b.ipHash, keySince, globalSince, globalMax).run();
      return r.meta.changes > 0;
    },
    // Walks the `at` index to the keep-th row instead of scanning a NOT IN set.
    async prune(keep) {
      await db.prepare("DELETE FROM beacons WHERE at < (SELECT at FROM beacons ORDER BY at DESC LIMIT 1 OFFSET ?)")
        .bind(keep - 1).run();
    },
  };
}

/** Per isolate: survives across requests, so repeat GETs skip D1 for 30s. */
let store: BeaconStore | null = null;

const origins = (env: Env) => env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname === "/live") {
      const refusal = await refuseLive(req, { allowedOrigins: origins(env), limiter: env.LIMITER });
      if (refusal) return refusal;
      const visitor = await visitorKey(req.headers.get("CF-Connecting-IP") ?? "unknown", env.IP_SALT ?? "");
      return env.SKY.getByName("sky").fetch(skyRequest(req, visitor));
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
 */
export class Sky {
  private ctx: DurableObjectState;
  private room = newRoom();
  private sockets = new Map<string, HibernatableSocket>();
  private trailing: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx;
    // Waking from hibernation: the sockets' attachments are the whole room.
    for (const ws of ctx.getWebSockets()) {
      const p = ws.deserializeAttachment() as Pilot | null;
      if (p) { this.room.pilots.push(p); this.sockets.set(p.id, ws); }
    }
  }

  async fetch(req: Request): Promise<Response> {
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

  webSocketMessage(ws: HibernatableSocket, message: string | ArrayBuffer): void {
    const id = (ws.deserializeAttachment() as Pilot | null)?.id;
    const pilot = this.room.pilots.find((p) => p.id === id);
    if (!pilot) return;
    const r = onMessage(this.room, pilot, message, Date.now());
    ws.serializeAttachment(pilot);
    if (r.close) {
      ws.close(1008, "too many messages");
      this.leave(ws);
      return;
    }
    this.deliver(r.out);
    if (r.trailingIn !== null && !this.trailing) {
      this.trailing = setTimeout(() => {
        this.trailing = null;
        this.deliver(onTrailing(this.room, Date.now()));
      }, r.trailingIn);
    }
  }

  webSocketClose(ws: HibernatableSocket): void { this.leave(ws); }
  webSocketError(ws: HibernatableSocket): void { this.leave(ws); }

  private leave(ws: HibernatableSocket) {
    const id = (ws.deserializeAttachment() as Pilot | null)?.id;
    if (!id) return;
    // Forget it in the attachment too: a room rebuilt while this socket is
    // still closing must not count the pilot again.
    ws.serializeAttachment(null);
    this.sockets.delete(id);
    this.deliver(onLeave(this.room, id, Date.now()));
  }

  private deliver(out: readonly Outgoing[]) {
    for (const o of out) {
      try { this.sockets.get(o.to)?.send(JSON.stringify(o.msg)); } catch { /* closing socket */ }
    }
  }
}
