import { useEffect } from "react";
import { soundManager } from "../audio/soundManager";
import { useSpaceStore, selectModalOpen } from "../store/spaceStore";

/** Mount once in App: gesture-gated init, store-event one-shots, engine-hum loop. */
export function useSound() {
  const isMuted = useSpaceStore((s) => s.isMuted);

  useEffect(() => {
    soundManager.setMuted(isMuted);
  }, [isMuted]);

  useEffect(() => {
    // Retry on every gesture until the context is running: iOS/Android only
    // accept touchend/pointerup/click as activation, not pointerdown.
    const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    const start = () => {
      if (soundManager.unlock()) GESTURES.forEach((g) => window.removeEventListener(g, start));
    };
    GESTURES.forEach((g) => window.addEventListener(g, start));
    const onVisibility = () => soundManager.setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);

    const unsubs = [
      useSpaceStore.subscribe(
        selectModalOpen,
        (open) => (open ? soundManager.chime() : soundManager.thunk())
      ),
      useSpaceStore.subscribe(
        (s) => s.isTeleporting,
        (flash) => { if (flash) soundManager.zap(); }
      ),
      useSpaceStore.subscribe(
        (s) => s.badges.length,
        (n, prev) => { if (n > prev) soundManager.badge(); }
      ),
    ];
    soundManager.startLoop();

    return () => {
      GESTURES.forEach((g) => window.removeEventListener(g, start));
      document.removeEventListener("visibilitychange", onVisibility);
      unsubs.forEach((u) => u());
      soundManager.stopLoop();
    };
  }, []);
}
