import { useEffect, useRef } from "react";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { edgeDepth, HAZE_MAX_OPACITY, HazeLineGate, ReturnBurnLineGate, EdgeRadioClock } from "../../utils/edgeHaze";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools, RETURN_BURN_LINE } from "../../data/chatterLines";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";

/** Stable predicate (no per-frame closure): is the current broadcast a haze or return-burn line? */
function isEdgeLine(): boolean {
  const t = useSpaceStore.getState().broadcast?.text;
  return t === RETURN_BURN_LINE || (t !== undefined && chatterPools.haze.includes(t));
}

/**
 * Nebula haze at the edge of the system: thickens radially from HAZE_START to
 * SYSTEM_RADIUS (~92% opaque there), where the return burn takes over. Also
 * plays the return-burn radio line.
 *
 * A DOM layer, not a scene object: it costs no shader program, and the rAF
 * loop writes its opacity straight to the element, so flight never renders
 * React (the same pattern as the HUD telemetry). No backdrop-filter
 * (tests/noBackdropFilter.test.ts).
 */
export default function EdgeHaze() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scheduler = new ChatterScheduler(chatterPools);
    const gate = new HazeLineGate();
    const burnGate = new ReturnBurnLineGate();
    const clock = new EdgeRadioClock();
    let raf = 0;
    const tick = () => {
      const depth = edgeDepth(flight.x, flight.y, flight.z);
      if (ref.current) ref.current.style.opacity = (HAZE_MAX_OPACITY * depth).toFixed(3);
      const s = useSpaceStore.getState();
      const now = performance.now() / 1000;
      clock.observe(s.broadcast?.id ?? 0, now, isEdgeLine);
      if (gate.update(depth, clock.busy(now, RADIO_BUSY_S), s.race.phase === "running")) {
        s.sendBroadcast(scheduler.pick("haze"), { silent: true });
      }
      // The burn preempts the haze line: only other broadcasts hold it back.
      if (burnGate.update(flight.edgeBurn, now, clock.busyIgnoringEdge(now, RADIO_BUSY_S))) {
        // Not silent: it explains an involuntary control change (a11y). Still once per 20 s.
        s.sendBroadcast(RETURN_BURN_LINE);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} data-testid="edge-haze" aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[35]"
      style={{
        opacity: 0,
        background:
          "radial-gradient(ellipse at center, rgba(88,52,160,0.82) 0%, rgba(30,104,128,0.92) 55%, rgba(10,6,24,1) 100%)",
      }} />
  );
}
