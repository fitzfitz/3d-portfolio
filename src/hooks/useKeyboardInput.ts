import { useEffect } from "react";
import { flight, useSpaceStore, selectModalOpen, type FlightInput, type SpaceState } from "../store/spaceStore";
import { beamState } from "../store/beamState";

type BoolKey = "forward" | "backward" | "left" | "right" | "boost" | "ascend" | "descend" | "scan" | "beam";

const KEYMAP: Record<string, BoolKey> = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "backward", ArrowDown: "backward",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "ascend",
  KeyC: "descend", KeyX: "descend",
  ShiftLeft: "boost", ShiftRight: "boost",
  KeyE: "scan",
  KeyF: "beam",
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

type KeyGuardEvent = {
  target: { tagName?: string; isContentEditable?: boolean } | null;
  metaKey: boolean; ctrlKey: boolean; altKey: boolean;
};
type KeyGuardState = Pick<SpaceState, "showClassicCV" | "bottlePanelOpen">;

/**
 * True when a keydown must not reach flight input: typing in a field, a
 * browser chord, the classic résumé (a normal page: Space and the arrows
 * scroll it), or the bottle panel, which owns the keyboard while open.
 */
export function flightKeyIgnored(e: KeyGuardEvent, s: KeyGuardState): boolean {
  return isEditableTarget(e.target) || isModifiedChord(e) || s.showClassicCV || s.bottlePanelOpen;
}

/**
 * True when a keydown must not reach the game's shortcut keys (P, B, L, N,
 * the number jumps): the flight guards, plus key repeat.
 */
export function gameKeyIgnored(e: KeyGuardEvent & { repeat: boolean }, s: KeyGuardState): boolean {
  return e.repeat || flightKeyIgnored(e, s);
}

/** Releases every input channel, digital and analog. */
export function resetFlightInput(input: FlightInput): void {
  input.forward = false; input.backward = false; input.left = false; input.right = false;
  input.boost = false; input.ascend = false; input.descend = false; input.scan = false; input.beam = false;
  input.steer = 0; input.thrust = 0;
}

/**
 * An opening dossier freezes the scene, so anything held at that moment (F for
 * the beam, W, a pad stick) would sit stuck under the modal and fire on close.
 * Releases every channel, and the beam, on the null -> open edge only.
 */
export function watchDossierRelease(): () => void {
  return useSpaceStore.subscribe(
    (s) => s.openDossier,
    (id) => {
      if (id === null) return;
      resetFlightInput(flight.input);
      beamState.active = false;
      beamState.reel.active = false;
    },
  );
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
      if (!Object.hasOwn(KEYMAP, e.code)) return;
      const s = useSpaceStore.getState();
      if (flightKeyIgnored({ target: e.target as HTMLElement | null, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey }, s)) return;
      // In flight, Space would otherwise also "click" whichever button kept
      // focus after a mouse click (e.g. VIEW_CLASSIC_RESUME). With a dossier
      // open the scene is frozen, so leave keys to the dialog's buttons.
      if (!selectModalOpen(s)) e.preventDefault();
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
    const unwatch = watchDossierRelease();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unwatch();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
