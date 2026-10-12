import { useEffect } from "react";
import { flight, useSpaceStore } from "../store/spaceStore";
import {
  PAD_NEUTRAL, padActions, padFlightChanges, pressedButtons, readPadFlight,
  type PadAction, type PadFlight,
} from "../utils/gamepad";

const LINKED_MESSAGE = "CONTROLLER LINKED // L-STICK FLY · R-STICK PITCH · RB WARP · A SCAN · Y PHOTO · D-PAD JUMP";

function firstPad(): Gamepad | null {
  for (const p of navigator.getGamepads()) if (p?.connected) return p;
  return null;
}

/**
 * Polls the first connected gamepad into flight.input — zero React re-renders,
 * like the keyboard. The Gamepad API has no input events, so it is read once
 * per animation frame, and only while a pad is connected.
 *
 * `jumpIds` is the jump-target order the number keys use; the d-pad mirrors it.
 */
export function useGamepadInput(jumpIds: readonly string[]) {
  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
    let raf = 0;
    let held: PadFlight = { ...PAD_NEUTRAL };
    let buttons: boolean[] = [];

    const write = (next: PadFlight) => {
      Object.assign(flight.input, padFlightChanges(held, next));
      held = next;
    };

    const act = (a: PadAction) => {
      const s = useSpaceStore.getState();
      if (a.kind === "photo") s.setPhotoMode(!s.photoMode);
      else if (a.kind === "close") { if (s.isOrbitLocked) s.breakOrbit(); }
      else if (!s.photoMode) {
        const id = jumpIds[a.index];
        if (id) s.requestJump(id);
      }
    };

    const tick = () => {
      raf = 0;
      const pad = firstPad();
      if (!pad) { write({ ...PAD_NEUTRAL }); buttons = []; return; }
      // The classic résumé is a normal page: the pad must not fly the ship behind it.
      if (useSpaceStore.getState().showClassicCV) {
        write({ ...PAD_NEUTRAL });
        buttons = pressedButtons(pad);
      } else {
        write(readPadFlight(pad));
        const next = pressedButtons(pad);
        for (const a of padActions(buttons, next)) act(a);
        buttons = next;
      }
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(tick); };

    const onConnect = () => {
      const s = useSpaceStore.getState();
      if (!s.padConnected) {
        s.setPadConnected(true);
        s.sendBroadcast(LINKED_MESSAGE);
      }
      start();
    };
    const onDisconnect = () => {
      if (firstPad()) return;
      // Let go of whatever the pad was holding, so the ship doesn't keep turning.
      write({ ...PAD_NEUTRAL });
      buttons = [];
      useSpaceStore.getState().setPadConnected(false);
      useSpaceStore.getState().sendBroadcast("CONTROLLER LOST // KEYBOARD FLIGHT RESTORED");
    };
    // The keyboard hook clears all of flight.input on blur. Forget what the pad
    // held too, so a stick still deflected on return is written again next frame.
    const forget = () => { held = { ...PAD_NEUTRAL }; };
    const onVisibility = () => { if (document.hidden) forget(); };

    // Rumble on impacts. Chrome only; elsewhere vibrationActuator is absent.
    const unsubImpact = useSpaceStore.subscribe((s) => s.impactCount, () => {
      const pad = firstPad();
      pad?.vibrationActuator?.playEffect("dual-rumble", {
        duration: 140, strongMagnitude: 0.7, weakMagnitude: 0.4,
      }).catch(() => { /* rumble is a nicety */ });
    });

    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    window.addEventListener("blur", forget);
    document.addEventListener("visibilitychange", onVisibility);
    // A pad that already revealed itself (e.g. after a hot reload) fires no new event.
    if (firstPad()) onConnect();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      unsubImpact();
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
      window.removeEventListener("blur", forget);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [jumpIds]);
}
