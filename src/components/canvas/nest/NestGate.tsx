import { Suspense, lazy, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import { combat, flight } from "../../../store/spaceStore";
import { NEST_CENTRE } from "../../../data/nest";
import { NEST_LOAD_R } from "../../../utils/combat/constants";
import { markNestLoadFailed } from "../../../utils/combat/nestHud";
import SafeErrorBoundary from "../SafeErrorBoundary";
import NestEffects from "./NestEffects";

/**
 * The renderer, a chunk of its own (Ruling C16): the monster materials,
 * shading and instancing load with it, never with the canvas. Its glbs
 * (public/models-ondemand) load when it mounts.
 */
const NestMonsters = lazy(() => import("./NestMonsters"));

/**
 * The Nest's load gate (spec 2026-10-27-combat "Loading on demand"), always
 * mounted: nothing of the fight draws or downloads until the ship first
 * comes within NEST_LOAD_R (200 u) of the centre. Then it latches (local
 * state, one render, ever, for this canvas) and mounts the effects and the
 * monsters, which stay. A visitor who never goes near downloads nothing.
 * The monsters' own Suspense keeps their load from suspending the scene; an
 * error boundary keeps a failed load (offline, say) from taking the canvas
 * down: wave 1 then never starts, as the warm gate stays shut, and the
 * boundary marks `combat.loadFailed` so the HUD says the Nest is offline
 * instead of counting down forever (Ruling C22).
 */
const onLoadError = () => markNestLoadFailed(combat);

export default function NestGate() {
  const [near, setNear] = useState(false);
  const latched = useRef(false);
  const root = useRef<THREE.Group>(null);

  useFrame(() => {
    if (latched.current) return;
    const d = Math.hypot(flight.x - NEST_CENTRE[0], flight.y - NEST_CENTRE[1], flight.z - NEST_CENTRE[2]);
    if (d > NEST_LOAD_R) return;
    latched.current = true;
    // A new attempt (this canvas's first): a remounted canvas tries again.
    combat.loadFailed = false;
    setNear(true);
  });

  if (!near) return null;
  return (
    <group name="Nest" ref={root}>
      <NestEffects />
      <SafeErrorBoundary onError={onLoadError}>
        <Suspense fallback={null}>
          <NestMonsters warmRoot={root} />
        </Suspense>
      </SafeErrorBoundary>
    </group>
  );
}
