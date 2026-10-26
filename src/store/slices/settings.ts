import { REDUCED_MOTION_QUERY, resolveReducedMotion } from "../../utils/reducedMotionPreference";
import { setAmbientEnabled } from "../../utils/ambientTime";
import { CHANGELOG } from "../../data/changelog";
import { STORE_KEYS, safeGetMuted, safeSetMuted, safeGetReducedMotion, safeSetReducedMotion, safeGetJSON, safeSetJSON } from "../persist";
import type { SliceCreator } from "../spaceStore";

/** Performance tier, warm-up and scene readiness, reduced motion, sound, and the changelog's seen mark. */
export interface SettingsSlice {
  isLowPerf: boolean;
  lowPerfManual: boolean;
  /**
   * A tier switch requested during shader warm-up, applied when warm-up ends.
   * Switching mid-warm-up unmounts the full-detail objects and disposes
   * materials three's compileAsync is still polling; its poll then throws
   * ("reading 'isReady'") and ShaderWarmup waits out its 8s cap.
   */
  pendingLowPerf: boolean | null;
  setLowPerf: (v: boolean, manual?: boolean) => void;
  /** True while ShaderWarmup holds the frame loop for async shader compile. */
  warmingUp: boolean;
  setWarmingUp: (v: boolean) => void;
  /** True once every Suspense-loaded asset has resolved and the scene is on screen. */
  sceneReady: boolean;
  setSceneReady: (v: boolean) => void;
  reducedMotion: boolean;
  reducedMotionManual: boolean;
  setReducedMotion: (v: boolean, manual?: boolean) => void;
  isMuted: boolean;
  setMuted: (v: boolean) => void;
  /** Newest changelog id the visitor has seen (persisted as fitz-changelog-seen). */
  changelogSeen: string;
  markChangelogSeen: () => void;
}

// `matchMedia` can be absent (old browser, SSR-ish context) — degrade to "no
// preference" rather than throwing. Seeding from the live query at module
// scope (rather than assuming `false`) closes a startup gap for an OS-reduce
// visitor with nothing stored: without it, `reducedMotion` and the ambient
// clock would both start as if no preference were set, and only flip once
// the sync effect in useReducedMotion ran after first paint.
function safeGetReducedMotionQueryMatches(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

export const createSettingsSlice: SliceCreator<SettingsSlice> = (set, get) => {
  // Initial state, read once as the store is created (at import). These run
  // after every slice module's own import-time reads, which keeps the old order:
  // the legacy-cartographer write (progress.ts), then the ambient switch, then
  // the first-visit changelog write.

  // Read once: the two derived fields below must agree, and calling the
  // helper twice could in principle race with a concurrent write.
  const storedReducedMotion = safeGetReducedMotion();
  const initialReducedMotionQueryMatches = safeGetReducedMotionQueryMatches();
  // Synchronise the ambient clock here, as the store is created, not inside a mount
  // effect: the effect that would otherwise do this (Task 3's media-query sync)
  // skips its own call when the choice is manual, since manual already reflects
  // the visitor's intent. Without this line a reload with reduced motion stored
  // ON would leave `enabled` at its `true` default until the visitor toggled
  // the HUD button twice — the store would say reduced motion is on while the
  // decorative clock kept advancing.
  setAmbientEnabled(!resolveReducedMotion(storedReducedMotion, initialReducedMotionQueryMatches));

  /** First visit: everything is new, so mark the newest entry seen and show no dot. */
  const initialChangelogSeen = (() => {
    const raw = safeGetJSON<unknown>(STORE_KEYS.changelogSeen, null);
    if (typeof raw === "string") return raw;
    safeSetJSON(STORE_KEYS.changelogSeen, CHANGELOG[0].id);
    return CHANGELOG[0].id;
  })();

  return {
    isLowPerf: false,
    lowPerfManual: false,
    pendingLowPerf: null,
    // The manual lock applies at once, so an automatic decline arriving during
    // warm-up is still refused; only the tier itself waits (pendingLowPerf).
    setLowPerf: (v, manual = false) =>
      set((s) => s.warmingUp
        ? { pendingLowPerf: v, lowPerfManual: s.lowPerfManual || manual }
        : { isLowPerf: v, pendingLowPerf: null, lowPerfManual: s.lowPerfManual || manual }),
    warmingUp: false,
    setWarmingUp: (v) => {
      const s = get();
      if (s.warmingUp === v) return;
      // Ending warm-up releases a tier switch held back during it (setLowPerf).
      if (!v && s.pendingLowPerf !== null) set({ warmingUp: false, isLowPerf: s.pendingLowPerf, pendingLowPerf: null });
      else set({ warmingUp: v });
    },
    sceneReady: false,
    setSceneReady: (v) => { if (get().sceneReady !== v) set({ sceneReady: v }); },
    reducedMotion: resolveReducedMotion(storedReducedMotion, initialReducedMotionQueryMatches),
    reducedMotionManual: storedReducedMotion !== null,
    setReducedMotion: (v, manual = false) => {
      if (manual) safeSetReducedMotion(v);
      // Ambient motion is the inverse of reduced motion.
      setAmbientEnabled(!v);
      set((s) => ({ reducedMotion: v, reducedMotionManual: s.reducedMotionManual || manual }));
    },
    isMuted: safeGetMuted(),
    setMuted: (v) => {
      set({ isMuted: v });
      safeSetMuted(v);
    },
    changelogSeen: initialChangelogSeen,
    markChangelogSeen: () => {
      const newest = CHANGELOG[0].id;
      if (get().changelogSeen === newest) return;
      safeSetJSON(STORE_KEYS.changelogSeen, newest);
      set({ changelogSeen: newest });
    },
  };
};
