import { Canvas } from "@react-three/fiber";
import { Preload } from "@react-three/drei";
import { Suspense } from "react";
import type { ReactNode } from "react";

interface SceneProps {
  children: ReactNode;
  className?: string;
}

export default function Scene({ children, className = "" }: SceneProps) {
  return (
    <div className={`w-full h-full ${className}`}>
      <Suspense fallback={
        <div className="absolute inset-0 flex items-center justify-center text-primary font-mono text-sm tracking-widest uppercase animate-pulse">
          Initializing 3D Canvas...
        </div>
      }>
        <Canvas
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
            preserveDrawingBuffer: true,
          }}
          camera={{ position: [0, 0, 5], fov: 60 }}
          eventSource={document.getElementById("root") || undefined}
          eventPrefix="client"
        >
          {children}
          <Preload all />
        </Canvas>
      </Suspense>
    </div>
  );
}
