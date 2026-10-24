// The monster lab's entry (dev only: monster-lab.html at the repo root, which
// Vite serves in dev; the build's only input is index.html, and nothing the
// game imports reaches src/lab/).
import { createRoot } from "react-dom/client";
import "@fontsource/orbitron/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/outfit/latin-400.css";
import "../index.css";
import MonsterLab from "./MonsterLab";

createRoot(document.getElementById("root")!).render(<MonsterLab />);
