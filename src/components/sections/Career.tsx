import CareerList from "./CareerList";

/** Classic-résumé work history: a vertical timeline, newest first. */
export default function Career() {
  return (
    <section id="career" className="py-24 relative w-full">
      <div className="max-w-4xl mx-auto px-6 w-full">
        <div className="mb-14 text-center md:text-left">
          <p className="font-mono text-xs text-primary tracking-widest uppercase mb-2">
            // WORK_HISTORY
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl lg:text-5xl">Career</h2>
        </div>

        <CareerList />
      </div>
    </section>
  );
}
