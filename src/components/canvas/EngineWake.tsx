import { useEffect, useMemo, type RefObject } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LOG_DEPTH_VERT_PARS, LOG_DEPTH_VERT, LOG_DEPTH_FRAG_PARS, LOG_DEPTH_FRAG } from "./logDepth";
import { WakeGeometry } from "./wakeGeometry";

/**
 * A ribbon that trails an object: drei's <Trail> drawn the same way (its
 * meshline geometry and shader, ported), without the garbage. drei's
 * MeshLineGeometry.setPoints rebuilt every attribute as fresh JS arrays and
 * typed arrays each frame and re-uploaded all of them, index included: the
 * five cargo wakes made ~125 KB of garbage a frame, over half the scene's
 * (sampling heap profile, 2026-10-22). Here the attributes are allocated
 * once; a frame shifts the point history and rewrites position, previous
 * and next in place. Side, width, uv, counters and the index never change.
 */

/** drei's Trail: `length` × 10 points of history. */
const POINTS_PER_LENGTH = 10;

/** meshline's MeshLineMaterial shader with sizeAttenuation on and no map, dash or gradient: what <Trail> drew. */
const VERT = /* glsl */ `
  #include <common>
  ${LOG_DEPTH_VERT_PARS}
  attribute vec3 previous;
  attribute vec3 next;
  attribute float side;
  attribute float width;
  uniform vec2 resolution;
  uniform float lineWidth;
  vec2 fix(vec4 i, float aspect) {
    vec2 res = i.xy / i.w;
    res.x *= aspect;
    return res;
  }
  void main() {
    float aspect = resolution.x / resolution.y;
    mat4 m = projectionMatrix * modelViewMatrix;
    // meshline scales the whole clip position by the aspect; kept, so the ribbon's width is unchanged.
    vec4 finalPosition = m * vec4(position, 1.0) * aspect;
    vec2 currentP = fix(finalPosition, aspect);
    vec2 prevP = fix(m * vec4(previous, 1.0), aspect);
    vec2 nextP = fix(m * vec4(next, 1.0), aspect);
    vec2 dir;
    if (nextP == currentP) dir = normalize(currentP - prevP);
    else if (prevP == currentP) dir = normalize(nextP - currentP);
    else dir = normalize(normalize(currentP - prevP) + normalize(nextP - currentP));
    vec2 normal = vec2(-dir.y, dir.x) * 0.5 * lineWidth * width;
    finalPosition.xy += normal * side;
    gl_Position = finalPosition;
    ${LOG_DEPTH_VERT}
  }
`;
const FRAG = /* glsl */ `
  ${LOG_DEPTH_FRAG_PARS}
  uniform vec3 color;
  void main() {
    ${LOG_DEPTH_FRAG}
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface EngineWakeProps {
  target: RefObject<THREE.Object3D | null>;
  /** drei Trail's width: the line is 0.1 × width wide. */
  width: number;
  /** drei Trail's length: × 10 points of history. */
  length: number;
  color: THREE.ColorRepresentation;
  /** Width along the ribbon, 0 at its oldest point and 1 at the target. */
  attenuation: (t: number) => number;
}

export default function EngineWake({ target, width, length, color, attenuation }: EngineWakeProps) {
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  // The attenuation is read once, at build: the cargo wake's is a fixed curve.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => new WakeGeometry(Math.round(length * POINTS_PER_LENGTH), attenuation), [length]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    name: "EngineWake",
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      lineWidth: { value: 0.1 * width },
      color: { value: new THREE.Color(color) },
      resolution: { value: new THREE.Vector2(1, 1) },
    },
  }), [width, color]);
  useEffect(() => { material.uniforms.resolution.value.set(size.width, size.height); }, [material, size]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  const world = useMemo(() => new THREE.Vector3(), []);
  // A fresh history (new geometry) starts filled at the target, as drei's does.
  const state = useMemo(() => ({ started: false, geometry }), [geometry]);
  useFrame(() => {
    const t = target.current;
    if (!t) return;
    t.getWorldPosition(world);
    if (state.started) geometry.push(world);
    else { geometry.reset(world); state.started = true; }
  });

  return createPortal(<mesh geometry={geometry} material={material} />, scene);
}
