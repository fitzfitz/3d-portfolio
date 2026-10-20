import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { nearestScannable, SCAN_RANGE } from "../../utils/scannables";
import { generateScanReport } from "../../utils/scanReport";
import { soundManager } from "../../audio/soundManager";
import { scanState } from "../../utils/scanState";
import { ambientTime, gameTime } from "../../utils/ambientTime";
import { buoyCardState, buoyIndex, BUOY_SCAN_HOLD_S } from "../../utils/buoyCard";
import { isBodyId } from "../../data/bodyIds";


/** Headless: drives scan targeting/progress/report dispatch each frame. Renders nothing. */
export default function Scanner() {
  // Latches after a completed scan so holding the key/button doesn't immediately
  // restart another scan — released only once the input goes low.
  const latched = useRef(false);
  // Tracks the previously-targeted scannable so a mid-hold target swap (e.g.
  // drifting from one planet's range into another's) restarts progress
  // instead of crediting the new target with the old one's partial scan.
  const prevTargetId = useRef<string | null>(null);

  useFrame((state, dt) => {
    if (useSpaceStore.getState().photoMode) {
      scanState.progress = 0;
      scanState.label = "";
      return;
    }
    const near = nearestScannable(flight.x, flight.y, flight.z, SCAN_RANGE);
    const store = useSpaceStore.getState();
    store.setScanTarget(near?.id ?? null);
    scanState.label = near?.label ?? "";

    const nearId = near?.id ?? null;
    if (nearId !== prevTargetId.current) {
      scanState.progress = 0;
      latched.current = false;
    }
    prevTargetId.current = nearId;

    if (near && flight.input.scan && !latched.current) {
      scanState.progress = Math.min(1, scanState.progress + dt / 1.6);
      if (scanState.progress >= 1) {
        store.sendBroadcast(generateScanReport(near.id, ambientTime(state.clock.getElapsedTime())));
        soundManager.scanBeep();
        if (near.id === "comet_visitor") store.recordBadge("comet"); // logbook: Comet chaser
        if (isBodyId(near.id)) store.chartWorld(near.id); // the first scan charts a body
        // A scanned career buoy keeps its HUD card up for a while (CareerTrail shows it).
        const buoy = buoyIndex(near.id);
        if (buoy >= 0) buoyCardState.scan = { index: buoy, until: gameTime(state.clock.getElapsedTime()) + BUOY_SCAN_HOLD_S };
        scanState.progress = 0;
        latched.current = true; // one report per hold
      }
    } else {
      if (!flight.input.scan) latched.current = false;
      scanState.progress = Math.max(0, scanState.progress - dt * 2);
    }
  });

  return null;
}
