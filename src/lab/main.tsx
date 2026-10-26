// The monster lab's entry (dev only: monster-lab.html at the repo root, which
// Vite serves in dev; the build's only input is index.html, and nothing the
// game imports reaches src/lab/).
import { createRoot } from "react-dom/client";
import "@fontsource/orbitron/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/outfit/latin-400.css";
import "../index.css";
import { BUNDLED_CONTENT, settleContent } from "../data/content";

/**
 * The game's content is settled before any module that reads it loads
 * (main.tsx, spec 2026-10-23-dynamic-content). The lab borrows game modules
 * (SkyBackdrop, PostFX, sunLight, ...), so it settles the same way, first,
 * with the bundled snapshot: the lab needs no network. MonsterLab and
 * everything it imports load only after that (tests/labBoot.test.ts).
 */
async function boot() {
  settleContent(BUNDLED_CONTENT, "bundled");
  const { default: MonsterLab } = await import("./MonsterLab");
  createRoot(document.getElementById("root")!).render(<MonsterLab />);
}

void boot();
