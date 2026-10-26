import { GhostBuffer, markSent, newSendState, parseServerMessage, shouldSend } from "./liveSky";
import { roundState, CHART_TOTAL, type ShipState } from "./liveSkyProtocol";
import { parseRaceServer, type RaceClientMessage, type RaceServerMessage } from "./raceProtocol";

/**
 * The live sky socket's lifecycle (spec §4.2): connect when wanted, back off on
 * failure, let go of a long-hidden tab, and stop for good on `full`. A plain
 * class read per frame through a ref, never React state.
 */

export interface SocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export interface ConnectionDeps {
  url: string;
  createSocket(url: string): SocketLike;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  random(): number;
  /** Another pilot just charted every world (the room's relayed shout-out). */
  onCharted?: (cc: string | null) => void;
  /** A ring-race message from the room (raceController.ts onRaceServer). */
  onRace?: (m: RaceServerMessage) => void;
}

const OPEN = 1;
export const HIDDEN_GRACE_MS = 60_000;
/** A connection that lasted this long resets the backoff. */
export const STABLE_MS = 30_000;
/** After `full`, try again this much later: the room may have freed up. */
export const FULL_RETRY_MS = 5 * 60_000;

/** 2 s doubling to 60 s, ±25% jitter so a room restart doesn't get every client back at once. */
export function backoffMs(attempt: number, random: number): number {
  return Math.min(60_000, 2000 * 2 ** attempt * (0.75 + random * 0.5));
}

export class LiveSkyConnection {
  readonly ghosts = new GhostBuffer();
  peers = 0;
  /** The room was full: no retries until FULL_RETRY_MS has passed. */
  full = false;
  /** Pose messages sent (tests and the e2e probe read it). */
  sent = 0;
  /**
   * In a race (the scene sets it from the grid to the end): poses go out even
   * with no other pilot in the sky, since the room signs rings against them.
   */
  racing = false;

  private deps: ConnectionDeps;
  private socket: SocketLike | null = null;
  private selfId: string | null = null;
  /** Ids this page flew under before a reconnect: their sockets can linger server-side until the room notices. */
  private formerIds = new Set<string>();
  private wanted = false;
  private hiddenLong = false;
  private attempt = 0;
  private openedAt = 0;
  private retryTimer: unknown = null;
  private hiddenTimer: unknown = null;
  private fullTimer: unknown = null;
  private sendState = newSendState();
  /** The rounded pose, reused: tick runs every frame. */
  private rounded: ShipState = { p: [0, 0, 0], q: [0, 0, 0, 1], plume: "stock", ch: 0 };

  constructor(deps: ConnectionDeps) { this.deps = deps; }

  get connected(): boolean { return this.socket?.readyState === OPEN; }

  setWanted(want: boolean): void {
    if (want === this.wanted) return;
    this.wanted = want;
    if (!want) this.cancelRetry();
    this.reconcile();
  }

  setVisible(visible: boolean): void {
    if (!visible) {
      if (this.hiddenTimer === null && !this.hiddenLong) {
        this.hiddenTimer = this.deps.setTimer(() => {
          this.hiddenTimer = null;
          this.hiddenLong = true;
          this.reconcile();
        }, HIDDEN_GRACE_MS);
      }
      return;
    }
    if (this.hiddenTimer !== null) { this.deps.clearTimer(this.hiddenTimer); this.hiddenTimer = null; }
    if (this.hiddenLong) { this.hiddenLong = false; this.reconcile(); }
  }

  /**
   * Per frame. `me` is null while the ship may not be shared yet (the notice
   * has not been shown). With `shout`, a tick that sends a pose with every
   * body charted (ch CHART_TOTAL; a legacy-flag cartographer sends it too)
   * follows it with the title claim, which the room only
   * relays after such a pose. Returns whether the claim went out.
   */
  tick(me: ShipState | null, shout = false): boolean {
    const ws = this.socket;
    if (!me || !ws || ws.readyState !== OPEN) return false;
    const r = roundState(me, this.rounded);
    const now = this.deps.now();
    if (!shouldSend(this.sendState, this.racing ? Math.max(1, this.peers) : this.peers, now, r)) return false;
    try {
      // `ch` only when above 0: a pilot who charted nothing sends what it always did.
      ws.send(JSON.stringify(r.ch > 0 ? { t: "me", p: r.p, q: r.q, plume: r.plume, ch: r.ch } : { t: "me", p: r.p, q: r.q, plume: r.plume }));
      this.sent++;
      markSent(this.sendState, now, r);
      if (shout && r.ch === CHART_TOTAL) {
        ws.send('{"t":"charted"}');
        return true;
      }
    } catch { /* closing; onclose follows */ }
    return false;
  }

  /** Sends a race message; false when the socket is not open (or is closing). */
  sendRace(m: RaceClientMessage): boolean {
    const ws = this.socket;
    if (!ws || ws.readyState !== OPEN) return false;
    try {
      ws.send(JSON.stringify(m));
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.wanted = false;
    this.cancelRetry();
    if (this.hiddenTimer !== null) { this.deps.clearTimer(this.hiddenTimer); this.hiddenTimer = null; }
    if (this.fullTimer !== null) { this.deps.clearTimer(this.fullTimer); this.fullTimer = null; }
    this.drop();
  }

  private get shouldBeOpen(): boolean { return this.wanted && !this.hiddenLong && !this.full; }

  private reconcile(): void {
    if (!this.shouldBeOpen) { this.cancelRetry(); this.drop(); return; }
    if (!this.socket && this.retryTimer === null) this.open();
  }

  private open(): void {
    let ws: SocketLike;
    try { ws = this.deps.createSocket(this.deps.url); } catch { this.scheduleRetry(); return; }
    this.socket = ws;
    ws.onopen = () => { this.openedAt = this.deps.now(); };
    ws.onmessage = (e) => this.receive(e.data);
    ws.onclose = () => this.closed(ws);
    ws.onerror = () => { /* onclose follows */ };
  }

  private closed(ws: SocketLike): void {
    if (this.socket !== ws) return; // one we let go of on purpose
    this.socket = null;
    const lasted = this.openedAt ? this.deps.now() - this.openedAt : 0;
    this.reset();
    if (lasted >= STABLE_MS) this.attempt = 0;
    if (this.shouldBeOpen) this.scheduleRetry();
  }

  private scheduleRetry(): void {
    const ms = backoffMs(this.attempt++, this.deps.random());
    this.retryTimer = this.deps.setTimer(() => { this.retryTimer = null; this.reconcile(); }, ms);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) { this.deps.clearTimer(this.retryTimer); this.retryTimer = null; }
  }

  /** Let go of the socket now; closed() ignores its onclose. */
  private drop(): void {
    const ws = this.socket;
    this.socket = null;
    if (ws) { try { ws.close(1000); } catch { /* already closed */ } }
    this.reset();
  }

  private reset(): void {
    if (this.selfId) this.formerIds.add(this.selfId);
    this.ghosts.clear();
    this.peers = 0;
    this.selfId = null;
    this.openedAt = 0;
    this.sendState = newSendState();
  }

  private receive(data: unknown): void {
    const m = parseServerMessage(data);
    if (!m) {
      // Race messages ride the same socket under their own `r…` types.
      const r = parseRaceServer(data);
      if (r) this.deps.onRace?.(r);
      return;
    }
    switch (m.t) {
      case "hello": this.selfId = m.id; this.peers = m.peers; break;
      case "peers": this.peers = m.n; if (m.n === 0) this.ghosts.clear(); break;
      case "sync": this.sendState.syncPending = true; break;
      case "charted": this.deps.onCharted?.(m.cc); break;
      case "snap": this.ghosts.push(m.ships.filter((s) => s.id !== this.selfId && !this.formerIds.has(s.id)), this.deps.now()); break;
      case "full":
        this.full = true;
        this.cancelRetry();
        this.drop();
        this.fullTimer = this.deps.setTimer(() => { this.fullTimer = null; this.full = false; this.reconcile(); }, FULL_RETRY_MS);
        break;
    }
  }
}
