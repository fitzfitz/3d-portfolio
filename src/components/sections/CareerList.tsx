import { motion } from "framer-motion";
import { Briefcase, MapPin } from "lucide-react";
import { activeContent } from "../../data/content";

/**
 * The work-history timeline, newest first. Rendered by the résumé's Career
 * section and by the career station's dossier, so the two can never drift.
 * The list is the settled content's (src/data/content.ts), in its own order.
 */
export default function CareerList() {
  const career = activeContent().career;
  return (
    <ol className="relative border-l border-white/10 ml-2">
      {career.map((c, i) => (
        <motion.li
          key={`${i}-${c.company}-${c.start}`}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.4, delay: i * 0.05 }}
          className="mb-10 ml-6 last:mb-0"
        >
          <span
            className={`absolute -left-[7px] mt-1.5 w-3.5 h-3.5 rounded-full border-2 ${
              c.end ? "border-white/30 bg-[#020108]" : "border-primary bg-primary shadow-neonGreen"
            }`}
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
            <h3 className="font-display font-bold text-lg text-white">{c.role}</h3>
            <span className="font-mono text-xs text-muted">
              {c.start} – {c.end ?? "Present"}
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-white/70 mb-2">
            <span className="flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-white/40" />
              {c.company}
              {c.note && <span className="text-white/40">({c.note})</span>}
            </span>
            <span className="text-white/40">{c.employment}</span>
            <span className="flex items-center gap-1.5 text-white/40">
              <MapPin className="w-3.5 h-3.5" />
              {c.location}
            </span>
          </p>
          <p className="text-muted text-sm font-light leading-relaxed max-w-2xl">{c.summary}</p>
        </motion.li>
      ))}
    </ol>
  );
}
