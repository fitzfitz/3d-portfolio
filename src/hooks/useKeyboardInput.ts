import { useEffect } from "react";
import { flight, useSpaceStore, type FlightInput } from "../store/spaceStore";

type BoolKey = "forward" | "backward" | "left" | "right" | "boost" | "ascend" | "descend" | "scan";

const KEYMAP: Record<string, BoolKey> = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "backward", ArrowDown: "backward",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "ascend",
  KeyC: "descend", KeyX: "descend",
  ShiftLeft: "boost", ShiftRight: "boost",
  KeyE: "scan",
};

/** True when the event target is a text-entry element — flight keys must not fire there. */
export function isEditableTarget(el: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true);
}

/**
 * True for Cmd/Ctrl/Alt chords. Those are browser shortcuts, not flight input,
 * and on macOS the keyup of the second key never arrives while Cmd is held —
 * so Cmd+D would otherwise leave "turn right" stuck on.
 */
export function isModifiedChord(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}

/** Releases every input channel, digital and analog. */
export function resetFlightInput(input: FlightInput): void {
  input.forward = false; input.backward = false; input.left = false; input.right = false;
  input.boost = false; input.ascend = false; input.descend = false; input.scan = false;
  input.steer = 0; input.thrust = 0;
}

/** Writes key state straight into flight.input — zero React re-renders. */
export function useKeyboardInput() {
  useEffect(() => {
    const set = (code: string, value: boolean) => {
      const key = KEYMAP[code];
      if (key) (flight.input as FlightInput)[key] = value;
    };
    const down = (e: KeyboardEvent) => {
      // keydown only: guarding keyup too would leave a key stuck ON if it's
      // released while focus sits in a form field (e.g. held W, click input, release).
      const el = e.target as HTMLElement | null;
      if (isEditableTarget(el) || isModifiedChord(e)) return;
      if (!Object.hasOwn(KEYMAP, e.code)) return;
      const s = useSpaceStore.getState();
      // The classic résumé is a normal page: Space and the arrows scroll it.
      if (s.showClassicCV) return;
      // The beacon picker owns the keyboard: its number keys pick a phrase.
      if (s.beaconPickerOpen) return;
      // In flight, Space would otherwise also "click" whichever button kept
      // focus after a mouse click (e.g. VIEW_CLASSIC_RESUME). With a dossier
      // open the scene is frozen, so leave keys to the dialog's buttons.
      if (!s.isOrbitLocked) e.preventDefault();
      set(e.code, true);
    };
    const up = (e: KeyboardEvent) => {
      // A keyup swallowed during a Cmd chord never arrives, so releasing Cmd
      // or Ctrl releases everything.
      if (e.key === "Meta" || e.key === "Control") resetFlightInput(flight.input);
      else set(e.code, false);
    };
    // Alt-Tab / Cmd-Tab / switching tabs mid-hold: the keyup goes to another
    // window, so without this the ship keeps thrusting (and burning fuel).
    const release = () => resetFlightInput(flight.input);
    const onVisibility = () => { if (document.hidden) release(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
