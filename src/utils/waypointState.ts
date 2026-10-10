/**
 * Screen-space position of the HUD waypoint, in CSS pixels. Written each
 * frame by WaypointDriver (in the canvas) and read by WaypointMarker's rAF
 * loop — never React state, matching scanState/flight, so the marker costs
 * no renders during flight.
 */
export const waypointState = {
  active: false,
  /** True when the target projects inside the viewport margin. */
  onScreen: false,
  x: 0,
  y: 0,
  /** Edge-arrow direction in radians (screen space, 0 = right, +y down). */
  angle: 0,
  label: "",
  distance: 0,
  color: "#00ff87",
};
