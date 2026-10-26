import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { projectById } from "../../constants";
import { destinationById } from "../../data/destinations";
import { flight, useSpaceStore, selectModalOpen, selectRaceFlying } from "../../store/spaceStore";
import { createWaypointTarget, makeRecruiterTarget } from "../../utils/waypointTarget";
import { waypointState } from "../../utils/waypointState";
import { RACE_GATES } from "../../data/ringCourse";

const MARGIN = 0.88; // NDC fraction treated as "on screen"
/**
 * Off-screen targets get an arrow on an ellipse around the screen centre (in
 * NDC), not on the screen edge: the edges are lined with HUD panels
 * (telemetry, radar, sector list, controls strip), and an edge arrow kept
 * landing on one of them. The ellipse clears the ship below centre.
 */
const RING_X = 0.6;
const RING_Y = 0.5;
const v = new THREE.Vector3();
/** The waypoint's id and point, written each frame (utils/waypointTarget.ts: the helper the jellyfish guide shares). */
const wp = createWaypointTarget();
/** recruiterWaypoint's mapping, memoised on the badges array so a frame builds no closure. */
const recruiterTarget = makeRecruiterTarget();

/** Headless: projects the next unread dossier (then the next destination) to the screen — or, mid-race, the next ring. */
export default function WaypointDriver() {
  useFrame(({ camera, size }) => {
    const s = useSpaceStore.getState();
    // Mid-race, until the finish, the waypoint belongs to the race: point at the next ring.
    const race = selectRaceFlying(s) && s.raceView.phase === "running" ? s.raceView : null;
    const placed = !race && recruiterTarget(flight, s.visitedDossiers, s.badges, wp);
    const id = race ? "" : wp.id;
    // Nothing to point at while docked at a destination or inside its zone
    // (only destinations have one; a probe never sets activeZone).
    if (selectModalOpen(s) || (!race && s.activeZone === id)) { waypointState.active = false; return; }
    // The finish (ring N) is gate 0 again.
    const t = race ? RACE_GATES[race.next % RACE_GATES.length].c : placed ? wp : undefined;
    if (!t) { waypointState.active = false; return; }

    v.set(t.x, t.y, t.z).project(camera);
    const behind = v.z > 1;
    // Behind the camera, projection mirrors through the centre; flip it so the
    // edge arrow points the way the pilot actually has to turn.
    let nx = behind ? -v.x : v.x;
    let ny = behind ? -v.y : v.y;
    const onScreen = !behind && Math.abs(nx) < MARGIN && Math.abs(ny) < MARGIN;
    if (!onScreen) {
      // Direction measured in pixels, so the arrow points the true way on a
      // wide screen, then placed on the ring.
      const a = Math.atan2(ny * size.height, nx * size.width);
      nx = Math.cos(a) * RING_X;
      ny = Math.sin(a) * RING_Y;
    }
    waypointState.active = true;
    waypointState.onScreen = onScreen;
    waypointState.x = (nx * 0.5 + 0.5) * size.width;
    waypointState.y = (-ny * 0.5 + 0.5) * size.height;
    waypointState.angle = Math.atan2(-ny, nx);
    waypointState.distance = Math.hypot(t.x - flight.x, t.y - flight.y, t.z - flight.z);
    if (race) {
      waypointState.label = race.next >= RACE_GATES.length ? "FINISH" : `RING ${race.next}/${RACE_GATES.length - 1}`;
      waypointState.color = "#ffb020";
      return;
    }
    const dest = destinationById(id);
    const proj = dest ? undefined : projectById(id);
    waypointState.label = dest ? dest.label : `${(proj?.title ?? id).toUpperCase()} PROBE`;
    waypointState.color = dest ? dest.color : (proj?.color ?? "#00ff87");
  });
  return null;
}
