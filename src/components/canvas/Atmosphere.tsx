import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ATMOSPHERE_VERT, makeAtmosphereMaterial } from "./atmosphereMaterial";
import { makeSphereLOD, shellCullDistance } from "../../utils/sphereLod";
import { irradianceVsAU } from "../../utils/sunLight";

interface AtmosphereProps {
  radius: number;
  color: string;
  /**
   * Planet's world position — the sun sits at the origin. The planet orbits,
   * so this is the same mutable `bodies[id]` object SolarBodies writes
   * every frame (not a fresh array), read here each frame so the Rayleigh
   * gradient keeps pointing at the origin as the planet moves.
   */
  planetPos?: { x: number; y: number; z: number };
  /** overall strength at 1 AU; earth-like ~1, thin mars haze ~0.4 */
  intensity?: number;
  /**
   * A fixed distance from the sun for the rim's sunlight. The rim is
   * scattered sunlight (L27), so it is scaled by the sunlight there,
   * (AU / r)² (L19). Omit for 1 AU, or set `liveSunlight`.
   */
  orbitRadius?: number;
  /**
   * Scale the rim by the sunlight at `planetPos`'s live distance each frame
   * instead (real-solar-system spec §4.8: orbits are ellipses, so Mercury's
   * sunlight varies 2.3× around its orbit). Needs `planetPos`.
   */
  liveSunlight?: boolean;
  /** shell thickness multiplier (1.12 = earth-like, 1.05 = thin haze) */
  thickness?: number;
  /** The terminator band's tint; omit for the sunset orange (atmosphereMaterial.ts). */
  dusk?: THREE.ColorRepresentation;
  /** Explicit draw order among a body's transparent shells (SolarBodies' BODY_RENDER_ORDER). */
  renderOrder?: number;
}

/** Sun-aware fresnel scattering shell. Place inside a planet group. */
export default function Atmosphere({ radius, color, planetPos, intensity = 1.15, thickness = 1.12, orbitRadius, liveSunlight = false, dusk, renderOrder = 0 }: AtmosphereProps) {
  const material = useMemo(
    () => makeAtmosphereMaterial({ color, planetPos, intensity, thickness, orbitRadius, dusk }),
    // planetPos is a stable mutated-in-place object; only its identity (not
    // its contents) should retrigger material creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [color, intensity, thickness, orbitRadius, dusk],
  );

  // Planet moves every frame (SolarBodies writes into the same object) — the
  // sun-facing gradient must track it live rather than freeze at mount time.
  useFrame(() => {
    if (!planetPos) return;
    (material.uniforms.uSunDir.value as THREE.Vector3)
      .set(-planetPos.x, -planetPos.y, -planetPos.z)
      .normalize();
    if (liveSunlight) {
      material.uniforms.uIntensity.value = intensity * irradianceVsAU(Math.hypot(planetPos.x, planetPos.y, planetPos.z));
    }
  });

  // Detail by distance with its planet (sphereLod.ts). Drawn from its back
  // faces behind the planet's depth, the shell shows only the band beyond the
  // limb, (thickness − 1) × radius wide: culled once that is under a pixel.
  const lod = useMemo(() => makeSphereLOD(material, radius, {
    radius: radius * thickness, renderOrder, cullBeyond: shellCullDistance((thickness - 1) * radius),
  }), [material, radius, thickness, renderOrder]);

  return <primitive object={lod} dispose={null} />;
}

const limbFragment = /* glsl */ `
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vWorldNormal;
  void main() {
    float rim = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0), 1.6);
    gl_FragColor = vec4(0.0, 0.0, 0.0, rim * uStrength);
  }
`;

/** The limb-darkening shell's radius, in planet radii: just over the surface. */
const LIMB_SHELL = 1.005;

/** Gas-giant limb darkening: the disk dims toward the edge (deeper atmosphere
 * path = more absorption) — the visual signature that separates a gas giant
 * from a rocky body. Normal-blended dark fresnel overlay. */
export function LimbDarkening({ radius, strength = 0.75, renderOrder = 0 }: { radius: number; strength?: number; renderOrder?: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uStrength: { value: strength } },
        vertexShader: ATMOSPHERE_VERT,
        fragmentShader: limbFragment,
        transparent: true,
        side: THREE.FrontSide,
        depthWrite: false,
      }),
    [strength]
  );
  // Detail by distance with its planet (sphereLod.ts); it covers the whole
  // disc, so it is culled only once the disc itself is under a pixel.
  const lod = useMemo(() => makeSphereLOD(material, radius, {
    radius: radius * LIMB_SHELL, renderOrder, cullBeyond: shellCullDistance(radius * LIMB_SHELL),
  }), [material, radius, renderOrder]);
  return <primitive object={lod} dispose={null} />;
}
