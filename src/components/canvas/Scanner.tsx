import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { nearestScannable } from "../../utils/scannables";
import { generateScanReport } from "../../utils/scanReport";
import { soundManager } from "../../audio/soundManager";

/** Mutable HUD telemetry for ScanRing — deliberately outside React state (read via rAF). */
export const scanState = { progress: 0, label: "" };

/** Headless: drives scan targeting/progress/report dispatch each frame. Renders nothing. */
export default function Scanner() {
  // Latches after a completed scan so holding the key/button doesn't immediately
  // restart another scan — released only once the input goes low.
  const latched = useRef(false);

  useFrame((_, dt) => {
    const near = nearestScannable(flight.x, flight.y, flight.z, 22);
    const store = useSpaceStore.getState();
    store.setScanTarget(near?.id ?? null);
    scanState.label = near?.label ?? "";

    if (near && flight.input.scan && !latched.current) {
      scanState.progress = Math.min(1, scanState.progress + dt / 1.6);
      if (scanState.progress >= 1) {
        store.sendBroadcast(generateScanReport(near.id));
        soundManager.scanBeep();
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
