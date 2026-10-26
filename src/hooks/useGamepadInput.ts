import { useEffect } from "react";
import { flight, useSpaceStore, selectModalOpen, type SpaceState } from "../store/spaceStore";
import { requestGuideToggle } from "../utils/guideToggle";
import { raceKey } from "../utils/raceJoin";
import {
  PAD_NEUTRAL, padActions, padFlightChanges, pressedButtons, readPadFlight,
  type PadAction, type PadFlight,
} from "../utils/gamepad";

export const LINKED_MESSAGE = "CONTROLLER LINKED // L-STICK FLY · R-STICK PITCH · RB WARP · LB BEAM · A SCAN · Y PHOTO · X LOGBOOK · R3 GUIDE · L3 RACE · D-PAD JUMP · VIEW SHIPYARD · MENU CONTACT";

/**
 * First pad reporting the W3C standard layout. Flight sticks, wheels and some
 * adapters report `mapping: ""` with their own axis order — a throttle axis
 * resting at -1 would read as a permanent climb — so they are ignored.
 */
function firstPad(): Gamepad | null {
  for (const p of navigator.getGamepads()) if (p?.connected && p.mapping === "standard") return p;
  return null;
}

type PadStore = Pick<SpaceState,
  "showClassicCV" | "bottlePanelOpen" | "photoMode" | "isOrbitLocked" | "openDossier" | "logbookOpen" |
  "setPhotoMode" | "breakOrbit" | "closeDossier" | "setLogbookOpen" | "requestJump">;

/**
 * One pad button press. Same guards as the keyboard: nothing while the
 * classic résumé or the bottle panel is up (the panel owns the keys).
 * R3 (guide) follows J: ignored under a dossier or dock panel. L3 (race)
 * follows R: not in photo mode or under a dossier or dock panel.
 */
export function runPadAction(a: PadAction, s: PadStore, race: () => void = raceKey): void {
  if (s.showClassicCV || s.bottlePanelOpen) return;
  if (a.kind === "photo") s.setPhotoMode(!s.photoMode);
  else if (a.kind === "close") {
    // A project dossier is not an orbit lock: B closes whichever is up.
    if (s.openDossier !== null) s.closeDossier();
    else if (s.isOrbitLocked) s.breakOrbit();
  }
  else if (a.kind === "logbook") { if (!s.photoMode && !selectModalOpen(s)) s.setLogbookOpen(!s.logbookOpen); }
  else if (a.kind === "guide") { if (!selectModalOpen(s)) requestGuideToggle(); }
  else if (a.kind === "race") { if (!s.photoMode && !selectModalOpen(s)) race(); }
  else if (!s.photoMode) s.requestJump(a.id);
}

/** The sticks write nothing behind the classic résumé or under an open dossier. */
export function padShouldIdle(s: Pick<SpaceState, "showClassicCV" | "openDossier">): boolean {
  return s.showClassicCV || s.openDossier !== null;
}

/**
 * Polls the first connected gamepad into flight.input — zero React re-renders,
 * like the keyboard. The Gamepad API has no input events, so it is read once
 * per animation frame, and only while a pad is connected.
 */
export function useGamepadInput() {
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
      if (padShouldIdle(useSpaceStore.getState()) || !document.hasFocus()) write({ ...PAD_NEUTRAL });
      else write(readPadFlight(pad));
      // Buttons still act under an open dossier (only the sticks idle there):
      // B is how a pad closes it. runPadAction keeps the résumé/picker guards.
      if (buttons && document.hasFocus()) for (const a of padActions(buttons, next)) runPadAction(a, useSpaceStore.getState());
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
  }, []);
}
