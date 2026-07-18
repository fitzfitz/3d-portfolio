import { useEffect } from "react";
import { soundManager } from "../audio/soundManager";
import { useSpaceStore } from "../store/spaceStore";

/** Mount once in App: gesture-gated init, store-event one-shots, engine-hum loop. */
export function useSound() {
  const isMuted = useSpaceStore((s) => s.isMuted);

  useEffect(() => {
    soundManager.setMuted(isMuted);
  }, [isMuted]);

  useEffect(() => {
    const start = () => soundManager.init();
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });

    const unsubs = [
      useSpaceStore.subscribe(
        (s) => s.isOrbitLocked,
        (locked) => (locked ? soundManager.chime() : soundManager.thunk())
      ),
      useSpaceStore.subscribe(
        (s) => s.isTeleporting,
        (flash) => { if (flash) soundManager.zap(); }
      ),
    ];
    soundManager.startLoop();

    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      unsubs.forEach((u) => u());
      soundManager.stopLoop();
    };
  }, []);
}
