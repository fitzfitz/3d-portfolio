import { useEffect } from "react";
import { flight, type FlightInput } from "../store/spaceStore";

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
      if (isEditableTarget(el)) return;
      set(e.code, true);
    };
    const up = (e: KeyboardEvent) => set(e.code, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}
