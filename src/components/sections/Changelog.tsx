import { motion } from "framer-motion";
import { CHANGELOG, PR_URL } from "../../data/changelog";

/** Classic-résumé patch notes (spec §8.4): the same entries as the in-game panel, newest first. */
export default function Changelog() {
  return (
    <section id="changelog" className="py-24 relative w-full">
      <div className="max-w-4xl mx-auto px-6 w-full">
        <div className="mb-14 text-center md:text-left">
          <p className="font-mono text-xs text-primary tracking-widest uppercase mb-2">// PATCH_NOTES</p>
          <h2 className="font-display font-black text-3xl sm:text-4xl lg:text-5xl">Changelog</h2>
          <p className="text-muted text-sm font-light mt-3 max-w-2xl">
            What shipped on this flight-sim portfolio, and why. Newest first.
          </p>
        </div>
        <ol className="relative border-l border-white/10 ml-2">
          {CHANGELOG.map((e, i) => (
            <motion.li key={e.id} data-testid="resume-changelog-entry"
              initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.4, delay: Math.min(i, 6) * 0.04 }}
              className="mb-10 ml-6 last:mb-0">
              <span className="absolute -left-[7px] mt-1.5 w-3.5 h-3.5 rounded-full border-2 border-white/30 bg-[#020108]" aria-hidden="true" />
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
                <h3 className="font-display font-bold text-lg text-white">{e.title}</h3>
                <span className="font-mono text-xs text-muted">
                  {e.date} · <a href={`${PR_URL}${e.pr}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">PR #{e.pr}</a>
                </span>
              </div>
              <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1.5 text-sm font-light leading-relaxed max-w-2xl">
                <dt className="font-mono text-xs text-white/40 pt-0.5">WHAT</dt><dd className="text-white/80">{e.what}</dd>
                <dt className="font-mono text-xs text-white/40 pt-0.5">WHY</dt><dd className="text-muted">{e.why}</dd>
                <dt className="font-mono text-xs text-white/40 pt-0.5">HOW</dt><dd className="text-muted">{e.how}</dd>
              </dl>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
