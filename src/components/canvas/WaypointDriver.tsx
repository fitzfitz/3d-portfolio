import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { PORTAL_POS, planets, projectById } from "../../constants";
import { bodies, flight, useSpaceStore } from "../../store/spaceStore";
import { nextWaypoint } from "../../utils/navigation";
import { waypointState } from "../../utils/waypointState";


const PLANET_NAMES = planets.map((p) => p.name);
const PORTAL = { x: PORTAL_POS[0], y: PORTAL_POS[1], z: PORTAL_POS[2] };
const MARGIN = 0.88; // NDC fraction treated as "on screen"
const v = new THREE.Vector3();

/** Headless: projects the next unread dossier (then the portal) to the screen. */
export default function WaypointDriver() {
  useFrame(({ camera, size }) => {
    const s = useSpaceStore.getState();
    const id = nextWaypoint(flight, PLANET_NAMES, bodies, s.visitedDossiers);
    // Nothing to point at while docked there or already inside its pull.
    if (s.isOrbitLocked || s.activeZone === id) { waypointState.active = false; return; }
    const t = id === "contact" ? PORTAL : bodies[id];
    if (!t) { waypointState.active = false; return; }

    v.set(t.x, t.y, t.z).project(camera);
    const behind = v.z > 1;
    // Behind the camera, projection mirrors through the centre; flip it so the
    // edge arrow points the way the pilot actually has to turn.
    let nx = behind ? -v.x : v.x;
    let ny = behind ? -v.y : v.y;
    const onScreen = !behind && Math.abs(nx) < MARGIN && Math.abs(ny) < MARGIN;
    if (!onScreen) {
      const k = MARGIN / Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
      nx *= k; ny *= k;
    }
    waypointState.active = true;
    waypointState.onScreen = onScreen;
    waypointState.x = (nx * 0.5 + 0.5) * size.width;
    waypointState.y = (-ny * 0.5 + 0.5) * size.height;
    waypointState.angle = Math.atan2(-ny, nx);
    waypointState.distance = Math.hypot(t.x - flight.x, t.y - flight.y, t.z - flight.z);
    waypointState.label = id === "contact" ? "CONTACT PORTAL" : (projectById(id)?.title ?? id).toUpperCase();
    waypointState.color = id === "contact" ? "#ec4899" : (planets.find((p) => p.name === id)?.color ?? "#00ff87");
  });
  return null;
}
