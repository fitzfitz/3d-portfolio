import { X, ExternalLink, Calendar, Briefcase } from "lucide-react";
import type { Project } from "../../constants";
import { identity } from "../../data/identity";
import { dossierCopy, type DossierVia } from "./dossierCopy";

/**
 * A project's dossier popup, opened by grabbing its probe with the tractor
 * beam (or from the logbook). Plain markup: App wraps it in the motion
 * element, so the entry/exit animation and its key live there. Esc is handled
 * by App; focus lands on the close button via autoFocus.
 */
export default function ProjectDossier({ project, via, onClose }: {
  project: Project;
  via: DossierVia;
  onClose: () => void;
}) {
  const copy = dossierCopy(via);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dossier-title"
      className="w-full glass-card rounded-3xl p-8 relative border max-h-[85vh] overflow-y-auto pr-4 select-none bg-black/90"
      style={{ borderColor: `${project.color}33`, boxShadow: `0 0 40px ${project.color}11` }}
    >
      <button
        autoFocus
        onClick={onClose}
        aria-label="Close dossier (Esc)"
        className="absolute top-6 right-6 p-2 rounded-lg border border-white/5 bg-white/2 hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
        title="Close dossier (Esc)"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="flex flex-wrap items-center gap-6 mb-6">
        <span className="flex items-center gap-2 font-mono text-xs text-muted">
          <Briefcase className="w-4.5 h-4.5 text-white/40" />
          {project.role}
        </span>
        <span className="flex items-center gap-2 font-mono text-xs text-muted">
          <Calendar className="w-4.5 h-4.5 text-white/40" />
          {project.duration}
        </span>
        <span
          className="px-2 py-0.5 rounded font-mono text-[9px] uppercase border"
          style={{ color: project.color, borderColor: `${project.color}55` }}
        >
          {copy.badge}
        </span>
      </div>

      <h3 id="dossier-title" className="font-display font-black text-3xl sm:text-4xl mb-4 text-white">
        {project.title}
      </h3>

      <p className="font-mono text-sm mb-6" style={{ color: project.color }}>
        &gt; {project.short}
      </p>

      <p className="text-muted text-sm sm:text-base font-light leading-relaxed mb-8">
        {project.description}
      </p>

      <div className="flex flex-wrap gap-2.5 mb-8">
        {project.tech.map((tech) => (
          <span
            key={tech}
            className="px-3 py-1.5 rounded-lg text-xs font-mono bg-white/5 border border-white/5 text-white/80"
          >
            {tech}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-white/5 pt-6">
        <button
          onClick={onClose}
          className="px-5 py-3 rounded-xl font-mono text-xs font-bold text-black cursor-pointer hover:shadow-lg transition-all"
          style={{ backgroundColor: project.color }}
        >
          {copy.button}
        </button>

        <a
          href={project.repo ?? identity.github}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs font-mono text-muted hover:text-white transition-colors"
        >
          {project.repo ? "VIEW_SOURCE" : "GITHUB_PROFILE"}
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
