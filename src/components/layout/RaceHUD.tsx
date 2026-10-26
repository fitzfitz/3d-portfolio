import { useEffect, useRef } from "react";
import { useSpaceStore } from "../../store/spaceStore";
import { formatRaceTime } from "../../utils/race";
import { RING_GATES } from "../../data/ringCourse";
import { setText } from "../../utils/domWrite";

const RINGS = RING_GATES.length - 1;

/**
 * Time-trial readout, shown only while a lap runs or its result is up. The
 * phase and ring count re-render at gates (a few times a lap); the clock
 * itself ticks through rAF + a DOM write, zero renders.
 */
export default function RaceHUD() {
  // Stopgap until Task 7 rewrites this HUD: idle renders nothing, as before.
  const race = useSpaceStore((s) => s.raceView);
  const best = useSpaceStore((s) => s.raceBest);
  const clockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (race.phase !== "running") return;
    let raf = 0;
    const tick = () => {
      setText(clockRef.current, formatRaceTime((Date.now() - race.goAt) / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [race]);

  if (race.phase === "idle") return null;
  const running = race.phase === "running";
  const ring = running ? (race.next === 0 ? "FINISH" : `RING ${race.next}/${RINGS}`) : "LAP COMPLETE";
  const isBest = !running && race.newBest === true;

  return (
    <div data-testid="race-hud"
      className="absolute top-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 px-4 py-2 rounded-xl bg-black/60 border border-[#ffb020]/25 text-[#ffb020]">
      <div className="text-[9px] tracking-[0.2em] text-[#ffb020]/70">TIME TRIAL · {ring}</div>
      <div ref={clockRef} className="font-display text-2xl tabular-nums text-white">
        {running ? formatRaceTime(0) : formatRaceTime(race.time)}
      </div>
      <div className="text-[9px] text-white/50">
        {isBest ? <span className="text-[#ffb020]">NEW BEST · </span> : best !== null ? `BEST ${formatRaceTime(best)} · ` : ""}
      </div>
    </div>
  );
}
