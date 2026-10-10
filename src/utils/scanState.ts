/**
 * Mutable HUD telemetry for ScanRing — deliberately outside React state (read
 * via rAF). Written by the Scanner component inside the canvas. Lives here,
 * not in Scanner.tsx, so the HUD can read it without importing R3F into the
 * main bundle.
 */
export const scanState = { progress: 0, label: "" };
