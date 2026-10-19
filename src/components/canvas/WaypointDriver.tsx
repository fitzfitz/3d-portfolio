import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { planets, projectById } from "../../constants";
import { DESTINATIONS, WAYPOINT_PLANET_NAMES, afterPlanets, destinationById } from "../../data/destinations";
import { bodies, flight, useSpaceStore } from "../../store/spaceStore";
import { nextWaypoint } from "../../utils/navigation";
import { waypointState } from "../../utils/waypointState";
import { RACE_GATES } from "../../data/ringCourse";

/** Destinations are fixed points; built once so the frame loop allocates nothing. */
const DESTINATION_POINTS = new Map<string, { x: number; y: number; z: number }>(
  DESTINATIONS.map((d) => [d.id, { x: d.pos[0], y: d.pos[1], z: d.pos[2] }]),
);
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

/** Headless: projects the next unread dossier (then the next destination) to the screen — or, mid-lap, the next time-trial ring. */
export default function WaypointDriver() {
  useFrame(({ camera, size }) => {
    const s = useSpaceStore.getState();
    // Mid-lap, the waypoint belongs to the time trial: point at the next ring.
    const race = s.race.phase === "running" ? s.race : null;
    const id = race ? "" : nextWaypoint(flight, WAYPOINT_PLANET_NAMES, bodies, s.visitedDossiers, afterPlanets(s.badges));
    // Nothing to point at while docked there or already inside its pull.
    if (s.isOrbitLocked || (!race && s.activeZone === id)) { waypointState.active = false; return; }
    const t = race ? RACE_GATES[race.next].c : DESTINATION_POINTS.get(id) ?? bodies[id];
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
      waypointState.label = race.next === 0 ? "FINISH" : `RING ${race.next}/${RACE_GATES.length - 1}`;
      waypointState.color = "#ffb020";
      return;
    }
    const dest = destinationById(id);
    waypointState.label = dest ? dest.label : (projectById(id)?.title ?? id).toUpperCase();
    waypointState.color = dest ? dest.color : (planets.find((p) => p.name === id)?.color ?? "#00ff87");
  });
  return null;
}
