import { describe, it, expect } from "vitest";
import { preloadFiles, type ChunkLike } from "../src/utils/preloadChunks";

const chunks: ChunkLike[] = [
  { fileName: "assets/index.js", facadeModuleId: "/r/src/main.tsx", imports: [] },
  { fileName: "assets/App.js", facadeModuleId: "/r/src/App.tsx", imports: ["assets/index.js", "assets/three.js", "assets/ui.js"] },
  { fileName: "assets/three.js", facadeModuleId: null, imports: ["assets/index.js"] },
  { fileName: "assets/ui.js", facadeModuleId: null, imports: ["assets/three.js"] },
  // Only reached through a dynamic import (the lazy canvas): not in `imports`.
  { fileName: "assets/GlobalCanvas.js", facadeModuleId: "/r/src/components/canvas/GlobalCanvas.tsx", imports: ["assets/three.js"] },
];

describe("preloadFiles (vite.config.ts preloadApp)", () => {
  it("is App's chunk and its static imports, transitively, once each, minus what the page already loads", () => {
    expect(preloadFiles(chunks, "/src/App.tsx", new Set(["assets/index.js"]))).toEqual(["assets/App.js", "assets/three.js", "assets/ui.js"]);
  });
  it("leaves dynamic imports out", () => {
    expect(preloadFiles(chunks, "/src/App.tsx", new Set())).not.toContain("assets/GlobalCanvas.js");
  });
  it("is empty when no chunk is App's", () => {
    expect(preloadFiles(chunks, "/src/Nope.tsx", new Set())).toEqual([]);
  });
});
