import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { ReactNode } from "react";
import { cn } from "./utils";

export type AssemblyViewerProps = {
  children?: ReactNode;
  mode?: "dark" | "light";
  className?: string;
};

/**
 * Canvas wrapper for assembly playback: neutral studio lighting, orbit
 * controls, and a transparent, resize-safe canvas. Colors follow the same
 * dark/light convention as ModelViewer in @carbon/react.
 */
export function AssemblyViewer({
  children,
  mode = "dark",
  className
}: AssemblyViewerProps) {
  const isDarkMode = mode === "dark";

  return (
    <div
      className={cn(
        "relative h-full w-full",
        isDarkMode ? "bg-[#141619]" : "bg-white",
        className
      )}
    >
      <Canvas
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [100, 100, 100], fov: 45, near: 0.1, far: 100000 }}
        resize={{ debounce: 0 }}
        style={{ position: "absolute", inset: 0 }}
      >
        <ambientLight intensity={isDarkMode ? 0.6 : 0.8} />
        <hemisphereLight
          color={0xffffff}
          groundColor={isDarkMode ? 0x202329 : 0xd4d4d8}
          intensity={0.5}
        />
        <directionalLight position={[1, 1, 1]} intensity={1.6} />
        <directionalLight position={[-1, 0.5, -1]} intensity={0.8} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
        {children}
      </Canvas>
    </div>
  );
}
