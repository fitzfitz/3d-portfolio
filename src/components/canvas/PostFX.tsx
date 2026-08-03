import { EffectComposer, Bloom, Vignette, ChromaticAberration, GodRays } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSpaceStore } from "../../store/spaceStore";

/**
 * Stable offset instance, mutated in place rather than replaced. Passing a
 * fresh array literal per render (as GlobalCanvas used to) changed the prop
 * identity every time anything re-rendered, and rebuilding the composer's
 * children means recompiling every pass -- a hitch mid-flight.
 */
const CA_OFFSET = new THREE.Vector2(0, 0);
const WARP_X = 0.0022;
const WARP_Y = 0.0014;

/**
 * Drives chromatic aberration from the store imperatively. This exists so
 * PostFX never has to subscribe to `isWarping`: a subscription there would
 * re-render the composer on every boost, which is precisely the hitch this
 * refactor removes.
 */
function WarpAberration() {
  useFrame(() => {
    const s = useSpaceStore.getState();
    const on = s.isWarping && !s.reducedMotion;
    CA_OFFSET.set(on ? WARP_X : 0, on ? WARP_Y : 0);
  });
  return null;
}

interface PostFXProps {
  sunMesh: THREE.Mesh | null;
}

/**
 * multisampling=0: the GodRays depth passes' buffer formats are incompatible
 * with the MSAA resolve blit (GL_INVALID_OPERATION every frame -> white
 * canvas). Bloom smooths edges anyway, so MSAA here bought nothing.
 */
export default function PostFX({ sunMesh }: PostFXProps) {
  return (
    <>
      <WarpAberration />
      <EffectComposer multisampling={0}>
        <Bloom intensity={1.2} luminanceThreshold={0.2} luminanceSmoothing={0.9} mipmapBlur={true} />
        <Vignette eskil={false} offset={0.28} darkness={0.72} />
        <ChromaticAberration offset={CA_OFFSET} />
        {/* Accumulator budget: HDR sun (emissive 3.2) x weight x decay-series(~10)
            x exposure must stay well under 1.0 or the clamp saturates to a white
            wash. 3.2 x 0.08 x 10 x 0.18 = 0.46 peak. */}
        {sunMesh ? (
          <GodRays sun={sunMesh} samples={60} density={0.8} decay={0.9}
            weight={0.08} exposure={0.18} clampMax={0.8} blur={true} />
        ) : <></>}
      </EffectComposer>
    </>
  );
}
