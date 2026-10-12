import { useEffect } from "react";
import { useSpaceStore } from "../../store/spaceStore";
import { BEACON_PHRASES } from "../../data/beaconPhrases";
import { dropBeacon } from "../../utils/beaconActions";

/**
 * Phrase picker for dropping a beacon. A fixed list, by design — see
 * src/data/beaconPhrases.ts. Number keys pick directly; Esc cancels. While it
 * is open the keyboard flies nothing (useKeyboardInput) and the number keys do
 * not jump (App.tsx).
 */
export default function BeaconPicker() {
  const open = useSpaceStore((s) => s.beaconPickerOpen);
  const setOpen = useSpaceStore((s) => s.setBeaconPickerOpen);

  useEffect(() => {
    if (!open) return;
    const pick = (i: number) => { setOpen(false); void dropBeacon(i); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      const d = /^Digit([1-9])$/.exec(e.code);
      if (d && Number(d[1]) <= BEACON_PHRASES.length) { e.preventDefault(); pick(Number(d[1]) - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 pointer-events-auto"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="beacon-title" data-testid="beacon-picker"
        className="w-full max-w-sm rounded-2xl border border-[#00ff87]/25 bg-[#05040c]/95 p-5 font-mono text-[11px] text-white/80">
        <h2 id="beacon-title" className="text-[#00ff87] text-xs tracking-[0.2em] mb-1">DROP A BEACON</h2>
        <p className="text-white/50 text-[10px] mb-4">
          Left where your ship is now, for every pilot who flies past. One every 10 minutes.
        </p>
        <ol className="flex flex-col gap-1.5">
          {BEACON_PHRASES.map((p, i) => (
            <li key={p}>
              <button autoFocus={i === 0} onClick={() => { setOpen(false); void dropBeacon(i); }}
                className="w-full flex items-center gap-3 rounded-lg border border-white/5 px-3 py-2 text-left hover:border-[#00ff87]/40 hover:text-[#00ff87] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#00ff87]">
                <span className="text-white/35 w-3">{i + 1}</span>{p}
              </button>
            </li>
          ))}
        </ol>
        <button onClick={() => setOpen(false)} className="mt-4 w-full text-center text-white/40 hover:text-white py-1">
          CANCEL · ESC
        </button>
      </div>
    </div>
  );
}
