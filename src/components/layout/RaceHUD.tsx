import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useSpaceStore, flight, selectModalOpen } from "../../store/spaceStore";
import { STORE_KEYS, safeGetString } from "../../store/persist";
import { RING_GATES } from "../../data/ringCourse";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { setText } from "../../utils/domWrite";
import { liveSkyUrl } from "../../utils/liveSky";
import { loadRun, type RaceView } from "../../utils/raceSession";
import { lapMsFromRun } from "../../utils/raceScene";
import { joinPending, subscribeJoin, nearStartGate, takeInviteCopy } from "../../utils/raceJoin";
import { raceTicks, raceButtons, resultRowText, inviteLink, copyText, type RaceTicks } from "../../utils/raceHud";

const N = RING_GATES.length;
/** Racing rides the live sky: without its server there is nothing to join. */
const RACING = !!liveSkyUrl();

type TickRefs = { [K in keyof RaceTicks]: RefObject<HTMLSpanElement | null> };

export interface RacePanelProps {
  view: RaceView;
  /** Local ms, for the first paint of the ticking texts (the rAF loop takes over). */
  now: number;
  near: boolean;
  joining: boolean;
  liveSky: boolean;
  /** The race key to show on buttons: "R", the pad's "L3", or null on touch. */
  keyName: string | null;
  /** A finished pilot's stamped lap time (ms). */
  lapMs: number | null;
  /** The invite link after INVITE FRIENDS: copied, or shown to copy by hand. */
  copy: { link: string; ok: boolean } | null;
  againSent: boolean;
  onAgain: () => void;
  refs?: Partial<TickRefs>;
}

const card = "pointer-events-auto flex flex-col items-center gap-1.5 px-4 py-2.5 rounded-xl bg-black/70 border border-[#ffb020]/25 text-[#ffb020] max-w-[calc(100vw-2rem)]";
const label = "text-[9px] tracking-[0.2em] text-[#ffb020]/70";
const btn = "px-3 py-1.5 rounded-lg border border-[#ffb020]/40 text-[10px] tracking-[0.15em] text-[#ffb020] hover:bg-[#ffb020]/10 transition-colors";

/**
 * The race HUD's look for one view: the join prompt at the gate, the lobby,
 * the grid's 3-2-1-GO, the running readout, the upload and the results. Pure
 * (props in), so each phase renders in tests; RaceHUD feeds it the store.
 */
export function RacePanel(p: RacePanelProps) {
  const { view: v, keyName } = p;
  const t = raceTicks(v, p.now, p.lapMs);
  const key = (k: string | null) => (k ? ` (${k})` : "");
  const buttons = raceButtons(v, { near: p.near, joining: p.joining, againSent: p.againSent, onAgain: p.onAgain });
  const button = (id: string, children: ReactNode) => {
    const b = buttons.find((x) => x.id === id);
    return b && <button key={id} type="button" data-testid={`race-${id}`} className={btn} onClick={b.run}>{children}</button>;
  };
  const tick = (k: keyof RaceTicks, className: string) => <span ref={p.refs?.[k]} className={className}>{t[k]}</span>;

  let body: ReactNode = null;
  switch (v.phase) {
    case "idle":
      if (!p.near && !p.joining) return null;
      body = p.joining ? (
        <div className={label}>JOINING… CONNECTING TO LIVE SKY</div>
      ) : (<>
        {button("join", `JOIN RACE${key(keyName)}`)}
        {!p.liveSky && <div className="text-[9px] text-white/55">JOINING TURNS LIVE SKY ON FOR THE RACE</div>}
      </>);
      break;
    case "lobby":
      body = (<>
        <div className={label}>{v.kind === "private" ? `PRIVATE RACE · ${v.code ?? ""}` : "RACE LOBBY"}</div>
        <div className="flex flex-wrap justify-center gap-1.5 text-[10px]" data-testid="race-pilots">
          {v.pilots.map((x, i) => (
            <span key={i} className={`px-1.5 py-0.5 rounded border ${x.you ? "border-[#ffb020]/60 text-[#ffb020]" : "border-white/15 text-white/80"}`}>
              {x.you ? "YOU" : (x.cc ?? "--")}
            </span>
          ))}
        </div>
        {v.startsAt !== null ? tick("countdown", "text-white text-[11px] tabular-nums") : <div className="text-[9px] text-white/55">WAITING FOR PILOTS</div>}
        {p.copy && (p.copy.ok
          ? <div className="text-[9px] text-[#00ff87]">LINK COPIED</div>
          : <div className="text-[9px] text-white/80 select-text break-all" data-testid="race-link">COPY THIS LINK: {p.copy.link}</div>)}
        <div className="flex flex-wrap justify-center gap-1.5">
          {button("invite", "INVITE FRIENDS")}
          {button("start", "START")}
          {button("solo", "RACE THE BEST LAP")}
          {button("leave", `LEAVE${key(keyName)}`)}
        </div>
      </>);
      break;
    case "grid":
      body = <div className={label}>ON THE GRID · HOLD FOR GO</div>;
      break;
    case "running":
      body = (<>
        <div className={label}>{v.finished ? "FINISHED" : `RING ${Math.min(v.next, N)}/${N}`}</div>
        {tick("clock", "font-display text-2xl tabular-nums text-white")}
        {v.finalEndsAt !== null && tick("final", "text-[10px] tabular-nums text-[#ff6b4a]")}
      </>);
      break;
    case "over":
      body = <div className={label}>SENDING RESULT…</div>;
      break;
    case "results":
      body = (<>
        <div className={label}>RESULTS</div>
        <div className="flex flex-col gap-0.5 text-[11px] tabular-nums whitespace-pre">
          {v.rows.map((r, i) => (
            <div key={i} data-testid={r.you ? "race-row-you" : "race-row"} className={r.you ? "text-[#ffb020]" : "text-white/80"}>
              {resultRowText(r, N)}{r.you ? "  YOU" : ""}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {p.againSent
            ? <span className="text-[9px] text-white/55 self-center">READY · WAITING FOR PILOTS</span>
            : button("again", <>RACE AGAIN {tick("again", "tabular-nums")}</>)}
          {button("close", "CLOSE")}
        </div>
      </>);
      break;
  }

  const big = v.phase === "grid" || (v.phase === "running" && t.big !== "");
  return (<>
    <div data-testid="race-hud" className="absolute top-5 left-1/2 -translate-x-1/2">
      <div className={card}>{body}</div>
    </div>
    {big && (
      <div className="absolute top-[30%] left-1/2 -translate-x-1/2 pointer-events-none" data-testid="race-big">
        {tick("big", "font-display text-6xl text-white drop-shadow-[0_0_12px_rgba(255,176,32,0.7)]")}
      </div>
    )}
  </>);
}

/**
 * The ring race's HUD. The view re-renders it a few times a race (the server's
 * messages); the clock and the countdowns tick through rAF and a DOM write,
 * zero renders, as the old lap readout did. "Near the gate" flips a
 * render only when it changes.
 */
export default function RaceHUD() {
  const view = useSpaceStore((s) => s.raceView);
  const liveSky = useSpaceStore((s) => s.liveSky);
  const modalOpen = useSpaceStore(selectModalOpen);
  const pad = useSpaceStore((s) => s.padConnected);
  const isCoarse = useMediaQuery("(pointer: coarse)");
  const joining = useSyncExternalStore(subscribeJoin, joinPending, () => false);
  const [near, setNear] = useState(false);
  const [copy, setCopy] = useState<{ race: string; link: string; ok: boolean } | null>(null);
  const [againFor, setAgainFor] = useState<string | null>(null);
  const refs: TickRefs = {
    countdown: useRef<HTMLSpanElement>(null), big: useRef<HTMLSpanElement>(null), clock: useRef<HTMLSpanElement>(null),
    final: useRef<HTMLSpanElement>(null), again: useRef<HTMLSpanElement>(null),
  };

  // The stamped lap time, read from the run once the finish is stamped.
  const lapMs = useMemo(() => {
    if (view.phase !== "running" || !view.finished) return null;
    const run = loadRun(safeGetString(STORE_KEYS.raceRun), Date.now());
    return lapMsFromRun(run?.race === view.race ? run : null);
  }, [view]);

  // Within reach of the start gate, while idle: checked per frame, rendered on a flip.
  const watchGate = RACING && view.phase === "idle" && !modalOpen;
  useEffect(() => {
    if (!watchGate) { setNear(false); return; }
    let raf = 0;
    let last: boolean | null = null;
    const tick = () => {
      const n = nearStartGate(flight);
      if (n !== last) { last = n; setNear(n); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [watchGate]);

  // The ticking texts: countdowns and the clock, straight to the DOM.
  useEffect(() => {
    if (view.phase === "idle" || view.phase === "over") return;
    let raf = 0;
    const tick = () => {
      const t = raceTicks(view, Date.now(), lapMs);
      for (const k of Object.keys(t) as (keyof RaceTicks)[]) setText(refs[k].current, t[k]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The refs are stable (useRef): the loop needs only the view and the lap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, lapMs]);

  // INVITE FRIENDS: the private lobby's code arrives with the next view; copy its link then.
  useEffect(() => {
    if (view.phase !== "lobby" || view.code === null || !takeInviteCopy()) return;
    const link = inviteLink(window.location.origin, import.meta.env.BASE_URL, view.code);
    const race = view.race;
    void copyText(link, typeof navigator !== "undefined" ? navigator.clipboard : undefined).then((ok) => setCopy({ race, link, ok }));
  }, [view]);

  if (modalOpen) return null;
  return (
    <RacePanel
      view={view} now={Date.now()} near={near} joining={joining} liveSky={liveSky}
      keyName={pad ? "L3" : isCoarse ? null : "R"} lapMs={lapMs}
      copy={copy && view.phase === "lobby" && copy.race === view.race ? copy : null}
      againSent={view.phase === "results" && againFor === view.race}
      onAgain={() => { if (view.phase === "results") setAgainFor(view.race); }}
      refs={refs}
    />
  );
}
