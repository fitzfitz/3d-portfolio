import { useEffect } from "react";
import { flight, type FlightInput } from "../store/spaceStore";

type BoolKey = "forward" | "backward" | "left" | "right" | "boost" | "ascend" | "descend";

const KEYMAP: Record<string, BoolKey> = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "backward", ArrowDown: "backward",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "ascend",
  KeyC: "descend", KeyX: "descend",
  ShiftLeft: "boost", ShiftRight: "boost",
};

/** Writes key state straight into flight.input — zero React re-renders. */
export function useKeyboardInput() {
  useEffect(() => {
    const set = (code: string, value: boolean) => {
      const key = KEYMAP[code];
      if (key) (flight.input as FlightInput)[key] = value;
    };
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) return;
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
