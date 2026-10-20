import * as THREE from "three";
import { RING_MU_MIN, RING_TAU_MAX } from "../../utils/ringOptics";
import { exposureCompensation, litExposure, SUN_IRRADIANCE_AT_AU } from "../../utils/sunLight";
import { SUN_SHADOW_CORE_GLSL, sunShadowUniforms } from "./sunShadow";
import { LOG_DEPTH_FRAG, LOG_DEPTH_FRAG_PARS, LOG_DEPTH_VERT, LOG_DEPTH_VERT_PARS } from "./logDepth";

/**
 * Material for flat navigation guides drawn on a RingGeometry (orbit paths,
 * gravity-field circles): a thin dashed line whose opacity fades with camera
 * distance.
 *
 * The plain MeshBasicMaterial these replaced was a constant-opacity ribbon,
 * fine from afar but — because the camera is always close to *some* part of
 * a 115-185u orbit while visiting a planet — it showed up as wide neon bands
 * slicing across every close-up. Fading near the camera keeps the guide for
 * orientation and removes it exactly where it used to dominate the frame.
 *
 * Readable at any range (the orbit ribbons, real-solar-system spec §6.2):
 * with `minHalfPx` the vertex shader widens the line with distance so its
 * half-width never drops under that many CSS px, and with `tickHalfPx` a
 * tick (orbitRibbon.ts) keeps at least that half-length; ticks are solid,
 * not dashed. Both read the geometry's `aSide` / `aAlong` offsets from the
 * line's centre (orbitRibbonGeometry), in the mesh's local units (the orbit
 * meshes are unscaled, their plane local XY). The width and a tick's bar are
 * turned about the line to face the camera, so an orbit seen edge-on from in
 * the ecliptic keeps them. At 0 (the default) the geometry draws as built;
 * a RingGeometry guide shares the same program, given zero offsets
 * (withGuideOffsets) so the attributes are never active but unbound.
 */
export interface GuideLineOptions {
  color: THREE.ColorRepresentation;
  opacity: number;
  /** Dashes around the full circle. 0 = solid. */
  dashes: number;
  /** Fade IN between these camera distances (hidden when closer than [0]). */
  fadeIn: [number, number];
  /** Fade OUT between these camera distances (hidden beyond [1]). Omit for none. */
  fadeOut?: [number, number];
  /** Least half-width on screen (CSS px); needs the aSide attribute. 0 = as built. */
  minHalfPx?: number;
  /** Least tick half-length on screen (CSS px); needs aAlong. 0 = as built. */
  tickHalfPx?: number;
}

/**
 * Gives a guide geometry built without them (a RingGeometry) zero `aSide` /
 * `aAlong` offsets, so the guide-line program's attributes are always bound.
 * Returns the geometry.
 */
export function withGuideOffsets(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute("position").count;
  for (const name of ["aSide", "aAlong"]) {
    if (!g.getAttribute(name)) g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  }
  return g;
}

/**
 * The view's height in CSS px, for the screen-constant width: shared by every
 * guide line, written each frame by SolarBodies (which draws the orbits).
 */
export const guideViewportHeight = { value: 800 };

const VERT = /* glsl */ `
  uniform float uMinHalfPx;
  uniform float uTickHalfPx;
  uniform float uViewportH;
  attribute vec3 aSide;
  attribute vec3 aAlong;
  varying vec3 vWorld;
  varying float vAngle;
  varying float vTick;
  ${LOG_DEPTH_VERT_PARS}
  // Grows an offset to at least minLen, keeping its direction (none stays none).
  vec3 atLeast(vec3 off, float minLen) {
    float l = length(off);
    return l > 0.0 ? off * (max(l, minLen) / l) : off;
  }
  // An in-plane offset o (world), turned about the line's own direction
  // t = n × o to face the camera, grown to minLen: along t × toCam, so the
  // width survives an edge-on view. orbitRibbon.ts facingOffset mirrors it.
  vec3 facing(vec3 o, vec3 n, vec3 toCam, float minLen) {
    float l = length(o);
    if (l == 0.0) return o;
    vec3 t = cross(n, o);
    vec3 f = cross(t, toCam);
    float fl = length(f);
    vec3 dir = fl > 1e-6 * length(t) * length(toCam) ? f / fl : o / l;
    return dir * max(l, minLen);
  }
  void main() {
    // RingGeometry lies in its local XY plane; the angle drives the dashes.
    vAngle = atan(position.y, position.x);
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    vTick = 0.0;
    // Off (0) for guides built without the offsets (zero there anyway).
    if (uMinHalfPx > 0.0) {
      // The line lies in its local XY plane (the orbit's perifocal frame).
      mat3 m = mat3(modelMatrix);
      vec3 centre = (modelMatrix * vec4(position - aSide - aAlong, 1.0)).xyz;
      vec3 n = normalize(m * vec3(0.0, 0.0, 1.0));
      vec3 toCam = cameraPosition - centre;
      // One CSS px in units at the centre's depth: 2 z tan(fov / 2) / H.
      float depth = max(-(viewMatrix * vec4(centre, 1.0)).z, 0.0);
      float px = 2.0 * depth / (projectionMatrix[1][1] * uViewportH);
      if (dot(aAlong, aAlong) > 0.0) {
        // A tick: its bar across the orbit faces the camera; its thickness
        // runs along the orbit, in the plane.
        vTick = 1.0;
        p = centre + atLeast(m * aSide, uMinHalfPx * px) + facing(m * aAlong, n, toCam, uTickHalfPx * px);
      } else {
        p = centre + facing(m * aSide, n, toCam, uMinHalfPx * px);
      }
    }
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    ${LOG_DEPTH_VERT}
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDashes;
  uniform vec2 uFadeIn;
  uniform vec2 uFadeOut;
  uniform float uExposureComp; // 1 / exposure where the post pass exposes (sunLight.ts)
  varying vec3 vWorld;
  varying float vAngle;
  varying float vTick;
  ${LOG_DEPTH_FRAG_PARS}
  void main() {
    ${LOG_DEPTH_FRAG}
    float d = distance(cameraPosition, vWorld);
    float fade = smoothstep(uFadeIn.x, uFadeIn.y, d) * (1.0 - smoothstep(uFadeOut.x, uFadeOut.y, d));
    float dash = 1.0;
    // A tick lies along one angle, so the dashes would blank it whole.
    if (uDashes > 0.0 && vTick < 0.5) {
      float t = fract(vAngle / 6.2831853 * uDashes);
      dash = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.55, 0.63, t));
    }
    float a = uOpacity * fade * dash;
    if (a < 0.003) discard;
    // An instrument projection, not light (F3): the same at every exposure.
    gl_FragColor = vec4(uColor * uExposureComp, a);
  }
`;

export function makeGuideLineMaterial(o: GuideLineOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(o.color) },
      uOpacity: { value: o.opacity },
      uDashes: { value: o.dashes },
      uFadeIn: { value: new THREE.Vector2(...o.fadeIn) },
      uFadeOut: { value: new THREE.Vector2(...(o.fadeOut ?? [1e6, 2e6])) },
      uMinHalfPx: { value: o.minHalfPx ?? 0 },
      uTickHalfPx: { value: o.tickHalfPx ?? 0 },
      // The shared object, so SolarBodies' one write reaches every guide.
      uViewportH: guideViewportHeight,
      // The shared object (not a copy), so ExposureDriver's one write reaches it.
      uExposureComp: exposureCompensation,
    },
  });
}

/**
 * Planetary ring: many thin translucent bands with gaps (a Cassini-style
 * division and finer ringlets), brighter toward the middle, faint at both
 * edges. Replaces a single flat emissive band that read as a neon hoop.
 *
 * With a shadow slot (F4, docs/UNIVERSE-RULES.md L20) the part of the ring in
 * its planet's shadow darkens: the shared disc-coverage maths of sunShadow.ts
 * against that one occluder slot (the uniform `uRingSlot`), from 1 in full sun
 * down to RING_NIGHT_FLOOR in the umbra.
 *
 * Every ring is scaled by `uIrradiance`, the sunlight at its orbit as a
 * fraction of 1 AU's (irradianceVsAU, L19), written each frame from the planet's live distance.
 *
 * With a ring map (`RING_MAP`, Saturn's rings, L14) the procedural
 * bands give way to a measured radial profile: a strip whose RGB is the
 * particle colour and whose alpha is the normal optical depth τ / uTauMax
 * (ringOptics.ts), u = 0 at the inner edge and 1 at the outer. Then:
 * - the viewer sees opacity 1 − exp(−τ/|μ|), μ the cosine of the view ray to
 *   the ring normal (ringViewOpacity): thin face-on, opaque edge-on;
 * - the particles single-scatter the sunlight (ringRadiance, its pure
 *   mirror), μ₀ the cosine of the sun's direction, x = τ/|μ|, x₀ = τ/|μ₀|:
 *   on the lit face the layer's diffuse reflection μ₀/(μ₀ + μ)·(1 − e^−(x₀+x)),
 *   whose thick limit is Lommel–Seeliger; on the unlit face its diffuse
 *   transmission μ₀/(μ₀ − μ)·(e^−x₀ − e^−x), which a thin ring passes almost
 *   whole and the opaque B core not at all. A thin layer gives τ/|μ| on either
 *   face, whatever the sun's elevation. Normalised (×2) to match a Lambert
 *   surface face-on, under the sun's radiance at 1 AU (the planets'
 *   MeshStandardMaterial gets E/π);
 * - that radiance is the layer's whole output, so it is written premultiplied
 *   (premultipliedAlpha: the blend is ONE, ONE − a): the background behind
 *   keeps e^−τ/|μ| of itself and the ring adds its light, with no division by
 *   the opacity.
 */
const RING_VERT = /* glsl */ `
  varying float vR;
  varying vec3 vWorld;
  #ifdef RING_MAP
  varying vec3 vRingNormal;
  #endif
  ${LOG_DEPTH_VERT_PARS}
  void main() {
    vR = length(position.xy);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    #ifdef RING_MAP
    // RingGeometry lies in its local XY plane: its normal is local +Z.
    vRingNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${LOG_DEPTH_VERT}
  }
`;

const RING_FRAG = /* glsl */ `
  #ifdef SUN_SHADOW_RING
  ${SUN_SHADOW_CORE_GLSL}
  uniform float uNightFloor;
  uniform int uRingSlot;
  #endif
  #if defined( SUN_SHADOW_RING ) || defined( RING_MAP )
  varying vec3 vWorld;
  #endif
  #ifdef RING_MAP
  #define RING_SUN_RADIANCE ${(SUN_IRRADIANCE_AT_AU / Math.PI).toFixed(4)}
  #define RING_MU_MIN ${RING_MU_MIN.toExponential()}
  uniform sampler2D uRingMap;
  uniform float uTauMax;
  varying vec3 vRingNormal;
  // ringOptics.ts ringRadiance: single scattering in a layer of normal
  // optical depth tau, amu0 and amu the sun's and the viewer's |cosines| to
  // its normal, litFace when both are on one side. ×2: Lambert face-on.
  // tau = 0 (gaps, the strip's ends) returns first, as the mirror does: under
  // a mediump fallback a 1e-12 epsilon flushes to 0 and 0/0 would be a NaN in
  // the premultiplied pixel. 1e-4 is a mediump normal (2^-14 ~ 6.1e-5).
  float ringRadiance(float tau, float amu0, float amu, bool litFace) {
    if (tau <= 0.0) return 0.0;
    float x = tau / amu;
    float x0 = tau / amu0;
    if (litFace) return 2.0 * x / max(x + x0, 1e-4) * (1.0 - exp(-(x + x0)));
    float d = 0.5 * (x - x0);
    // (e^-x0 - e^-x)/(x - x0) = e^-(x+x0)/2 sinh(d)/d: the series near d = 0, where the difference cancels.
    if (abs(d) < 5e-3) return 2.0 * x * exp(-0.5 * (x + x0)) * (1.0 + d * d / 6.0);
    return 2.0 * x * (exp(-x0) - exp(-x)) / (x - x0);
  }
  #endif
  uniform float uIrradiance; // sunlight at the ring's orbit vs 1 AU (sunLight.ts irradianceVsAU)
  uniform vec3 uColor;
  uniform float uInner;
  uniform float uOuter;
  uniform float uOpacity;
  uniform float uLitExposure; // the exposure where no post pass applies it (sunLight.ts)
  varying float vR;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float bands(float t) {
    // Sum of ringlets at incommensurate frequencies, then a hashed fine grain.
    float b = 0.55 + 0.25 * sin(t * 61.0) + 0.15 * sin(t * 137.0 + 1.3) + 0.1 * sin(t * 290.0 + 2.1);
    float grain = hash(floor(t * 420.0));
    return clamp(b * (0.75 + 0.5 * grain), 0.0, 1.0);
  }
  ${LOG_DEPTH_FRAG_PARS}
  void main() {
    ${LOG_DEPTH_FRAG}
    float t = clamp((vR - uInner) / (uOuter - uInner), 0.0, 1.0);
    #ifdef RING_MAP
    vec4 strip = texture2D(uRingMap, vec2(t, 0.5));
    float tau = strip.a * uTauMax;
    vec3 n = normalize(vRingNormal);
    float mu = dot(n, normalize(cameraPosition - vWorld));
    float mu0 = dot(n, normalize(-vWorld)); // the sun is at the origin
    float amu = max(abs(mu), RING_MU_MIN);
    float amu0 = max(abs(mu0), RING_MU_MIN);
    float a = 1.0 - exp(-tau / amu); // ringOptics.ts ringViewOpacity
    // The layer's radiance itself, premultiplied: not divided by a.
    vec3 col = strip.rgb * uColor * RING_SUN_RADIANCE * ringRadiance(tau, amu0, amu, mu * mu0 >= 0.0);
    #else
    float edge = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.0, t));
    float dv = (t - 0.62) / 0.025;  // squared explicitly: pow(neg, 2.0) is undefined in GLSL
    float division = 1.0 - 0.85 * exp(-dv * dv);
    float a = uOpacity * bands(t) * edge * division;
    vec3 col = mix(uColor, vec3(0.92, 1.0, 0.95), 0.35 * bands(t + 0.3));
    #endif
    col *= uIrradiance;
    #ifdef SUN_SHADOW_RING
    // In the planet's shadow only what the planet's surface keeps from
    // ambient light is left (F4).
    col *= mix( uNightFloor, 1.0, sunShadowVisibility( vWorld, uOccluders[ uRingSlot ] ) );
    #endif
    // Lit matter, not an instrument: it follows exposure like its planet (F3),
    // in low-perf too, where only uLitExposure applies it.
    gl_FragColor = vec4(col * uLitExposure, a);
  }
`;

/**
 * How bright the ring stays in its planet's umbra, as a fraction of full sun:
 * what the planet's own surface keeps there (ambient and emissive light).
 * Measured, not picked, by reading the same pixels of Ruangrapi's surface with
 * its moon's umbra on and off (Apple M5, 2026-10-17): 0.087 in the PostFX
 * tier, whose buffer is linear, and 0.267 in the low-perf tier, which draws
 * tone-mapped sRGB straight to the screen. The ring's shader writes its colour
 * raw in both, so it needs the floor of the space it lands in;
 * SolarBodies switches it with the tier.
 */
export const RING_NIGHT_FLOOR = { linear: 0.09, display: 0.27 } as const;

export interface PlanetRingOptions {
  /** The radial strip (RGB colour, A = τ / RING_TAU_MAX); turns on RING_MAP. */
  ringMap?: THREE.Texture;
  /** Sunlight at the ring's orbit as a fraction of 1 AU's (irradianceVsAU). Default 1. */
  irradiance?: number;
}

/**
 * `shadowSlot`: the planet's eclipse occluder slot (sunShadow.ts). It is a
 * uniform, so every shadowed ring shares one program. A `ringMap` adds the
 * RING_MAP program; without one the ring keeps the procedural bands' program.
 */
export function makePlanetRingMaterial(
  color: THREE.ColorRepresentation, inner: number, outer: number, shadowSlot?: number,
  opts: PlanetRingOptions = {},
): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (shadowSlot !== undefined) defines.SUN_SHADOW_RING = "";
  if (opts.ringMap) defines.RING_MAP = "";
  return new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    // The ring map's colour is the layer's radiance, already weighted by its
    // opacity; the procedural bands keep straight alpha (and their program).
    premultipliedAlpha: !!opts.ringMap,
    defines,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uInner: { value: inner },
      uOuter: { value: outer },
      uOpacity: { value: 0.55 },
      // The shared objects, so SolarBodies' one write per frame reaches the ring.
      uOccluders: sunShadowUniforms.uOccluders,
      uOccluderCount: sunShadowUniforms.uOccluderCount,
      uNightFloor: { value: RING_NIGHT_FLOOR.linear },
      uRingSlot: { value: shadowSlot ?? -1 },
      uLitExposure: litExposure,
      uIrradiance: { value: opts.irradiance ?? 1 },
      uRingMap: { value: opts.ringMap ?? null },
      uTauMax: { value: RING_TAU_MAX },
    },
  });
}
