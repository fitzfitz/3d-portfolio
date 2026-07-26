import { useRef, useMemo, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF, Trail } from "@react-three/drei";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { ambientTime } from "../../utils/ambientTime";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Three trade loops threading the volume: a climbing run (−80 → +110 with a
// return dive), a belt-gap weaver, and a high ring at portal altitude (spec §5).
const ROUTES = [
  [v(-110, -80, 80), v(-20, -30, 150), v(130, 20, -40), v(30, 65, -170), v(-140, 110, -70)],
  [v(150, -40, 60), v(60, 10, 180), v(-160, -25, 140), v(-90, 30, -30), v(40, -10, -120)],
  [v(0, 95, -200), v(170, 80, -100), v(200, 60, 80), v(0, 110, 120), v(-190, 90, -20)],
].map((pts) => new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5));

interface ShipDef { route: number; phase: number; loopSeconds: number }
const SHIPS: ShipDef[] = [
  { route: 0, phase: 0.0, loopSeconds: 110 },
  { route: 0, phase: 0.5, loopSeconds: 110 },
  { route: 1, phase: 0.2, loopSeconds: 140 },
  { route: 1, phase: 0.7, loopSeconds: 140 },
  { route: 2, phase: 0.4, loopSeconds: 90 },
];

const lookTarget = new THREE.Vector3();
const tanA = new THREE.Vector3();
const tanB = new THREE.Vector3();

export default function CargoTraffic() {
  const { scene } = useGLTF("/models/cargo_ship.glb");
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const count = isLowPerf ? 3 : 5;
  const rolls = useRef<number[]>(SHIPS.map(() => 0));

  // Clone the small ship per NPC; clone nav-light materials so each blinks with its own phase.
  const ships = useMemo(
    () =>
      SHIPS.map((_, i) => {
        const model = scene.clone(true);
        // glTF export maps the ship's Blender +Y nose to -Z, but Object3D.lookAt
        // points +Z at the target — flip the model inside a wrapper we steer.
        model.rotation.y = Math.PI;
        const group = new THREE.Group();
        group.add(model);
        group.name = `CargoShip${i}`;
        const navMats: THREE.MeshStandardMaterial[] = [];
        const engineMats: THREE.MeshStandardMaterial[] = [];
        model.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const m = o.material as THREE.MeshStandardMaterial;
            if (m.name === "NavRed" || m.name === "NavGreen") {
              const c = m.clone();
              o.material = c;
              navMats.push(c);
            } else if (m.name === "EngineGlow") {
              const c = m.clone();
              o.material = c;
              engineMats.push(c);
            }
          }
        });
        const dish = model.getObjectByName("RadarDish") ?? null;
        const trailTarget: RefObject<THREE.Object3D> = { current: group };
        return { group, navMats, engineMats, dish, trailTarget };
      }),
    [scene]
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const time = ambientTime(state.clock.getElapsedTime());
    for (let i = 0; i < count; i++) {
      const def = SHIPS[i];
      const ship = ships[i];
      const curve = ROUTES[def.route];
      // Route progress with a gentle speed wobble. `time / loopSeconds` alone is
      // pure linear arc-length travel — perfectly constant velocity forever,
      // which is the classic tell of a scripted path and made the traffic read
      // as mechanical rather than piloted. Two slow sines at incommensurate
      // periods (~52s and ~23s), phase-offset per ship by `i`, so no two ships
      // share a rhythm and the pattern never visibly repeats.
      //
      // Amplitudes are bounded so progress stays monotonic — a ship sliding
      // backwards along its spline would read as broken, not alive. The drift's
      // max derivative is 0.010*0.12 + 0.005*0.27 = 0.00255, against a base rate
      // of 1/loopSeconds. Worst case is the slowest route (140s): 0.00714 -
      // 0.00255 = +0.0046, still forward. Raising either amplitude past ~0.028
      // combined would break that on the 140s route.
      const drift = (Math.sin(time * 0.12 + i * 1.7) * 0.010 + Math.sin(time * 0.27 + i * 0.9) * 0.005);
      const t = (time / def.loopSeconds + def.phase + drift) % 1;

      curve.getPointAt(t, ship.group.position);
      ship.group.position.y += Math.sin(time * 0.6 + i * 2.1) * 0.35;
      curve.getPointAt((t + 0.003) % 1, lookTarget);
      ship.group.lookAt(lookTarget);

      // Banking: roll into curvature; extra roll away from the player when close.
      curve.getTangentAt(t, tanA);
      curve.getTangentAt((t + 0.01) % 1, tanB);
      let targetRoll = THREE.MathUtils.clamp(tanA.cross(tanB).y * 60, -0.5, 0.5);
      const dx = ship.group.position.x - flight.x;
      const dy = ship.group.position.y - flight.y;
      const dz = ship.group.position.z - flight.z;
      if (dx * dx + dy * dy + dz * dz < 144) targetRoll += Math.sign(dx || 1) * 0.35;
      rolls.current[i] += (targetRoll - rolls.current[i]) * (1 - Math.pow(0.01, dt));
      ship.group.rotateZ(rolls.current[i]);

      // Nav lights: sharp blink, per-ship phase
      const blink = Math.sin(time * 3 + i * 1.7) > 0.82 ? 4.5 : 0.3;
      for (const m of ship.navMats) m.emissiveIntensity = blink;

      // Engine burn: uneven thruster flicker, per-ship phase
      const burn = 2.6 + Math.sin(time * 7.3 + i * 2.3) * 0.6 + Math.sin(time * 13.7 + i) * 0.3;
      for (const m of ship.engineMats) m.emissiveIntensity = burn;

      // Radar dish: constant spin, on the ambient clock like everything else
      // in this loop (dt would keep it spinning under reduced motion).
      if (ship.dish) ship.dish.rotation.z = time * 1.2;
    }
  });

  return (
    <>
      {ships.slice(0, count).map((s, i) => (
        <primitive key={i} object={s.group} scale={1.6} />
      ))}
      {/* Faint engine wake, gated off in low-perf mode */}
      {!isLowPerf &&
        ships.slice(0, count).map((s, i) => (
          <Trail key={`t${i}`} target={s.trailTarget} width={1.1} length={3.5} color="#7fd8ff" attenuation={(t) => t * t} />
        ))}
    </>
  );
}
