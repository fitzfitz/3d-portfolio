export interface Project {
  title: string; role: string; duration: string; short: string;
  description: string; tech: string[]; color: string;
}
export interface PlanetData {
  name: string; pos: [number, number, number]; color: string; size: number;
}

export const COSMIC_BOUNDS = 250;
export const PORTAL_POS: [number, number, number] = [0, 0.2, -160];

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

export const planets: PlanetData[] = [
  { name: "saas", pos: [-110, 0, 110] as [number, number, number], color: "#00ff87", size: 4.8 },
  { name: "video", pos: [130, 0, -80] as [number, number, number], color: "#00f0ff", size: 4.8 },
  { name: "agent", pos: [-120, 0, -130] as [number, number, number], color: "#bd00ff", size: 4.8 },
];
