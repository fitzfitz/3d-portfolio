import { describe, it, expect, beforeEach } from "vitest";
import { LiveSkyConnection, backoffMs, HIDDEN_GRACE_MS, STABLE_MS, type SocketLike } from "../src/utils/liveSkyConnection";
import type { ShipState } from "../src/utils/liveSkyProtocol";

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  closedWith: number | undefined = undefined;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeSocket.all.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  serve(msg: object) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  send(d: string) { this.sent.push(d); }
  close(code?: number) { this.closedWith = code; this.readyState = 3; }
  /** The server or the network closes it. */
  drop() { this.readyState = 3; this.onclose?.(); }
}

function harness(createSocket: (url: string) => SocketLike = (u) => new FakeSocket(u)) {
  let clock = 0;
  let nextId = 1;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  const conn = new LiveSkyConnection({
    url: "wss://sky.example/live",
    createSocket,
    now: () => clock,
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ at: clock + ms, fn, id }); return id; },
    clearTimer: (h) => { const i = timers.findIndex((t) => t.id === h); if (i >= 0) timers.splice(i, 1); },
    random: () => 0.5,
  });
  const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      clock = t.at;
      t.fn();
    }
    clock = end;
  };
  const last = () => FakeSocket.all.at(-1)!;
  return { conn, advance, last };
}

const ME: ShipState = { p: [1.234, 2, 3], q: [0, 0, 0, 1], plume: "stock" };
const ship = (id: string) => ({ id, p: [5, 0, 0], q: [0, 0, 0, 1], plume: "ring", cc: "ID" });

beforeEach(() => { FakeSocket.all = []; });

describe("backoffMs", () => {
  it("doubles from 2 s, caps at 60 s, jitters ±25%", () => {
    expect(backoffMs(0, 0.5)).toBe(2000);
    expect(backoffMs(1, 0.5)).toBe(4000);
    expect(backoffMs(9, 0.5)).toBe(60_000);
    expect(backoffMs(0, 0)).toBe(1500);
    expect(backoffMs(0, 1)).toBe(2500);
  });
});

describe("LiveSkyConnection", () => {
  it("does nothing until wanted, then opens one socket", () => {
    const { conn, last } = harness();
    conn.tick(ME);
    expect(FakeSocket.all).toHaveLength(0);
    conn.setWanted(true);
    conn.setWanted(true);
    expect(FakeSocket.all).toHaveLength(1);
    expect(last().url).toBe("wss://sky.example/live");
  });

  it("stays silent while alone", () => {
    const { conn, advance, last } = harness();
    conn.setWanted(true);
    last().open();
    last().serve({ t: "hello", id: "me1", peers: 0 });
    for (let i = 0; i < 10; i++) { advance(300); conn.tick({ ...ME, p: [i, 2, 3] }); }
    expect(last().sent).toEqual([]);
  });

  it("sends a rounded pose once someone is here, then only on change or sync", () => {
    const { conn, advance, last } = harness();
    conn.setWanted(true);
    last().open();
    last().serve({ t: "hello", id: "me1", peers: 1 });
    conn.tick(ME);
    expect(last().sent.map((s) => JSON.parse(s))).toEqual([{ t: "me", p: [1.23, 2, 3], q: [0, 0, 0, 1], plume: "stock" }]);
    advance(300);
    conn.tick(ME);
    expect(last().sent).toHaveLength(1);
    last().serve({ t: "sync" });
    conn.tick(ME);
    expect(last().sent).toHaveLength(2);
    expect(conn.sent).toBe(2);
  });

  it("never sends before the notice has been shown (me is null)", () => {
    const { conn, last } = harness();
    conn.setWanted(true);
    last().open();
    last().serve({ t: "hello", id: "me1", peers: 3 });
    conn.tick(null);
    expect(last().sent).toEqual([]);
  });

  it("never shows its own ship", () => {
    const { conn, last } = harness();
    conn.setWanted(true);
    last().open();
    last().serve({ t: "hello", id: "me1", peers: 1 });
    last().serve({ t: "snap", ships: [ship("me1"), ship("g2")] });
    expect(conn.ghosts.size).toBe(1);
    expect(conn.ghosts.sample(10_000).map((g) => g.id)).toEqual(["g2"]);
  });

  it("clears ghosts when the room empties", () => {
    const { conn, last } = harness();
    conn.setWanted(true);
    last().open();
    last().serve({ t: "hello", id: "me1", peers: 1 });
    last().serve({ t: "snap", ships: [ship("g2")] });
    last().serve({ t: "peers", n: 0 });
    expect(conn.ghosts.size).toBe(0);
    expect(conn.peers).toBe(0);
  });

  it("reconnects with backoff, resetting after a stable connection", () => {
    const { conn, advance, last } = harness();
    conn.setWanted(true);
    last().open();
    last().serve({ t: "hello", id: "me1", peers: 1 });
    last().serve({ t: "snap", ships: [ship("g2")] });
    last().drop();
    expect(conn.ghosts.size).toBe(0);
    advance(1999);
    expect(FakeSocket.all).toHaveLength(1);
    advance(1);
    expect(FakeSocket.all).toHaveLength(2);
    last().drop();                      // failed straight away: next wait doubles
    advance(3999);
    expect(FakeSocket.all).toHaveLength(2);
    advance(1);
    expect(FakeSocket.all).toHaveLength(3);
    last().open();
    advance(STABLE_MS);
    last().drop();                      // lasted 30 s: back to 2 s
    advance(2000);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it("a failed socket constructor is just another backoff step", () => {
    let fail = true;
    const { conn, advance } = harness((u) => { if (fail) throw new Error("bad url"); return new FakeSocket(u); });
    expect(() => conn.setWanted(true)).not.toThrow();
    fail = false;
    advance(2000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("full stops all retries for this page", () => {
    const { conn, advance, last } = harness();
    conn.setWanted(true);
    last().open();
    last().serve({ t: "full" });
    expect(last().readyState).toBe(3);
    last().drop();
    advance(600_000);
    conn.setWanted(false);
    conn.setWanted(true);
    expect(FakeSocket.all).toHaveLength(1);
    expect(conn.full).toBe(true);
  });

  it("disconnects after the tab has been hidden 60 s, and reconnects on return", () => {
    const { conn, advance, last } = harness();
    conn.setWanted(true);
    last().open();
    conn.setVisible(false);
    advance(HIDDEN_GRACE_MS - 1);
    expect(last().readyState).toBe(1);
    advance(1);
    expect(last().closedWith).toBe(1000);
    conn.setVisible(true);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("a short hide keeps the same socket", () => {
    const { conn, advance, last } = harness();
    conn.setWanted(true);
    last().open();
    conn.setVisible(false);
    advance(30_000);
    conn.setVisible(true);
    advance(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(last().readyState).toBe(1);
  });

  it("turning it off closes, clears and stops sending", () => {
    const { conn, advance, last } = harness();
    conn.setWanted(true);
    last().open();
    last().serve({ t: "hello", id: "me1", peers: 1 });
    last().serve({ t: "snap", ships: [ship("g2")] });
    conn.setWanted(false);
    expect(last().closedWith).toBe(1000);
    expect(conn.ghosts.size).toBe(0);
    expect(conn.peers).toBe(0);
    advance(300);
    conn.tick(ME);
    expect(last().sent).toEqual([]);
  });

  it("re-enabling during a pending retry connects at once", () => {
    const { conn, last } = harness();
    conn.setWanted(true);
    last().open();
    last().drop();                      // retry now pending for 2 s
    conn.setWanted(false);
    conn.setWanted(true);
    expect(FakeSocket.all).toHaveLength(2);
  });
});
