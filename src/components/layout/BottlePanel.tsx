import { useEffect, useReducer, useRef } from "react";
import { useSpaceStore } from "../../store/spaceStore";
import { dropBottle } from "../../utils/beaconActions";
import { EMPTY_DRAFT, draftReducer, draftView, sendDraft } from "../../utils/bottleDraft";

/**
 * Writing a message in a bottle (spec "Writing a note"): a text box with a
 * live counter, the filter's reason as you type, Send and Cancel. A failed
 * send keeps the text so the pilot can edit it; only a sent bottle empties
 * the box. Esc or Cancel closes it (the draft stays for next time).
 *
 * While open the keyboard flies nothing and the game keys do nothing
 * (flightKeyIgnored / gameKeyIgnored in useKeyboardInput.ts). The note is
 * plain text throughout: React escapes it, and nothing here builds markup.
 */
export default function BottlePanel() {
  const open = useSpaceStore((s) => s.bottlePanelOpen);
  const setOpen = useSpaceStore((s) => s.setBottlePanelOpen);
  const [draft, dispatch] = useReducer(draftReducer, EMPTY_DRAFT);
  const view = draftView(draft);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener.current?.focus?.();
    };
  }, [open, setOpen]);

  const send = async () => {
    if (!view.canSend) return;
    dispatch({ type: "sending" });
    const next = await sendDraft(draft.text, dropBottle);
    dispatch(next);
    if (next.type === "sent") setOpen(false);
  };

  if (!open) return null;
  const hintId = "bottle-hint";
  const countId = "bottle-count";
  return (
    // Top-aligned on phones so the on-screen keyboard does not cover the box.
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-black/50 px-4 pt-[8vh] sm:pt-0 pointer-events-auto"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="bottle-title" data-testid="bottle-panel"
        onSubmit={(e) => { e.preventDefault(); void send(); }}
        className="w-full max-w-sm rounded-2xl border border-[#00ff87]/25 bg-[#05040c]/95 p-5 font-mono text-[11px] text-white/80">
        <h2 id="bottle-title" className="text-[#00ff87] text-xs tracking-[0.2em] mb-1">LEAVE A MESSAGE IN A BOTTLE</h2>
        <p className="text-white/50 text-[10px] mb-3">
          Left where your ship is now, for every pilot who flies past. They see your note, your
          country and how long ago. No links or contact details. One every 10 minutes.
        </p>
        <label htmlFor="bottle-text" className="sr-only">Your note</label>
        <textarea id="bottle-text" data-testid="bottle-text" autoFocus rows={3}
          value={draft.text} onChange={(e) => dispatch({ type: "edit", text: e.target.value })}
          onKeyDown={(e) => {
            // Enter sends (line breaks collapse to spaces anyway); the on-screen keyboard shows "Send".
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          }}
          aria-describedby={`${countId} ${hintId}`} aria-invalid={view.hint !== null || view.over}
          enterKeyHint="send" autoCapitalize="sentences" autoComplete="off" spellCheck
          placeholder="Say hello to the next pilot"
          className="w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[16px] sm:text-xs text-white placeholder:text-white/30 outline-none focus-visible:border-[#00ff87]/50" />
        <div className="mt-1 flex items-start justify-between gap-3 min-h-[1.5em]">
          <p id={hintId} data-testid="bottle-hint" role="status" aria-live="polite" className="text-[10px] text-amber-300">
            {view.hint ?? ""}
          </p>
          <span id={countId} data-testid="bottle-count" aria-label={`${view.count} of ${view.max} characters`}
            className={`shrink-0 text-[10px] tabular-nums ${view.over ? "text-red-400" : "text-white/40"}`}>
            {`${view.count}/${view.max}`}
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" data-testid="bottle-cancel" onClick={() => setOpen(false)}
            className="flex-1 rounded-lg border border-white/5 py-2 text-white/50 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#00ff87]">
            CANCEL · ESC
          </button>
          <button type="submit" data-testid="bottle-send" disabled={!view.canSend}
            className="flex-1 rounded-lg border border-[#00ff87]/40 py-2 text-[#00ff87] hover:bg-[#00ff87]/10 disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#00ff87]">
            {draft.sending ? "SENDING..." : "SEND"}
          </button>
        </div>
      </form>
    </div>
  );
}
