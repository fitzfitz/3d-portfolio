import { motion } from "framer-motion";
import { Monitor, Server, Cloud, Cpu, ArrowUpRight } from "lucide-react";

const skillCategories = [
  {
    title: "Frontend Core",
    icon: Monitor,
    description: "Creating highly interactive, fluid, responsive and accessible user interfaces.",
    skills: ["React", "Vite", "TypeScript", "Astro", "Tailwind CSS", "HTML5/CSS3"],
    color: "#00ff87", // Green
    bgGlow: "rgba(0, 255, 135, 0.05)",
  },
  {
    title: "Backend & DB",
    icon: Server,
    description: "Designing low-latency, scalable microservices, routing layers and transactional schemas.",
    skills: ["Hono", "Node.js", "PostgreSQL", "Redis", "REST/GraphQL", "Prisma ORM"],
    color: "#00f0ff", // Cyan
    bgGlow: "rgba(0, 240, 255, 0.05)",
  },
  {
    title: "DevOps & Cloud",
    icon: Cloud,
    description: "Managing server nodes, isolated runtimes, reverse proxies and deploy scripts.",
    skills: ["VPS Management", "Docker", "Portainer", "Nginx", "GitHub Actions", "Linux (Ubuntu)"],
    color: "#bd00ff", // Purple
    bgGlow: "rgba(189, 0, 255, 0.05)",
  },
  {
    title: "AI Workflows",
    icon: Cpu,
    description: "Leveraging closed-loop agent structures, TDD loops, and specification-driven automation.",
    skills: ["LangChain", "OpenSpec", "TDD Workflows", "AI Agents Orchestration", "Prompt Ops", "Auto-testing"],
    color: "#ec4899", // Pink
    bgGlow: "rgba(236, 72, 153, 0.05)",
  },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 25 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 100, damping: 15 },
  },
};

interface SkillsProps {
  isSidebar?: boolean;
}

export default function Skills({ isSidebar = false }: SkillsProps) {
  const content = (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-100px" }}
      className={isSidebar ? "space-y-4 max-h-[75vh] overflow-y-auto no-scrollbar pr-1" : "grid grid-cols-1 md:grid-cols-2 gap-8"}
    >
          {skillCategories.map((category, index) => {
            const IconComponent = category.icon;

            return (
              <motion.div
                key={index}
                variants={cardVariants}
                className="glass-card rounded-2xl p-6 sm:p-8 relative overflow-hidden group flex flex-col justify-between"
                style={{
                  boxShadow: `inset 0 0 20px ${category.bgGlow}`,
                }}
              >
                {/* Neon Top-right Corner Accent */}
                <div
                  className="absolute top-0 right-0 w-24 h-24 rounded-bl-full opacity-10 blur-xl transition-opacity group-hover:opacity-35"
                  style={{ backgroundColor: category.color }}
                />

                <div>
                  {/* Category Header */}
                  <div className="flex items-center gap-4 mb-6">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-300"
                      style={{
                        borderColor: `${category.color}33`,
                        backgroundColor: `${category.color}0d`,
                        boxShadow: `0 0 10px ${category.color}1a`,
                      }}
                    >
                      <IconComponent
                        className="w-6 h-6 transition-transform group-hover:rotate-6 duration-300"
                        style={{ color: category.color }}
                      />
                    </div>
                    <h3 className="font-display font-bold text-xl text-white">
                      {category.title}
                    </h3>
                  </div>

                  {/* Description */}
                  <p className="text-muted text-sm font-light leading-relaxed mb-6">
                    {category.description}
                  </p>

                  {/* Skills Tag Cloud */}
                  <div className="flex flex-wrap gap-2.5">
                    {category.skills.map((skill) => (
                      <span
                        key={skill}
                        className="px-3 py-1.5 rounded-lg text-xs font-mono bg-white/5 border border-white/5 text-white/90 hover:border-white/20 hover:bg-white/10 transition-all duration-200"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Bottom line spacer decoration */}
                <div className="mt-8 flex items-center justify-between text-[10px] font-mono text-white/20 border-t border-white/5 pt-4">
                  <span>// STATUS: MASTERED</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-white/10 group-hover:text-white/40 transition-colors" />
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )

      if (isSidebar) {
        return (
          <div className="glass-card rounded-2xl p-6 relative w-full border border-primary/20 bg-black/85 max-h-[85vh] overflow-hidden pointer-events-auto">
            <h3 className="font-display font-extrabold text-xl mb-4 text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Skills & Arsenal
            </h3>
            {content}
          </div>
        );
      }

      return (
        <section id="skills" className="py-24 relative w-full overflow-hidden">
          {/* Background neon glows */}
          <div className="absolute top-[20%] left-[-15%] w-[450px] h-[450px] rounded-full bg-accent/5 blur-[130px] pointer-events-none" />
          <div className="absolute bottom-[10%] right-[-10%] w-[350px] h-[350px] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />

          <div className="max-w-7xl mx-auto px-6">
            {/* Section Header */}
            <div className="mb-16 text-center">
              <p className="font-mono text-xs text-secondary tracking-widest uppercase mb-2">
                // MY_STACK_AND_ABILITIES
              </p>
              <h2 className="font-display font-black text-3xl sm:text-4xl lg:text-5xl">
                Skills & Arsenal
              </h2>
            </div>
            {content}
          </div>
        </section>
      );
    }
