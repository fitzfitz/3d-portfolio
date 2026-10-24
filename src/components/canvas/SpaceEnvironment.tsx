import { Environment, Lightformer } from "@react-three/drei";

/**
 * The scene's static generated IBL: a cool spacelight and a warm sun echo,
 * rendered once (frames={1}). For the ship and the props: the bodies opt out
 * (noIbl.ts, L29). Its intensity falls off like the sunlight past 1 AU
 * (sunLight.ts applyFill sets scene.environmentIntensity). Shared by
 * GlobalCanvas and the dev-only monster lab, so both light alike.
 */
export default function SpaceEnvironment() {
  return (
    <Environment resolution={64} frames={1}>
      <color attach="background" args={["#050310"]} />
      <Lightformer form="rect" intensity={1.1} color="#3a4a8f" position={[0, 8, -10]} scale={[14, 7, 1]} />
      <Lightformer form="rect" intensity={0.7} color="#ff5500" position={[9, -3, 4]} scale={[8, 4, 1]} />
      <Lightformer form="rect" intensity={0.6} color="#00f0ff" position={[-9, 2, 5]} scale={[6, 6, 1]} />
    </Environment>
  );
}
