import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { JELLY_PATH, JELLY_NEAR_T, JELLY_LOOP_SECONDS } from "../../data/jellyfishPath";
import { isEditableTarget } from "../../hooks/useKeyboardInput";
import { setScannable } from "../../utils/scannables";
import { ambientTime } from "../../utils/ambientTime";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { assetUrl } from "../../utils/assetUrl";
import { flight, useSpaceStore, bodies } from "../../store/spaceStore";
import { ZONE_FACTOR } from "../../constants";
import { SOLAR_BODIES } from "../../data/solarSystem";
import { damp } from "../../utils/reactions";
import { createJellyState, stepJelly, JELLY_PULSE_RATE, JELLY_RADIUS, type JellyKeepOut, type JellyInput } from "../../utils/jellyMood";
import { fitzDebug } from "../../debug/bridge";
import { LOG_DEPTH_FRAG, LOG_DEPTH_FRAG_PARS, LOG_DEPTH_VERT, LOG_DEPTH_VERT_PARS } from "./logDepth";

// Propulsion cycle (3.2s): slow refill, then a sharp contraction stroke.
// Mirrored in JS below for the swim surge — keep the two in sync.
const PULSE_GLSL = /* glsl */ `
  float pulseCycle(float t) {
    float c = fract(t / 3.2);
    return smoothstep(0.55, 0.68, c) * (1.0 - smoothstep(0.68, 0.95, c));
  }
`;

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying float vY;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vContract;
  ${""}
  ${PULSE_GLSL}
  ${LOG_DEPTH_VERT_PARS}
  void main() {
    vec3 p = position;
    float bell = smoothstep(-0.3, 0.5, p.y);
    float tent = 1.0 - smoothstep(-0.5, 0.1, p.y);
    float depth = max(0.0, -p.y);

    // Bell stroke: contract radially, stretch upward — a real swimming beat
    float contract = pulseCycle(uTime);
    p.xz *= 1.0 - bell * contract * 0.28;
    p.y += bell * contract * 0.35 * max(p.y, 0.0);

    // Tentacles: waves TRAVEL down the length (phase moves with -uTime),
    // amplitude grows toward the tips; secondary ripple adds organic detail
    p.x += tent * sin(p.y * 2.6 - uTime * 2.2) * 0.16 * depth;
    p.z += tent * cos(p.y * 1.7 - uTime * 1.5 + 1.3) * 0.16 * depth;
    p.x += tent * sin(p.y * 6.0 - uTime * 4.0) * 0.035 * depth;
    // Contraction draws the tentacles inward, trailing the bell
    p.xz *= 1.0 - tent * pulseCycle(uTime - 0.35) * 0.14;

    vY = position.y;
    vContract = contract;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
    ${LOG_DEPTH_VERT}
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying float vY;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vContract;
  ${LOG_DEPTH_FRAG_PARS}
  void main() {
    ${LOG_DEPTH_FRAG}
    float fresnel = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0), 1.8);
    // Bell (above the rim) vs tentacles/oral arms (below), by authored height.
    float bellMask = smoothstep(-0.3, 0.25, vY);
    // Bell: lavender shimmering toward pink. Tentacles: cyan. A per-height
    // gradient like a real moon jelly, instead of the whole body cycling
    // cyan<->magenta, which washed it into one pink volume.
    vec3 bellCol = mix(vec3(0.72, 0.58, 1.0), vec3(1.0, 0.45, 0.82), 0.5 + 0.5 * sin(uTime * 0.4));
    vec3 tentCol = vec3(0.1, 0.92, 1.0);
    vec3 col = mix(tentCol, bellCol, bellMask);
    // Bioluminescent rings pulsing DOWN the body — the strongest "alive" cue
    float ring = smoothstep(0.78, 1.0, sin(vY * 2.4 - uTime * 2.4));
    // Bell: rim brightens on each contraction stroke.
    float rim = fresnel * (0.55 + 0.45 * vContract);
    float core = smoothstep(0.0, 0.8, vY) * (0.30 + 0.25 * vContract);
    float bellAlpha = rim + ring * 0.25 + core * 0.3;
    // Tentacles are hair-thin tubes: a fresnel term flips 0<->1 across a
    // pixel-wide tube and shimmered into dashes. Steady soft alpha instead,
    // fading toward the tips.
    float tipFade = 1.0 - smoothstep(1.2, 4.2, -vY);
    float tentAlpha = (0.34 + ring * 0.22) * tipFade;
    gl_FragColor = vec4(col + ring * vec3(0.5, 0.9, 1.0) * 0.4, mix(tentAlpha, bellAlpha, bellMask));
  }
`;

// JS mirror of pulseCycle for the swim surge
function pulseCycle(t: number): number {
  const c = ((t / 3.2) % 1 + 1) % 1;
  const up = THREE.MathUtils.smoothstep(c, 0.55, 0.68);
  const down = 1 - THREE.MathUtils.smoothstep(c, 0.68, 0.95);
  return up * down;
}

export default function SpaceJellyfish() {
  const { scene } = useGLTF(assetUrl("/models/creature.glb"));
  const groupRef = useRef<THREE.Group>(null);
  const tOffset = useRef(0);
  const jelly = useMemo(createJellyState, []);
  const pathPos = useMemo(() => new THREE.Vector3(), []);
  /** The path point before surge and bob (jellyMood measures drift from it). */
  const basePos = useMemo(() => new THREE.Vector3(), []);
  const tangent = useMemo(() => new THREE.Vector3(), []);
  const keepOut = useMemo<JellyKeepOut[]>(
    () => SOLAR_BODIES.map((b) => ({ x: 0, y: 0, z: 0, r: b.size * ZONE_FACTOR + JELLY_RADIUS, body: b.size + JELLY_RADIUS })), []);
  /** Reused every frame: the mood step's input, so the loop allocates nothing. */
  const jellyInput = useMemo<JellyInput>(
    () => ({ pathPos, basePos, player: flight, playerSpeed: 0, boosting: false, keepOut, dt: 0 }),
    [pathPos, basePos, keepOut],
  );
  // The pulse runs on its own accumulated clock so its rate can follow the
  // mood without jumping the phase. It advances on ambient time, so it still
  // freezes under reduced motion.
  const pulseClock = useRef(0);
  const pulseRate = useRef(1);
  const lastAmbient = useRef<number | null>(null);

  // Mirrored onto the bridge purely so the e2e probe can read it.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.jelly = jelly;
    return () => { fitzDebug.jelly = null; };
  }, [jelly]);
  const timeRef = useRef(0);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  const geometry = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((o) => {
      if (!src && o instanceof THREE.Mesh) src = o;
    });
    if (!src) throw new Error("creature.glb contains no mesh");
    // Bake the node's dequantization transform (KHR_mesh_quantization) so the
    // shader's y-based masks operate on authored coordinates, and regeneration
    // can't silently rescale the creature.
    // Float-safe: the quantized GLB stores positions in [-1, 1] (see util).
    const g = bakeNodeTransform(src);
    // The vertex shader sways tentacles a little past the authored mesh, so
    // pad the bound rather than disabling culling: at 65k additive,
    // double-sided triangles it used to draw every frame wherever it was.
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius *= 1.5;
    return g;
  }, [scene]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Debug/easter-egg summon: J fast-forwards the loop phase so the jelly appears nearby.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyJ") return;
      const t = e.target as HTMLElement | null;
      if (isEditableTarget(t)) return;
      const now = timeRef.current;
      tOffset.current = JELLY_NEAR_T - ((now / JELLY_LOOP_SECONDS) % 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const time = ambientTime(state.clock.getElapsedTime());
    timeRef.current = time;

    /**
     * Pulse rhythm, time-warped so the creature does not beat like a metronome.
     * The contraction cycle is `fract(t / 3.2)` in both the shader and the JS
     * `pulseCycle`, which meant an exactly 3.2s period forever — the single
     * biggest reason the jellyfish read as mechanical rather than alive.
     *
     * Warping the time argument varies the effective period instead of adding a
     * second system: d(warp)/dt = 1 + 4·0.045·cos(...) = 1 ± 0.18, so the
     * period breathes between 3.2/1.18 ≈ 2.7s and 3.2/0.82 ≈ 3.9s over a slow
     * ~140s envelope. The derivative never reaches zero (min 0.82), so the
     * pulse cannot stall or run backwards.
     *
     * Only the rhythm is warped. Path progress and the slow drift below stay on
     * raw `time`, so the creature still traverses its route at a steady average
     * pace — it is the heartbeat that varies, not the swimming.
     *
     * The base clock now accumulates at a mood-dependent rate (JELLY_PULSE_RATE).
     */
    const dt = Math.min(delta, 0.05);
    const step = lastAmbient.current === null ? 0 : time - lastAmbient.current;
    lastAmbient.current = time;
    pulseRate.current = damp(pulseRate.current, JELLY_PULSE_RATE[jelly.mood], 0.5, dt);
    pulseClock.current += step * pulseRate.current;
    const pulseTime = pulseClock.current + 4 * Math.sin(time * 0.045);
    material.uniforms.uTime.value = pulseTime;
    const t = ((time / JELLY_LOOP_SECONDS + tOffset.current) % 1 + 1) % 1;
    JELLY_PATH.getPointAt(t, pathPos);
    basePos.copy(pathPos);
    JELLY_PATH.getTangentAt(t, tangent);
    // Jet propulsion: surge forward on each contraction stroke, plus a slow bob —
    // the drift is no longer a constant glide.
    // Surge reads the same warped clock as the shader, so the propulsion stroke
    // stays locked to the visible contraction rather than drifting out of sync.
    const surge = pulseCycle(pulseTime - 0.15);
    pathPos.addScaledVector(tangent, surge * 2.2);
    pathPos.y += Math.sin(time * 0.5) * 0.8;

    // Mood: an eased offset off the path toward or away from the pilot.
    const store = useSpaceStore.getState();
    if (!store.reducedMotion) {
      for (let i = 0; i < SOLAR_BODIES.length; i++) {
        const b = bodies[SOLAR_BODIES[i].id];
        keepOut[i].x = b.x; keepOut[i].y = b.y; keepOut[i].z = b.z;
      }
      jellyInput.playerSpeed = flight.speed;
      jellyInput.boosting = store.isWarping;
      jellyInput.dt = dt;
      stepJelly(jelly, jellyInput);
    }
    groupRef.current.position.set(pathPos.x + jelly.offset.x, pathPos.y + jelly.offset.y, pathPos.z + jelly.offset.z);
    groupRef.current.rotation.set(
      tangent.z * 0.12 + Math.sin(time * 0.31) * 0.06,
      Math.sin(time * 0.23) * 0.25,
      -tangent.x * 0.12 + Math.cos(time * 0.27) * 0.06
    );
    setScannable("jellyfish", groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z, "UNKNOWN_LIFEFORM");
  });

  return (
    <group ref={groupRef} name="SpaceJellyfish" scale={6}>
      <mesh geometry={geometry} material={material} />
    </group>
  );
}
