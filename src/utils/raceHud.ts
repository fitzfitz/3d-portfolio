import { useSpaceStore } from "../store/spaceStore";
import { formatRaceTime } from "./race";
import { RACE_IDLE, type RaceView } from "./raceSession";
import { sendRace } from "./raceLink";
import { leaveRace } from "./raceController";
import { requestJoin, inviteFriends } from "./raceJoin";
import type { ResultRow } from "./raceProtocol";

/**
 * The race HUD's rules, pure where they can be: the texts its rAF loop writes
 * (countdowns and the clock, no React render per frame), the results rows,
 * the buttons each view offers and what they do, and the invite link.
 */

/** A countdown's m:ss, rounded up (0:01 until it is due), never below 0:00. */
export function countdown(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000 - 1e-9));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** How long GO stays up in big letters after the start. */
const GO_SHOW_MS = 1000;

/** The texts that change by the frame, by element. Empty strings show nothing. */
export interface RaceTicks { countdown: string; big: string; clock: string; final: string; again: string }

/**
 * At local time `now`. `lapMs` is the stamped lap time of a finished pilot
 * (lapMsFromRun), which the clock shows once the finish is stamped.
 */
export function raceTicks(v: RaceView, now: number, lapMs: number | null): RaceTicks {
  const t: RaceTicks = { countdown: "", big: "", clock: "", final: "", again: "" };
  switch (v.phase) {
    case "lobby":
      if (v.startsAt !== null) t.countdown = `STARTS IN ${countdown(v.startsAt - now)}`;
      break;
    case "grid": {
      const n = Math.ceil((v.goAt - now) / 1000 - 1e-9);
      t.big = n >= 1 ? String(Math.min(n, 3)) : "GO";
      break;
    }
    case "running":
      if (now < v.goAt) t.big = String(Math.min(3, Math.max(1, Math.ceil((v.goAt - now) / 1000 - 1e-9))));
      else if (now - v.goAt < GO_SHOW_MS) t.big = "GO";
      t.clock = v.finished && lapMs !== null ? formatRaceTime(lapMs / 1000) : formatRaceTime(Math.max(0, now - v.goAt) / 1000);
      if (v.finalEndsAt !== null) t.final = `FINAL CALL ${countdown(v.finalEndsAt - now)}`;
      break;
    case "results":
      t.again = countdown(v.againBy - now);
      break;
  }
  return t;
}

/** `P1  ID  0:52.4`, or `DNF  MY  7/10 RINGS`; "--" for a pilot of no known country. */
export function resultRowText(r: ResultRow, rings: number): string {
  const cc = r.cc ?? "--";
  return r.timeMs !== null
    ? `P${r.place}  ${cc}  ${formatRaceTime(r.timeMs / 1000)}`
    : `DNF  ${cc}  ${r.rings}/${rings} RINGS`;
}

export interface RaceButton { id: "join" | "invite" | "start" | "solo" | "leave" | "again" | "close"; label: string; run: () => void }

export interface RaceButtonContext {
  /** Within JOIN_RADIUS of the start gate. */
  near: boolean;
  /** A join is waiting for live sky (raceJoin.ts joinPending). */
  joining: boolean;
  /** RACE AGAIN was pressed for these results. */
  againSent: boolean;
  onAgain: () => void;
}

/**
 * The buttons a view offers, in order:
 * - idle at the gate: JOIN RACE;
 * - lobby: INVITE FRIENDS (public), START (private host, 2 or more pilots),
 *   RACE THE BEST LAP (alone), LEAVE;
 * - results: RACE AGAIN (until pressed), CLOSE.
 */
export function raceButtons(v: RaceView, c: RaceButtonContext): RaceButton[] {
  switch (v.phase) {
    case "idle":
      return c.near && !c.joining ? [{ id: "join", label: "JOIN RACE", run: () => requestJoin() }] : [];
    case "lobby": {
      const out: RaceButton[] = [];
      if (v.kind === "public") out.push({ id: "invite", label: "INVITE FRIENDS", run: inviteFriends });
      if (v.kind === "private" && v.host && v.pilots.length >= 2) out.push({ id: "start", label: "START", run: () => { sendRace({ t: "rstart" }); } });
      if (v.pilots.length === 1) out.push({ id: "solo", label: "RACE THE BEST LAP", run: () => { sendRace({ t: "rsolo" }); } });
      out.push({ id: "leave", label: "LEAVE", run: leaveRace });
      return out;
    }
    case "results": {
      const out: RaceButton[] = [];
      if (!c.againSent) out.push({ id: "again", label: "RACE AGAIN", run: () => { if (sendRace({ t: "ragain" })) c.onAgain(); } });
      // Back to free flight; live sky goes back off if the race turned it on.
      out.push({ id: "close", label: "CLOSE", run: () => useSpaceStore.getState().setRaceView(RACE_IDLE) });
      return out;
    }
    default:
      return [];
  }
}

/** The invite: this site's own address (BASE_URL: "/" or the Pages path) with the code. */
export function inviteLink(origin: string, base: string, code: string): string {
  return `${origin}${base}?race=${code}`;
}

/** Copies `text`; false when the clipboard refuses (no permission, no user gesture) or is missing. */
export async function copyText(text: string, clip: Pick<Clipboard, "writeText"> | undefined): Promise<boolean> {
  if (!clip) return false;
  try {
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}
