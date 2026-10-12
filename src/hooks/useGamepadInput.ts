import { useEffect } from "react";
import { flight, useSpaceStore } from "../store/spaceStore";
import {
  PAD_NEUTRAL, padActions, padFlightChanges, pressedButtons, readPadFlight,
  type PadAction, type PadFlight,
} from "../utils/gamepad";

const LINKED_MESSAGE = "CONTROLLER LINKED // L-STICK FLY · R-STICK PITCH · RB WARP · LB BEAM · A SCAN · Y PHOTO · D-PAD JUMP";

/**
 * First pad reporting the W3C standard layout. Flight sticks, wheels and some
 * adapters report `mapping: ""` with their own axis order — a throttle axis
 * resting at -1 would read as a permanent climb — so they are ignored.
 */
function firstPad(): Gamepad | null {
  for (const p of navigator.getGamepads()) if (p?.connected && p.mapping === "standard") return p;
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
    /** Last frame's buttons; null until seeded, so a button already down at connect is not a press. */
    let buttons: boolean[] | null = null;
    let padIndex = -1;

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

    const lost = () => {
      // Let go of whatever the pad was holding, so the ship doesn't keep turning.
      write({ ...PAD_NEUTRAL });
      buttons = null;
      const s = useSpaceStore.getState();
      if (s.padConnected) {
        s.setPadConnected(false);
        s.sendBroadcast("CONTROLLER LOST // KEYBOARD FLIGHT RESTORED");
      }
    };

    const tick = () => {
      raf = 0;
      const pad = firstPad();
      if (!pad) { lost(); return; }
      if (pad.index !== padIndex) { padIndex = pad.index; buttons = null; }
      const next = pressedButtons(pad);
      // The classic résumé is a normal page: the pad must not fly the ship
      // behind it. And an unfocused tab gets no pad input at all — the keyboard
      // hook releases everything on blur, and the pad must not undo that.
      if (useSpaceStore.getState().showClassicCV || !document.hasFocus()) {
        write({ ...PAD_NEUTRAL });
      } else {
        write(readPadFlight(pad));
        if (buttons) for (const a of padActions(buttons, next)) act(a);
      }
      buttons = next;
      raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!raf) raf = requestAnimationFrame(tick); };

    const onConnect = () => {
      if (!firstPad()) return; // a non-standard device
      const s = useSpaceStore.getState();
      if (!s.padConnected) {
        s.setPadConnected(true);
        s.sendBroadcast(LINKED_MESSAGE);
      }
      start();
    };
    const onDisconnect = () => { if (!firstPad()) lost(); };

    // Rumble on impacts. Chrome only; elsewhere vibrationActuator is absent.
    const unsubImpact = useSpaceStore.subscribe((s) => s.impactCount, () => {
      firstPad()?.vibrationActuator?.playEffect("dual-rumble", {
        duration: 140, strongMagnitude: 0.7, weakMagnitude: 0.4,
      }).catch(() => { /* rumble is a nicety */ });
    });

    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    // A pad that already revealed itself (e.g. after a hot reload) fires no new event.
    onConnect();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      write({ ...PAD_NEUTRAL });
      unsubImpact();
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, [jumpIds]);
}
