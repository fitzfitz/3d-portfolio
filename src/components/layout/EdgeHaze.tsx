import { useEffect, useRef } from "react";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { edgeDepth, HAZE_MAX_OPACITY, HazeLineGate, ReturnBurnLineGate } from "../../utils/edgeHaze";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools, RETURN_BURN_LINE } from "../../data/chatterLines";
import { SYSTEM_RADIUS } from "../../constants";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";

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
    const lastBroadcast = { id: 0, at: -Infinity };
    let raf = 0;
    const tick = () => {
      const depth = edgeDepth(flight.x, flight.y, flight.z);
      if (ref.current) ref.current.style.opacity = (HAZE_MAX_OPACITY * depth).toFixed(3);
      const s = useSpaceStore.getState();
      const now = performance.now() / 1000;
      const bid = s.broadcast?.id ?? 0;
      if (bid !== lastBroadcast.id) { lastBroadcast.id = bid; lastBroadcast.at = now; }
      if (gate.update(depth, now - lastBroadcast.at < RADIO_BUSY_S, s.race.phase === "running")) {
        s.sendBroadcast(scheduler.pick("haze"), { silent: true });
      }
      const radioBusy = now - lastBroadcast.at < RADIO_BUSY_S;
      if (burnGate.update(Math.hypot(flight.x, flight.y, flight.z) > SYSTEM_RADIUS, now, radioBusy)) {
        s.sendBroadcast(RETURN_BURN_LINE, { silent: true });
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
