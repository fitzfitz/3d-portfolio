import { useSpaceStore } from "../store/spaceStore";
import { STORE_KEYS, safeGetString, safeSetJSON, safeRemove } from "../store/persist";
import { RING_GATES } from "../data/ringCourse";
import { formatRaceTime, isNewBest } from "./race";
import { beaconApiUrl } from "./apiBase";
import { raceReduce, syncWithRun, loadRun, withStamp, uploadRun, RUN_TTL_MS, RACE_IDLE, type RaceRun, type RaceView } from "./raceSession";
import { sendRace } from "./raceLink";
import type { RaceError, RaceServerMessage, ResultRow, Stamp } from "./raceProtocol";

/**
 * The race's glue: each server race message (from Ghosts.tsx's live-sky
 * connection) updates the view in the store, the run in storage, the radio,
 * the Ring runner badge and the best lap. The scene calls onRaceOver once at
 * `over` to upload the run.
 *
 * Times are Date.now()'s clock: the run's expiry must survive a reload.
 */

const N = RING_GATES.length;

/** The race's radio copy (`RACE // …`, like every radio line). */
export const ERROR_LINES: Partial<Record<RaceError, string>> = {
  expired: "RACE // THAT RACE HAS ENDED · THE START GATE IS STILL OPEN",
  full: "RACE // THE RACE IS FULL · TRY THE NEXT ONE",
  off: "RACE // RACING IS OFFLINE RIGHT NOW",
  busy: "RACE // THIS RACE IS OPEN IN ANOTHER TAB",
};
export const waitLine = (cc: string | null) => `RACE // A PILOT FROM ${cc ?? "DEEP SPACE"} IS WAITING AT THE START GATE`;
export const SOLO_LINE = "RACE // NO RIVALS ONLINE · RACING THE BEST LAP";
export const GO_LINE = `RACE // GO · ${N} RINGS · NORMAL WARP ONLY`;
export const FINAL_LINE = "RACE // FINAL CALL · 30 SECONDS";
export const RESULT_LOST_LINE = "RACE // RESULT NOT RECEIVED IN TIME";
export function resultLine(own: ResultRow, total: number): string {
  return own.timeMs !== null
    ? `RACE // P${own.place} OF ${total} · ${formatRaceTime(own.timeMs / 1000)}`
    : `RACE // DNF · ${own.rings}/${N} RINGS`;
}

/**
 * The token of the race just run, kept after its run is cleared at the
 * results: race again's grid carries no token, and the new run reuses it.
 */
let lastToken: string | null = null;
/** The race already uploaded (or being uploaded): the scene's over call runs once per race. */
let uploadedRace: string | null = null;

/** Tests: forget the in-memory state. */
export function resetRaceController(): void {
  lastToken = null;
  uploadedRace = null;
}

function readRun(localNow: number): RaceRun | null {
  const run = loadRun(safeGetString(STORE_KEYS.raceRun), localNow);
  if (run) lastToken = run.token;
  return run;
}
function saveRun(run: RaceRun): void {
  lastToken = run.token;
  safeSetJSON(STORE_KEYS.raceRun, run);
}
function clearRun(): void {
  safeRemove(STORE_KEYS.raceRun);
}

/** A stamp into the run of its race; a fresh run (from the stamp's own race and token) when the stored one is another's or gone. */
function keepStamp(stamp: Stamp, localNow: number, refresh: boolean): RaceRun {
  const cur = readRun(localNow);
  const base: RaceRun = cur && cur.race === stamp.r && cur.token === stamp.k
    ? cur
    : { v: 1, race: stamp.r, token: stamp.k, stamps: [], expiresAt: localNow + RUN_TTL_MS };
  // From GO the run is kept for the race, the upload window and a minute (a private lobby can outlast that).
  const run = withStamp(refresh ? { ...base, expiresAt: localNow + RUN_TTL_MS } : base, stamp);
  saveRun(run);
  return run;
}

/** Store, run storage, radio, badge and best for one server race message. */
export function onRaceServer(m: RaceServerMessage, localNow: number = Date.now()): void {
  const s = useSpaceStore.getState();
  /** The view before this message: the lines below play on a change, not on a rejoin's resend. */
  const prev = s.raceView;
  let run: RaceRun | null = null;
  let line: string | null = null;
  switch (m.t) {
    case "rlobby": {
      const cur = readRun(localNow);
      if (!cur || cur.race !== m.race || cur.token !== m.token) {
        saveRun({ v: 1, race: m.race, token: m.token, kind: m.kind, stamps: [], expiresAt: localNow + RUN_TTL_MS });
      } else if (cur.kind !== m.kind) {
        saveRun({ ...cur, kind: m.kind });
      }
      break;
    }
    case "rgrid": {
      // Race again: a new race id with no lobby first, flown under the same token.
      const cur = readRun(localNow);
      const token = cur?.token ?? lastToken;
      if (cur?.race !== m.race && token) saveRun({ v: 1, race: m.race, token, kind: m.kind, stamps: [], expiresAt: localNow + RUN_TTL_MS });
      // The grid has the final kind: a lone pilot's public or private lobby races solo.
      else if (cur && cur.kind !== m.kind) saveRun({ ...cur, kind: m.kind });
      // Docked or reading a dossier, the scene is frozen (no frame runs), so
      // nothing would put the ship on the grid: let go of both (R15).
      if (s.isOrbitLocked) s.breakOrbit();
      if (s.openDossier !== null) s.closeDossier();
      if (m.kind === "solo" && !(prev.phase === "grid" && prev.race === m.race)) line = SOLO_LINE;
      break;
    }
    case "rgo":
      run = keepStamp(m.stamp, localNow, true);
      // From the grid only: a rejoin after a reload picks the race up mid-lap.
      if (prev.phase === "grid" && prev.race === m.stamp.r) line = GO_LINE;
      break;
    case "rfinal":
      // A race of one ends at its finish: there is no one to call.
      if (prev.phase === "running" && prev.finalEndsAt === null && prev.kind !== "solo") line = FINAL_LINE;
      break;
    case "rstamp":
      run = keepStamp(m.stamp, localNow, false);
      break;
    case "rover":
      run = readRun(localNow);
      break;
    case "rresults": {
      const own = m.rows.find((r) => r.you);
      if (own) {
        s.sendBroadcast(resultLine(own, m.rows.length));
        if (own.timeMs !== null) {
          const t = own.timeMs / 1000;
          if (isNewBest(t, s.raceBest)) s.setRaceBest(t);
          s.recordBadge("ring");
        }
      }
      clearRun();
      break;
    }
    case "rerr":
      line = ERROR_LINES[m.reason] ?? null;
      // The room no longer knows the stored run's race (a rejoin after it
      // ended): drop the run, or every reconnect would ask again (raceJoin.ts).
      if (m.reason === "expired") clearRun();
      break;
    case "rwait":
      // Ambient, for pilots off a race; a racer has the lobby in front of them.
      if (prev.phase === "idle") line = waitLine(m.cc);
      break;
  }
  if (line) s.sendBroadcast(line);
  const view = syncWithRun(raceReduce(prev, m, localNow), run);
  if (view !== prev) s.setRaceView(view);
}

/** The wait before the one retry of a failed upload. */
export const UPLOAD_RETRY_MS = 2_000;

/**
 * Uploads the stored run, once per race (the scene calls it at `over`; a
 * second call is a no-op). `ghost` is the encoded best-lap path or null. A
 * failed upload (no network, a 5xx) is tried once more after UPLOAD_RETRY_MS
 * if the over view's upload window is still open then; late and rejected are
 * final. A result that does not land says so on the radio; one that does is
 * heard at the results.
 */
export async function onRaceOver(ghost: string | null): Promise<void> {
  const run = readRun(Date.now());
  if (!run || run.stamps.length === 0 || uploadedRace === run.race) return;
  uploadedRace = run.race;
  const base = beaconApiUrl();
  let res = await uploadRun(base, run, ghost);
  if (res === "failed") {
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_MS));
    const v = useSpaceStore.getState().raceView;
    if (v.phase === "over" && v.race === run.race && Date.now() < v.uploadBy) res = await uploadRun(base, run, ghost);
  }
  if (res !== "ok") useSpaceStore.getState().sendBroadcast(RESULT_LOST_LINE);
}

/**
 * Uploads at `over` straight from the store, once per race: the socket keeps
 * delivering rover in a hidden tab or a frozen scene, where no frame runs.
 * `ghostFor` gives the path to send with the run (RaceCourse's recording and
 * best lap). Returns the unsubscribe.
 */
export function watchRaceOver(
  ghostFor: (v: Extract<RaceView, { phase: "over" }>) => string | null,
  over: (ghost: string | null) => Promise<void> = onRaceOver,
): () => void {
  let doneFor: string | null = null;
  return useSpaceStore.subscribe((s) => s.raceView, (v) => {
    if (v.phase !== "over" || doneFor === v.race) return;
    doneFor = v.race;
    void over(ghostFor(v));
  }, { fireImmediately: true });
}

/**
 * Leaves the race the pilot is on (the classic CV opening mid-race; Task 7's
 * LEAVE): the room makes them DNF and stops sending them the race, so the view
 * goes back to idle here, and the run goes too (no `over` will come for its upload).
 */
export function leaveRace(): void {
  sendRace({ t: "rleave" });
  clearRun();
  const s = useSpaceStore.getState();
  if (s.raceView.phase !== "idle") s.setRaceView(RACE_IDLE);
}
