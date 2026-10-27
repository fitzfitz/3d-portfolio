import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useModel } from "../../utils/sceneAssets";
import { JELLY_PATH, JELLY_LOOP_SECONDS, nearestLoopT } from "../../data/jellyfishPath";
import { DESTINATIONS } from "../../data/destinations";
import { guideLines } from "../../data/chatterLines";
import { gameKeyIgnored } from "../../hooks/useKeyboardInput";
import { setScannable, removeScannable } from "../../utils/scannables";
import { ambientTime } from "../../utils/ambientTime";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { assetUrl } from "../../utils/assetUrl";
import { flight, useSpaceStore, bodies, selectModalOpen } from "../../store/spaceStore";
import { ZONE_FACTOR } from "../../constants";
import { SOLAR_BODIES } from "../../data/solarSystem";
import { damp } from "../../utils/reactions";
import { JELLY_PULSE_RATE, JELLY_RADIUS, JELLY_SCALE, type JellyKeepOut } from "../../utils/jellyMood";
import { pulseRateTarget, surgeDistance } from "../../utils/jellyPulse";
import { createPostureState, stepPosture, stepVelocity } from "../../utils/jellyPosture";
import { GUIDE_STREAK_SPEED } from "../../utils/jellyGuide";
import { createJellyFrame, stepJellyFrame, beginReturn, streakLength, jellyScannable, type JellyFrameInput } from "../../utils/jellyFrame";
import { createWaypointTarget, makeGuideTarget } from "../../utils/waypointTarget";
import type { LogbookProgress } from "../../utils/logbook";
import { GuideRadio } from "../../utils/guideRadio";
import { takeGuideToggle, requestGuideToggle, setGuideActive } from "../../utils/guideToggle";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";
import { guideOfferBlocked, nestKeepOut } from "../../utils/jellyNest";
import { fitzDebug, type JellyGuideDebug } from "../../debug/bridge";
import { soundManager } from "../../audio/soundManager";
import { LOG_DEPTH_FRAG, LOG_DEPTH_FRAG_PARS, LOG_DEPTH_VERT, LOG_DEPTH_VERT_PARS } from "./logDepth";
import { glowScaleUnmapped } from "../../utils/sunLight";

/**
 * Full streak: the tentacles stretch by this much per unit of depth, so the
 * tips (depth 4.2 model units) trail ~10.5 more, ~8.4 u at JELLY_SCALE: a glow
 * about three bodies long behind it.
 */
const STREAK_STRETCH = 2.5;
/** Half-life (s) of the streak's length, so it grows and fades rather than pops. */
const STREAK_HALF_LIFE = 0.15;
/** The pulse rate jumps to this on meeting the ship and on arrival (spec: "pulses"), then eases back. */
const GUIDE_PULSE_KICK = 2.6;

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
  // 0..1 swim factor (spec 2026-10-23-jellyfish-guide). Every swim term below is
  // weighted by it, so at 0 they vanish and this is the standing shader exactly.
  uniform float uSwim;
  // Bell phase: equals uTime, except under reduced motion, where only this runs.
  uniform float uBeat;
  // 0..1 glow streak while the guide travels fast (spec "Bell pulse": "the glow
  // streak lengthens during warp"): the tentacles stretch far back along -y,
  // which the swim posture points behind it. The creature's own glow, so no
  // draw call, buffer or shader program is added (spec "Budgets").
  uniform float uStreak;
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
    float contract = pulseCycle(uBeat);
    // Swimming deepens the stroke (propulsion): up to 1.6x at uSwim 1.
    float stroke = 1.0 + 0.6 * uSwim;
    p.xz *= 1.0 - bell * contract * 0.28 * stroke;
    p.y += bell * contract * 0.35 * stroke * max(p.y, 0.0);

    // Tentacles: waves TRAVEL down the length (phase moves with -uTime),
    // amplitude grows toward the tips; secondary ripple adds organic detail
    // Swimming streams them straight back: less lateral curl (down to 0.3x),
    // stretched along -y, with a lateral ripple travelling down their length.
    float curl = 1.0 - 0.7 * uSwim;
    p.x += tent * sin(p.y * 2.6 - uTime * 2.2) * 0.16 * depth * curl;
    p.z += tent * cos(p.y * 1.7 - uTime * 1.5 + 1.3) * 0.16 * depth * curl;
    p.x += tent * sin(p.y * 6.0 - uTime * 4.0) * 0.035 * depth;
    p.y -= tent * uSwim * 0.18 * depth;
    p.y -= tent * uStreak * ${STREAK_STRETCH.toFixed(2)} * depth;
    float ripple = tent * uSwim * 0.07 * depth * sin(p.y * 3.4 + uTime * 5.0);
    p.x += ripple;
    p.z += ripple * 0.6;
    // Contraction draws the tentacles inward, trailing the bell
    p.xz *= 1.0 - tent * pulseCycle(uBeat - 0.35) * 0.14;

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
  uniform float uGlow;  // glowScaleUnmapped: bioluminescence holds its 1 AU brightness far out
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
    gl_FragColor = vec4((col + ring * vec3(0.5, 0.9, 1.0) * 0.4) * uGlow, mix(tentAlpha, bellAlpha, bellMask));
  }
`;

// JS mirror of pulseCycle for the swim surge
function pulseCycle(t: number): number {
  const c = ((t / 3.2) % 1 + 1) % 1;
  const up = THREE.MathUtils.smoothstep(c, 0.55, 0.68);
  const down = 1 - THREE.MathUtils.smoothstep(c, 0.68, 0.95);
  return up * down;
}

/** Frame-loop scratch for the idle wobble (module scope: the loop allocates nothing). */
const wobbleEuler = new THREE.Euler();
const wobbleQuat = new THREE.Quaternion();
const postureQuat = new THREE.Quaternion();

/**
 * The loop point at phase `t`, with the swim surge along the tangent and the
 * slow bob (into `path`), and without them (into `base`). Module scope so the
 * frame loop builds no closure.
 */
function loopPoint(t: number, surge: number, bob: number, path: THREE.Vector3, base: THREE.Vector3, tangent: THREE.Vector3) {
  JELLY_PATH.getPointAt(t, path);
  base.copy(path);
  JELLY_PATH.getTangentAt(t, tangent);
  path.addScaledVector(tangent, surge);
  path.y += bob;
}

export default function SpaceJellyfish() {
  const { scene } = useModel(assetUrl("/models/creature.glb"));
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const tOffset = useRef(0);
  /**
   * Its whereabouts: loop and moods while roaming, the guide while guiding,
   * the swim home in between (utils/jellyFrame.ts). `frame.mood` is the mood
   * state the e2e probes read as `fitzDebug.jelly`.
   */
  const frame = useMemo(createJellyFrame, []);
  const jelly = frame.mood;
  /**
   * Swim posture (spec 2026-10-23-jellyfish-guide). `posture.swim` is the 0..1
   * swim factor, updated every frame: the shader's `uSwim` (tentacle ripple,
   * pulse strength) reads it from here, not by re-deriving the speed.
   */
  const posture = useMemo(createPostureState, []);
  const pathPos = useMemo(() => new THREE.Vector3(), []);
  /** The path point before surge and bob (jellyMood measures drift from it). */
  const basePos = useMemo(() => new THREE.Vector3(), []);
  const tangent = useMemo(() => new THREE.Vector3(), []);
  const keepOut = useMemo<JellyKeepOut[]>(
    () => [
      ...SOLAR_BODIES.map((b) => ({ x: 0, y: 0, z: 0, r: b.size * ZONE_FACTOR + JELLY_RADIUS, body: b.size + JELLY_RADIUS })),
      // The Nest's fighting area (C9): fixed, after the bodies (the frame loop updates only theirs).
      nestKeepOut(),
    ], []);
  /** The guide's target (spec, build ruling R1) and the logbook progress it reads, reused every frame. */
  const target = useMemo(createWaypointTarget, []);
  const guideTarget = useMemo(makeGuideTarget, []);
  const progress = useMemo<LogbookProgress>(
    () => ({ visitedDossiers: [], shardsCollected: [], badges: [] }), []);
  /** Reused every frame: the frame step's input, so the loop allocates nothing. */
  const frameIn = useMemo<JellyFrameInput>(() => ({
    pathPos, basePos, ship: flight, shipVel: { x: 0, y: 0, z: 0 }, shipNose: { x: 0, y: 0, z: 1 }, shipSpeed: 0, warping: false,
    target: null, targetId: "", targetRadius: 0, progress: 0, blocked: false, reducedMotion: false, toggle: false, keepOut,
  }), [pathPos, basePos, keepOut]);
  /** Last frame's ship position, for its velocity (the guide matches it, warp included). */
  const lastShip = useMemo(() => ({ x: 0, y: 0, z: 0, has: false }), []);
  /**
   * Last frame's creature position, for its true speed: the streak's length
   * reads it (the posture's velocity is capped at POSTURE_V_MAX, ~9.5 u/s).
   */
  const lastJelly = useMemo(() => ({ x: 0, y: 0, z: 0, has: false }), []);
  /**
   * Destinations reached this session, one bit each (DESTINATIONS order), and
   * how many: part of the progress signature (spec "Offering itself": "no
   * newly reached destination").
   */
  const reached = useRef({ mask: 0, count: 0 });
  const radio = useMemo(() => new GuideRadio(guideLines), []);
  const streak = useRef(0);
  /** Registered with the scanner (only while it roams: jellyScannable). */
  const scannable = useRef(false);
  useEffect(() => () => { removeScannable("jellyfish"); setGuideActive(false); }, []);
  // The pulse runs on its own accumulated clock so its rate can follow the
  // mood and speed without jumping the phase. It advances on ambient time,
  // except under reduced motion (which freezes that), where it runs slow on
  // frame time.
  const pulseClock = useRef(0);
  const pulseRate = useRef(1);
  const slowBeat = useRef(0);
  const lastAmbient = useRef<number | null>(null);

  /**
   * The guide as the e2e probes read it (spec, build ruling R6): live, written every frame
   * and mirrored onto the bridge (with the mood state) only in dev.
   * `up` is the body's +y in world space, `vel` the posture's smoothed velocity.
   */
  const guideDebug = useMemo<JellyGuideDebug>(() => ({
    state: "roaming", pos: { x: 0, y: 0, z: 0 }, vel: posture.vel, up: { x: 0, y: 1, z: 0 }, swim: 0,
    streak: 0, returning: false, guide: frame.guide,
  }), [posture, frame]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.jelly = jelly;
    fitzDebug.jellyGuide = guideDebug;
    return () => { fitzDebug.jelly = null; fitzDebug.jellyGuide = null; };
  }, [jelly, guideDebug]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        // uGlow is the shared object itself (sunLight.ts), written once a frame.
        uniforms: { uTime: { value: 0 }, uSwim: { value: 0 }, uBeat: { value: 0 }, uStreak: { value: 0 }, uGlow: glowScaleUnmapped },
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
    // The vertex shader sways tentacles a little past the authored mesh (0.86 of a
    // 2.64 model-unit bound), so pad the bound by a ratio rather than disabling
    // culling; the ratio is in model units, so it holds at any JELLY_SCALE. At
    // 65k additive, double-sided triangles it used to draw every frame wherever it was.
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius *= 1.5;
    return g;
  }, [scene]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // J calls the guide, or sends it back to roaming (spec "Calling it"). Not
  // while typing, not on key repeat (holding J would flicker it), not while
  // the bottle panel owns the keys or behind the résumé (gameKeyIgnored, as
  // App's game keys), and not under a dossier or dock panel, where the touch
  // button is hidden too and the frozen frame loop would only apply the press
  // after it closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyJ") return;
      const s = useSpaceStore.getState();
      if (gameKeyIgnored({ target: e.target as HTMLElement | null, repeat: e.repeat, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey }, s)) return;
      if (selectModalOpen(s)) return;
      requestGuideToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const time = ambientTime(state.clock.getElapsedTime());

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
    // Reduced motion freezes ambient time (so `uTime`, which drives the tentacle
    // sway and rings, stays frozen as before), but the spec still wants the bell
    // to pulse slowly: `uBeat` carries the bell phase and steps on frame time
    // there (spec, build ruling R11: only the bell may move).
    const store = useSpaceStore.getState();
    const reduced = store.reducedMotion;
    pulseRate.current = damp(pulseRate.current, pulseRateTarget(JELLY_PULSE_RATE[jelly.mood], posture.swim, reduced), 0.5, dt);
    pulseClock.current += step * pulseRate.current;
    const pulseTime = pulseClock.current + 4 * Math.sin(time * 0.045);
    // Outside reduced motion the beat IS pulseTime; the slow clock tracks it so
    // entering reduced motion continues from the same phase.
    if (reduced) slowBeat.current += dt * pulseRate.current; else slowBeat.current = pulseTime;
    const beatTime = slowBeat.current;
    material.uniforms.uTime.value = pulseTime;
    material.uniforms.uBeat.value = beatTime;
    // No tentacle ripple or stretch under reduced motion (posture still follows).
    material.uniforms.uSwim.value = reduced ? 0 : posture.swim;
    const t = ((time / JELLY_LOOP_SECONDS + tOffset.current) % 1 + 1) % 1;
    // Jet propulsion: surge forward on each contraction stroke, plus a slow bob —
    // the drift is no longer a constant glide.
    // Surge reads the same warped clock as the shader, so the propulsion stroke
    // stays locked to the visible contraction rather than drifting out of sync.
    // Reduced motion: no surge (spec), only the bell moves.
    const surge = surgeDistance(pulseCycle(beatTime - 0.15), reduced);
    const bob = Math.sin(time * 0.5) * 0.8;
    loopPoint(t, surge, bob, pathPos, basePos, tangent);

    // The keep-outs follow the orbiting bodies: the moods and the guide both clear them.
    for (let i = 0; i < SOLAR_BODIES.length; i++) {
      const b = bodies[SOLAR_BODIES[i].id];
      keepOut[i].x = b.x; keepOut[i].y = b.y; keepOut[i].z = b.z;
    }

    // Raw frame time, capped (the guide caps it again at 0.25 s): the lost timer
    // and the station keeping need real seconds, not the 0.05 s-capped dt.
    const frameDt = Math.min(delta, 0.25);
    const fi = frameIn;
    if (lastShip.has && frameDt > 0) {
      fi.shipVel.x = (flight.x - lastShip.x) / frameDt;
      fi.shipVel.y = (flight.y - lastShip.y) / frameDt;
      fi.shipVel.z = (flight.z - lastShip.z) / frameDt;
    }
    lastShip.x = flight.x; lastShip.y = flight.y; lastShip.z = flight.z; lastShip.has = true;
    // The nose, as pitchFlight.ts noseDirection has it, written in place (that
    // helper returns a new object): the guide holds its station in front of it.
    const cp = Math.cos(flight.pitch);
    fi.shipNose.x = Math.sin(flight.heading) * cp;
    fi.shipNose.y = Math.sin(flight.pitch);
    fi.shipNose.z = Math.cos(flight.heading) * cp;
    fi.shipSpeed = flight.speed;
    fi.warping = store.isWarping;
    fi.reducedMotion = reduced;
    fi.toggle = takeGuideToggle();

    // Target (spec, build ruling R1): the HUD's next step, then the nearest uncharted world.
    progress.visitedDossiers = store.visitedDossiers;
    progress.shardsCollected = store.shardsCollected;
    progress.badges = store.badges;
    const has = guideTarget(flight, progress, store.charted, bodies, target);
    fi.target = has ? target : null;
    fi.targetId = has ? target.id : "";
    fi.targetRadius = has ? target.radius : 0;

    // Progress signature: every count only grows, so their sum changes on any
    // step forward (spec "Offering itself": a dossier opened, a destination
    // reached, a world charted, a logbook entry earned).
    const r = reached.current;
    for (let i = 0; i < DESTINATIONS.length; i++) {
      if (store.activeZone === DESTINATIONS[i].id && !(r.mask & (1 << i))) { r.mask |= 1 << i; r.count++; }
    }
    fi.progress = store.visitedDossiers.length + store.badges.length + store.charted.length + store.shardsCollected.length + r.count;

    // Offer blockers (spec "Offering itself"): docked or orbit-locked, a dossier
    // open, racing, photo mode, the classic résumé, or the radio held by a fresh
    // broadcast (RADIO_BUSY_S, as the hails and callouts wait) or a queued
    // logbook line, or the ship in the Nest's fighting area.
    const now = Date.now();
    const lastLine = store.broadcast;
    const radioBusy = (lastLine !== null && now - lastLine.at < RADIO_BUSY_S * 1000) || now < store.logbookLineAt;
    fi.blocked = guideOfferBlocked(store, radioBusy);

    stepJellyFrame(frame, fi, frameDt);
    // The touch GUIDE button's pressed state; notifies only on a change.
    setGuideActive(frame.guide.guiding);
    if (frame.handBack) {
      // Resume the loop at the phase nearest where the guide left it; the gap
      // swims home from there (beginReturn), never a teleport.
      const near = nearestLoopT(frame.pos);
      tOffset.current = near - time / JELLY_LOOP_SECONDS;
      loopPoint(near, surge, bob, pathPos, basePos, tangent);
      beginReturn(frame, pathPos, reduced);
    }

    const ev = frame.guide.event;
    const line = radio.update(ev, frame.guide.offered, now / 1000, radioBusy, frame.guide.targetId);
    // The guide's own call with each line it sends: the typewriter's tick alone
    // was near inaudible (owner, after #54: "I don't hear any radio sound").
    if (line) { store.sendBroadcast(line); soundManager.guideChime(); }
    // Spec "Calling it": "it streaks to the ship, pulses"; "Arriving": "pulses".
    // A kick to the pulse rate that eases back (the phase never jumps).
    if (!reduced && (ev === "met" || ev === "arrived")) pulseRate.current = GUIDE_PULSE_KICK;

    groupRef.current.position.set(frame.pos.x, frame.pos.y, frame.pos.z);
    // Posture follows the real frame-to-frame motion (surge, bob and mood offset
    // included), smoothed; raw delta, not the 0.05 s-capped dt, so a long frame
    // does not inflate the speed. Jumps (reduced motion appearing, a ship jump
    // the guide follows) count as no sample.
    const g = groupRef.current;
    stepVelocity(posture, g.position.x, g.position.y, g.position.z, Math.min(delta, 0.25));
    stepPosture(posture, posture.vel, dt, postureQuat);
    // The old slow idle wobble rides on top while standing and fades out as it
    // swims (a steady heading reads as purposeful); the old lean toward the path
    // tangent is superseded by the posture.
    const stand = 1 - posture.swim;
    wobbleEuler.set(Math.sin(time * 0.31) * 0.06 * stand, Math.sin(time * 0.23) * 0.25 * stand, Math.cos(time * 0.27) * 0.06 * stand);
    wobbleQuat.setFromEuler(wobbleEuler);
    g.quaternion.copy(postureQuat).multiply(wobbleQuat);

    // The glow streak: the guide's fast travel, or a fast swim home; never under
    // reduced motion (spec). Its stretched tentacles outgrow the padded cull
    // bound, so culling is off while it shows (one object, a flag, no cost).
    const speed = lastJelly.has && frameDt > 0
      ? Math.hypot(g.position.x - lastJelly.x, g.position.y - lastJelly.y, g.position.z - lastJelly.z) / frameDt : 0;
    lastJelly.x = g.position.x; lastJelly.y = g.position.y; lastJelly.z = g.position.z; lastJelly.has = true;
    const streakOn = frame.guide.streak || (frame.returning && speed > GUIDE_STREAK_SPEED);
    // Reduced motion drops it at once rather than fading it out.
    streak.current = reduced ? 0 : damp(streak.current, streakLength(streakOn, speed, false), STREAK_HALF_LIFE, dt);
    material.uniforms.uStreak.value = streak.current;
    if (meshRef.current) meshRef.current.frustumCulled = streak.current < 0.01;

    // The bridge (spec, build ruling R6); written unconditionally, it allocates nothing.
    const q = g.quaternion, gd = guideDebug;
    gd.state = frame.guide.name;
    gd.pos.x = g.position.x; gd.pos.y = g.position.y; gd.pos.z = g.position.z;
    // Body +y in world space: the second column of the rotation.
    gd.up.x = 2 * (q.x * q.y - q.w * q.z);
    gd.up.y = 1 - 2 * (q.x * q.x + q.z * q.z);
    gd.up.z = 2 * (q.y * q.z + q.w * q.x);
    gd.swim = posture.swim;
    gd.streak = streak.current;
    gd.returning = frame.returning;
    // The scanner may take it only while it roams (jellyFrame.ts jellyScannable).
    if (jellyScannable(frame)) {
      setScannable("jellyfish", g.position.x, g.position.y, g.position.z, "UNKNOWN_LIFEFORM");
      scannable.current = true;
    } else if (scannable.current) {
      removeScannable("jellyfish");
      scannable.current = false;
    }
  });

  return (
    <group ref={groupRef} name="SpaceJellyfish" scale={JELLY_SCALE}>
      <mesh ref={meshRef} geometry={geometry} material={material} />
    </group>
  );
}
