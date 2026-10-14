import {
  parseMe, roundState, SKY_CAP, SNAP_INTERVAL_MS, FLOOD_PER_SECOND, STALE_MS,
  type ServerMessage, type ShipState, type SnapShip,
} from "../../src/utils/liveSkyProtocol";

/**
 * The live sky room, free of Cloudflare bindings so it can be unit tested
 * (tests/skyRoom.test.ts). index.ts's Sky Durable Object wires it to
 * hibernatable WebSockets. Spec: docs/superpowers/specs/2026-10-14-live-sky-design.md §2.
 *
 * Nothing here is stored. A pilot is a random id, a public country code, and
 * their last pose, kept in the socket's attachment; closing the socket forgets them.
 */

export interface Pilot {
  id: string;
  cc: string | null;
  last: ShipState | null;
  /** When `last` arrived (ms); snapshots carry its age, and a long silence drops the pilot from them. */
  lastAt: number;
  /** Flood window: messages counted since `start`. */
  win: { start: number; count: number };
}
export interface Room { pilots: Pilot[]; lastSnapAt: number; trailingDue: boolean }
export interface Outgoing { to: string; msg: ServerMessage }

export { STALE_MS };

export const newRoom = (): Room => ({ pilots: [], lastSnapAt: -Infinity, trailingDue: false });

/** 8 random base-36 characters. Never derived from anything about the visitor. */
export function randomPilotId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

export function buildSnap(room: Room, forId: string, now: number): ServerMessage {
  const ships: SnapShip[] = [];
  for (const p of room.pilots) {
    if (p.id === forId || !p.last || now - p.lastAt > STALE_MS) continue;
    ships.push({ id: p.id, cc: p.cc, ...p.last, ago: now - p.lastAt });
  }
  return { t: "snap", ships };
}

const snapAll = (room: Room, now: number): Outgoing[] => room.pilots.map((p) => ({ to: p.id, msg: buildSnap(room, p.id, now) }));

export function onJoin(room: Room, id: string, cc: string | null, now: number):
  { ok: false; out: ServerMessage } | { ok: true; pilot: Pilot; out: Outgoing[] } {
  if (room.pilots.length >= SKY_CAP) return { ok: false, out: { t: "full" } };
  const pilot: Pilot = { id, cc, last: null, lastAt: 0, win: { start: now, count: 0 } };
  room.pilots.push(pilot);
  const n = room.pilots.length - 1;
  const out: Outgoing[] = [{ to: id, msg: { t: "hello", id, peers: n } }];
  // Everyone already here, straight away: a still pilot sends nothing.
  if (n > 0) out.push({ to: id, msg: buildSnap(room, id, now) });
  for (const p of room.pilots) {
    if (p.id === id) continue;
    out.push({ to: p.id, msg: { t: "peers", n } });
    out.push({ to: p.id, msg: { t: "sync" } });
  }
  return { ok: true, pilot, out };
}

export function onMessage(room: Room, pilot: Pilot, raw: unknown, now: number):
  { out: Outgoing[]; close: boolean; trailingIn: number | null } {
  if (now - pilot.win.start >= 1000) pilot.win = { start: now, count: 0 };
  pilot.win.count++;
  if (pilot.win.count > FLOOD_PER_SECOND) return { out: [], close: true, trailingIn: null };
  const state = parseMe(raw);
  if (!state) return { out: [], close: false, trailingIn: null };
  pilot.last = roundState(state);
  pilot.lastAt = now;
  const wait = room.lastSnapAt + SNAP_INTERVAL_MS - now;
  if (wait <= 0) {
    room.lastSnapAt = now;
    room.trailingDue = false;
    return { out: snapAll(room, now), close: false, trailingIn: null };
  }
  // Inside the window: one trailing snapshot carries this (and any later) move.
  if (room.trailingDue) return { out: [], close: false, trailingIn: null };
  room.trailingDue = true;
  return { out: [], close: false, trailingIn: wait };
}

/** The trailing snapshot a throttled message scheduled; empty if something already sent one. */
export function onTrailing(room: Room, now: number): Outgoing[] {
  if (!room.trailingDue) return [];
  room.trailingDue = false;
  room.lastSnapAt = now;
  return snapAll(room, now);
}

export function onLeave(room: Room, id: string, now: number): Outgoing[] {
  const i = room.pilots.findIndex((p) => p.id === id);
  if (i < 0) return [];
  room.pilots.splice(i, 1);
  room.lastSnapAt = now;
  room.trailingDue = false;
  const n = room.pilots.length - 1;
  return [
    ...room.pilots.map((p) => ({ to: p.id, msg: { t: "peers", n } as ServerMessage })),
    ...snapAll(room, now),
  ];
}
