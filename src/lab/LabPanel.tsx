import { useState, type ReactNode } from "react";
import { LAB_LAYOUTS, LAB_LODS, LAB_PRESETS, type LabSettings, type LabState } from "./labScene";
import type { LabReadings } from "./MonsterLab";

/**
 * The monster lab's control panel: preset, layout, state, LOD, seed, reduced
 * motion and auto-cycle, each also settable through the URL query. Styled as
 * the game's HUD (glass panel, Orbitron, JetBrains Mono, the neon green).
 */

const STATE_GROUPS: { label: string; states: LabState[] }[] = [
  { label: "Both", states: ["idle", "hit"] },
  { label: "Saucer", states: ["look", "fire", "chase", "defeat"] },
  { label: "Tardigrade", states: ["swim", "charge", "recoil", "curl"] },
];

const PRESET_NOTE: Record<LabSettings["preset"], string> = { near: "1 AU · Earth", far: "30 AU · Neptune" };
const LOD_NOTE: Record<LabSettings["lod"], string> = { "0": "LOD0", "1": "LOD1", auto: "auto" };

function Label({ children }: { children: ReactNode }) {
  return <div className="text-[10px] tracking-[0.22em] uppercase text-white/40 mb-1.5">{children}</div>;
}

function Chip({ active, onClick, children, title, testId }: {
  active: boolean; onClick: () => void; children: ReactNode; title?: string; testId?: string;
}) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={active} data-testid={testId}
      className={`px-2.5 py-1 rounded-md border text-xs font-mono transition-colors outline-none focus-visible:ring-1 focus-visible:ring-primary ${
        active ? "border-primary/70 bg-primary/10 text-primary" : "border-white/10 text-white/70 hover:border-white/30 hover:text-white"}`}>
      {children}
    </button>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick}
      className="flex items-center gap-2 text-xs text-white/75 hover:text-white outline-none focus-visible:ring-1 focus-visible:ring-primary rounded">
      <span className={`relative inline-block w-7 h-4 rounded-full border transition-colors ${on ? "border-primary/70 bg-primary/25" : "border-white/20 bg-white/5"}`}>
        <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full transition-all ${on ? "left-3.5 bg-primary" : "left-0.5 bg-white/50"}`} />
      </span>
      {children}
    </button>
  );
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

export default function LabPanel({ settings, readings, onChange }: {
  settings: LabSettings; readings: LabReadings; onChange: (patch: Partial<LabSettings>) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} aria-label="Show the lab's controls"
        className="glass-panel absolute top-4 left-4 rounded-xl px-3.5 py-2 text-white shadow-glass font-display font-bold text-[11px] tracking-[0.28em] hover:border-primary/40 outline-none focus-visible:ring-1 focus-visible:ring-primary">
        MONSTER LAB <span className="font-mono text-primary ml-1">+</span>
      </button>
    );
  }
  return (
    <aside className="glass-panel absolute top-4 left-4 w-[272px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl px-4 py-3.5 text-white shadow-glass select-none">
      <header className="flex items-baseline justify-between mb-3">
        <h1 className="font-display font-bold text-[13px] tracking-[0.28em] text-white">MONSTER LAB</h1>
        <span className="flex items-baseline gap-2">
          <span className="text-[10px] font-mono text-white/35">dev only</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Hide the lab's controls" title="Hide"
            className="font-mono text-xs text-white/50 hover:text-primary px-1 rounded outline-none focus-visible:ring-1 focus-visible:ring-primary">−</button>
        </span>
      </header>

      <section className="mb-3">
        <Label>Sunlight</Label>
        <div className="flex gap-1.5">
          {LAB_PRESETS.map((p) => (
            <Chip key={p} active={settings.preset === p} onClick={() => onChange({ preset: p })} title={PRESET_NOTE[p]} testId={`lab-preset-${p}`}>
              {p} <span className="text-white/35">{PRESET_NOTE[p].split(" · ")[0]}</span>
            </Chip>
          ))}
        </div>
      </section>

      <section className="mb-3">
        <Label>Layout</Label>
        <div className="flex gap-1.5">
          {LAB_LAYOUTS.map((l) => (
            <Chip key={l} active={settings.layout === l} onClick={() => onChange({ layout: l })} testId={`lab-layout-${l}`}>{l}</Chip>
          ))}
        </div>
      </section>

      <section className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] tracking-[0.22em] uppercase text-white/40">State</div>
          <Toggle on={settings.cycle} onClick={() => onChange({ cycle: !settings.cycle })}>auto-cycle</Toggle>
        </div>
        <div className="space-y-1.5">
          {STATE_GROUPS.map((g) => (
            <div key={g.label} className="flex items-center gap-1.5">
              <span className="w-[54px] shrink-0 text-[10px] text-white/30">{g.label}</span>
              <div className="flex flex-wrap gap-1">
                {g.states.map((s) => (
                  <Chip key={s} active={readings.state === s} onClick={() => onChange({ state: s, cycle: false })} testId={`lab-state-${s}`}>{s}</Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-3 flex gap-5">
        <div>
          <Label>LOD</Label>
          <div className="flex gap-1">
            {LAB_LODS.map((l) => (
              <Chip key={l} active={settings.lod === l} onClick={() => onChange({ lod: l })} title={LOD_NOTE[l]} testId={`lab-lod-${l}`}>{l}</Chip>
            ))}
          </div>
        </div>
        <div>
          <Label>Seed</Label>
          <div className="flex items-center gap-1">
            <Chip active={false} onClick={() => onChange({ seed: settings.seed - 1 })} title="Previous seed">−</Chip>
            <span className="w-8 text-center font-mono text-xs text-secondary" data-testid="lab-seed">{settings.seed}</span>
            <Chip active={false} onClick={() => onChange({ seed: settings.seed + 1 })} title="Next seed">+</Chip>
          </div>
        </div>
      </section>

      <section className="mb-3">
        <Toggle on={settings.reducedMotion} onClick={() => onChange({ reducedMotion: !settings.reducedMotion })}>
          reduced motion
        </Toggle>
        <div className="text-[10px] text-white/30 mt-1 pl-9">poses held still, idle motion off</div>
      </section>

      <footer className="border-t border-white/10 pt-2.5 font-mono text-[11px] text-white/55 leading-relaxed">
        <div className="flex justify-between">
          <span><span className="text-white/90">{readings.calls}</span> calls</span>
          <span><span className="text-white/90">{fmt(readings.triangles)}</span> tris</span>
          <span><span className="text-white/90">{readings.programs}</span> programs</span>
          <span><span className="text-white/90">{Math.round(readings.fps)}</span> fps</span>
        </div>
        <div className="text-[10px] text-white/30 mt-1">drag orbit · wheel zoom · right-drag pan</div>
      </footer>
    </aside>
  );
}
