import { useEffect } from "react";
import { flight, type FlightInput } from "../store/spaceStore";

type BoolKey = "forward" | "backward" | "left" | "right" | "boost";

const KEYMAP: Record<string, BoolKey> = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "backward", ArrowDown: "backward",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "boost",
};

/** Writes key state straight into flight.input — zero React re-renders. */
export function useKeyboardInput() {
  useEffect(() => {
    const set = (code: string, value: boolean) => {
      const key = KEYMAP[code];
      if (key) (flight.input as FlightInput)[key] = value;
    };
    const down = (e: KeyboardEvent) => set(e.code, true);
    const up = (e: KeyboardEvent) => set(e.code, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}
