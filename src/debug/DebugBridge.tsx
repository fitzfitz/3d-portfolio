import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { fitzDebug } from "./bridge";

/** Publishes the R3F scene/renderer into the debug bridge. Renders nothing. */
export default function DebugBridge() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    fitzDebug.scene = scene;
    fitzDebug.gl = gl;
    fitzDebug.camera = camera;
  }, [scene, gl, camera]);
  return null;
}
