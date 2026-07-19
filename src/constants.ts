import type { OrbitalElements } from "./utils/orbits";

export interface Project {
  title: string; role: string; duration: string; short: string;
  description: string; tech: string[]; color: string;
}
export interface PlanetData {
  name: string; orbit: OrbitalElements; color: string; size: number;
}

export const COSMIC_BOUNDS = 250;
// Off-plane destination: pilots must climb to reach the contact portal (spec §3).
export const PORTAL_POS: [number, number, number] = [0, 95, -150];
export const SHIP_MAX_SPEED = 10.8;

// Orbit-lock geometry: ORBIT must stay well inside RETAIN or the lock
// self-destructs one frame after engaging (see tests/orbitInvariant.test.ts).
export const ZONE_FACTOR = 1.8;        // gravity-tip radius = size * this
export const LOCK_ENGAGE_FACTOR = 1.3; // lock engages inside size * this
export const LOCK_RETAIN_FACTOR = 1.9; // once locked, retained until size * this
export const ORBIT_RADIUS_FACTOR = 1.5; // orbit-entry ring = size * this
export const PORTAL_ZONE_R = 2.2;
export const PORTAL_LOCK_R = 1.5;
export const PORTAL_RETAIN_R = 3.4;
export const PORTAL_ORBIT_R = 2.6;

export const projects: Project[] = [
  {
    title: "Multi-Tenant SaaS Platform",
    role: "Lead Architect",
    duration: "2024 - Present",
    short: "Subdomain multitenancy with automated Stripe fee splits.",
    description:
      "Architected a scalable, secure subscription platform handling schema-isolated client tenants, dynamic subdomain resolution, and custom platform fee distribution using Stripe Connect. The platform currently orchestrates billing flows for 15,000+ active subscriptions with sub-millisecond route resolution.",
    tech: ["React", "TypeScript", "Hono", "PostgreSQL", "Stripe", "Docker"],
    color: "#00ff87", // Neon Green
  },
  {
    title: "Viral Video Generator",
    role: "Core ML Engineer",
    duration: "2023 - 2024",
    short: "AI semantic scene parser and dynamic video clipper.",
    description:
      "Designed a Python-based processing pipeline parsing lengthy podcasts and webinars. Utilized OpenAI Whisper transcription matched with semantic scene analysis, facial framing detectors, and NLP emotion classifiers to clip high-retention vertical videos, exporting directly to social platform queues.",
    tech: ["Python", "PyTorch", "Whisper API", "OpenCV", "FFmpeg", "Vite"],
    color: "#00f0ff", // Neon Cyan
  },
  {
    title: "Custom Multi-Agent Architecture",
    role: "R&D AI Engineer",
    duration: "2024",
    short: "Closed-loop AI agent workflow automating local engineering.",
    description:
      "Built a custom multi-agent framework mapping hierarchy managers to coder and review agents. Operating within containerized workspaces, the system reads OpenSpec documents, plans feature files, runs local TDD cycles, and standardizes PR validation checks to optimize frontend engineering speeds.",
    tech: ["TypeScript", "Python", "LangChain", "OpenSpec", "Docker", "Portainer"],
    color: "#bd00ff", // Neon Purple
  },
];

// Inclined living orbits around the sun at origin (spec §3). Periods are
// minutes-slow: orbital speed stays ≪ ship speed so orbit-lock tracking is
// trivial (tests/orbitInvariant.test.ts).
export const planets: PlanetData[] = [
  {
    name: "saas", color: "#00ff87", size: 4.8,
    orbit: { radius: 115, angularSpeed: (Math.PI * 2) / 420, inclination: 0.3491, node: 0, phase: 0 },
  },
  {
    name: "video", color: "#00f0ff", size: 4.8,
    orbit: { radius: 150, angularSpeed: (Math.PI * 2) / 510, inclination: -0.6981, node: 2.0944, phase: 2.1 },
  },
  {
    name: "agent", color: "#bd00ff", size: 4.8,
    orbit: { radius: 185, angularSpeed: (Math.PI * 2) / 600, inclination: 1.0472, node: 4.1888, phase: 4.2 },
  },
];
