import { useSpaceStore, flight } from "../store/spaceStore";
import { STORE_KEYS, safeGetString } from "../store/persist";
import { START_GATE } from "../data/ringCourse";
import { JOIN_RADIUS, type RaceClientMessage } from "./raceProtocol";
import { loadRun, raceCodeFromUrl, raceJoinMessage, RACE_IDLE } from "./raceSession";
import { raceLink, sendRace } from "./raceLink";
import { ERROR_LINES, leaveRace } from "./raceController";
import type { Vec3 } from "./race";

/**
 * Getting into a race: the join (R, L3 or the HUD's button at the start
 * gate, or a `?race=` link), the rejoin after a reload or a reconnect (R10),
 * and the invite link's copy.
 *
 * A join waits for two things before it goes out: the live-sky socket (joining
 * turns live sky on when it was off), and the live-sky notice having reached
 * the radio (liveSkySeen). Ghosts.tsx sends no pose before that notice, and
 * the room signs rings only against poses, so a race joined earlier could
 * never be stamped. The notice itself plays as usual (Ghosts.tsx).
 */

/** A join not connected by then gives up with the "racing is offline" line. */
export const JOIN_TIMEOUT_MS = 10_000;

/** Within JOIN_RADIUS of the start gate's centre: the HUD offers JOIN RACE there. */
export function nearStartGate(p: Vec3): boolean {
  const c = START_GATE.c;
  return Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) <= JOIN_RADIUS;
}

/** The join waiting for the socket or the notice, or null. */
let pending: RaceClientMessage | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Live sky said hello and the stored run's rejoin has not gone out yet. */
let rejoinDue = false;
/** INVITE FRIENDS was pressed: copy the link when the private lobby's code arrives. */
let inviteCopyWanted = false;
/** The ?race= link is read once per page. */
let linkTaken = false;
const listeners = new Set<() => void>();

const notify = () => { for (const fn of listeners) fn(); };
function setPending(m: RaceClientMessage | null): void {
  if (m === null && timer !== null) { clearTimeout(timer); timer = null; }
  if (pending === m) return;
  pending = m;
  notify();
}

/** Whether a join is waiting (the HUD shows JOINING…). */
export function joinPending(): boolean { return pending !== null; }
/** For useSyncExternalStore: told when joinPending flips. */
export function subscribeJoin(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests: forget the in-memory state. */
export function resetRaceJoin(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending = null;
  rejoinDue = false;
  inviteCopyWanted = false;
  linkTaken = false;
}

/**
 * The join timer. At the first timeout a socket that is open (waiting on the
 * notice, not on the network) gets one more period; otherwise, or at the
 * second, the join gives up.
 */
function arm(retry: boolean): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (!pending) return;
    if (retry && raceLink.conn?.connected) { arm(false); return; }
    setPending(null);
    const s = useSpaceStore.getState();
    s.sendBroadcast(ERROR_LINES.off!);
    // Back to idle: turns live sky off again when the join turned it on.
    s.setRaceView(RACE_IDLE);
  }, JOIN_TIMEOUT_MS);
}

/**
 * Asks to join a race (`msg`: the public race, or an invite's code), from an
 * idle view. Turns live sky on for the race when it was off; the join goes
 * out once live sky is connected and its notice has played.
 */
export function requestJoin(msg: RaceClientMessage = { t: "rjoin" }): void {
  const s = useSpaceStore.getState();
  if (pending || s.raceView.phase !== "idle") return;
  if (!s.liveSky) {
    s.setRaceLiveSkyRestore(true);
    s.setLiveSky(true);
  }
  setPending(msg);
  arm(true);
  flushJoin();
}

/** Drops a waiting join; live sky goes back off if the join turned it on. */
export function cancelJoin(): void {
  if (!pending) return;
  setPending(null);
  useSpaceStore.getState().setRaceView(RACE_IDLE);
}

/**
 * Sends what is due, once the notice has played and the socket is open: the
 * stored run's rejoin first (R10: a reload or reconnect mid-race keeps
 * racing; it replaces any waiting join), else the waiting join.
 */
export function flushJoin(localNow: number = Date.now()): void {
  if (!useSpaceStore.getState().liveSkySeen) return;
  if (rejoinDue) {
    const run = loadRun(safeGetString(STORE_KEYS.raceRun), localNow);
    if (!run) rejoinDue = false;
    else if (sendRace({ t: "rjoin", token: run.token })) {
      rejoinDue = false;
      setPending(null);
      return;
    } else return;
  }
  if (pending && sendRace(pending)) setPending(null);
}

/** Live sky said hello (Ghosts.tsx): every (re)connect rejoins a stored run, or sends the waiting join. */
export function onLiveSkyHello(): void {
  rejoinDue = true;
  flushJoin();
}

/** Ghosts.tsx, while mounted: a join waiting on the notice goes out when it plays. */
export function watchRaceJoin(): () => void {
  return useSpaceStore.subscribe((s) => s.liveSkySeen, (seen) => { if (seen) flushJoin(); });
}

/**
 * R (and the pad's L3): joins at the start gate from an idle view, drops a
 * waiting join, leaves a lobby. Nothing on the grid or mid-race: a stray key
 * must not forfeit a race.
 */
export function raceKey(): void {
  const v = useSpaceStore.getState().raceView;
  if (pending) { cancelJoin(); return; }
  if (v.phase === "idle") { if (nearStartGate(flight)) requestJoin(); return; }
  if (v.phase === "lobby") leaveRace();
}

/** INVITE FRIENDS: makes the race private; the HUD copies the link when its code arrives. */
export function inviteFriends(): void {
  if (sendRace({ t: "rinvite" })) inviteCopyWanted = true;
}
/** Whether the invite's link is due for the clipboard (once). */
export function takeInviteCopy(): boolean {
  const want = inviteCopyWanted;
  inviteCopyWanted = false;
  return want;
}

/**
 * The `?race=CODE` link, once the scene is up: the code leaves the URL (a
 * reload or a shared address must not join again), and a valid code's race
 * is joined once live sky connects. The ship already starts on the grid
 * (flightState.ts startPose).
 */
export function startRaceLink(
  loc: { search: string; pathname: string; hash: string } = window.location,
  hist: { state: unknown; replaceState(data: unknown, unused: string, url?: string): void } = window.history,
): void {
  if (linkTaken) return;
  linkTaken = true;
  const params = new URLSearchParams(loc.search);
  if (!params.has("race")) return;
  const code = raceCodeFromUrl(loc.search);
  const msg = raceJoinMessage(loc.search);
  params.delete("race");
  const rest = params.toString();
  hist.replaceState(hist.state, "", `${loc.pathname}${rest ? `?${rest}` : ""}${loc.hash}`);
  if (code) requestJoin(msg);
}
