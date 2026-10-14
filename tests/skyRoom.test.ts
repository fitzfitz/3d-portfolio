import { describe, it, expect } from "vitest";
import {
  newRoom, onJoin, onMessage, onLeave, onTrailing, buildSnap, randomPilotId,
  type Room, type Outgoing,
} from "../beacon-api/src/sky";
import { SKY_CAP } from "../src/utils/liveSkyProtocol";

const me = (x = 1, plume = "ring") => JSON.stringify({ t: "me", p: [x, 2, 3], q: [0, 0, 0, 1], plume });
const to = (out: Outgoing[], id: string) => out.filter((o) => o.to === id).map((o) => o.msg);
function join(room: Room, id: string, now = 0, cc: string | null = "ID") {
  const r = onJoin(room, id, cc, now);
  if (!r.ok) throw new Error("room full");
  return r;
}

describe("joining", () => {
  it("the first pilot gets hello with no peers and nothing else", () => {
    const room = newRoom();
    expect(join(room, "a").out).toEqual([{ to: "a", msg: { t: "hello", id: "a", peers: 0 } }]);
  });
  it("a newcomer gets hello and a snapshot; everyone else gets peers and sync", () => {
    const room = newRoom();
    const a = join(room, "a");
    onMessage(room, a.pilot, me(5), 1000);
    const { out } = join(room, "b", 2000);
    expect(to(out, "b")).toEqual([
      { t: "hello", id: "b", peers: 1 },
      { t: "snap", ships: [{ id: "a", cc: "ID", p: [5, 2, 3], q: [0, 0, 0, 1], plume: "ring" }] },
    ]);
    expect(to(out, "a")).toEqual([{ t: "peers", n: 1 }, { t: "sync" }]);
  });
  it("turns the pilot past the cap away with full", () => {
    const room = newRoom();
    for (let i = 0; i < SKY_CAP; i++) join(room, `p${i}`);
    expect(onJoin(room, "late", null, 0)).toEqual({ ok: false, out: { t: "full" } });
    expect(room.pilots).toHaveLength(SKY_CAP);
  });
});

describe("messages", () => {
  it("a valid me updates the sender and snapshots everyone, never including themselves", () => {
    const room = newRoom();
    const a = join(room, "a");
    join(room, "b");
    const r = onMessage(room, a.pilot, me(1.234567), 1000);
    expect(a.pilot.last).toEqual({ p: [1.23, 2, 3], q: [0, 0, 0, 1], plume: "ring" });
    expect(to(r.out, "a")).toEqual([{ t: "snap", ships: [] }]);
    expect(to(r.out, "b")).toEqual([{ t: "snap", ships: [{ id: "a", cc: "ID", p: [1.23, 2, 3], q: [0, 0, 0, 1], plume: "ring" }] }]);
    expect(r.close).toBe(false);
  });
  it("drops an invalid message without touching the sender", () => {
    const room = newRoom();
    const a = join(room, "a");
    expect(onMessage(room, a.pilot, me(1, "rainbow"), 1000)).toEqual({ out: [], close: false, trailingIn: null });
    expect(a.pilot.last).toBeNull();
  });
  it("leaves a pilot who has never sent out of snapshots", () => {
    const room = newRoom();
    join(room, "a");
    join(room, "b");
    expect(buildSnap(room, "a")).toEqual({ t: "snap", ships: [] });
  });
});

describe("throttle", () => {
  it("defers a message inside the window to one trailing snapshot", () => {
    const room = newRoom();
    const a = join(room, "a");
    join(room, "b");
    expect(onMessage(room, a.pilot, me(1), 1000).out).toHaveLength(2);
    const second = onMessage(room, a.pilot, me(2), 1100);
    expect(second.out).toEqual([]);
    expect(second.trailingIn).toBe(150);
    expect(onMessage(room, a.pilot, me(3), 1200).trailingIn).toBeNull(); // already scheduled
    const trailing = onTrailing(room, 1250);
    expect(to(trailing, "b")).toEqual([{ t: "snap", ships: [{ id: "a", cc: "ID", p: [3, 2, 3], q: [0, 0, 0, 1], plume: "ring" }] }]);
    expect(onTrailing(room, 1300)).toEqual([]);
  });
});

describe("flood limit", () => {
  it("closes on the 11th message inside a second, and the window resets after it", () => {
    const room = newRoom();
    const a = join(room, "a");
    for (let i = 0; i < 10; i++) expect(onMessage(room, a.pilot, me(i), 1000 + i).close).toBe(false);
    expect(onMessage(room, a.pilot, me(), 1500).close).toBe(true);
    const b = join(room, "b", 3000);
    for (let i = 0; i < 10; i++) onMessage(room, b.pilot, me(i), 3000 + i);
    expect(onMessage(room, b.pilot, me(), 4001).close).toBe(false);
  });
});

describe("leaving", () => {
  it("tells everyone left the new count and sends a final snapshot", () => {
    const room = newRoom();
    join(room, "a");
    join(room, "b");
    join(room, "c");
    const out = onLeave(room, "b", 5000);
    expect(to(out, "a")).toEqual([{ t: "peers", n: 1 }, { t: "snap", ships: [] }]);
    expect(room.pilots.map((p) => p.id)).toEqual(["a", "c"]);
  });
  it("leaving twice is a no-op", () => {
    const room = newRoom();
    join(room, "a");
    join(room, "b");
    onLeave(room, "b", 5000);
    expect(onLeave(room, "b", 5001)).toEqual([]);
  });
});

describe("randomPilotId", () => {
  it("is 8 lowercase alphanumerics and differs each time", () => {
    const ids = new Set(Array.from({ length: 50 }, randomPilotId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8}$/);
  });
});
