import { useEffect, useState } from "react";

export function useKeyboard() {
  const [movement, setMovement] = useState({
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          setMovement((m) => ({ ...m, forward: true }));
          break;
        case "KeyS":
        case "ArrowDown":
          setMovement((m) => ({ ...m, backward: true }));
          break;
        case "KeyA":
        case "ArrowLeft":
          setMovement((m) => ({ ...m, left: true }));
          break;
        case "KeyD":
        case "ArrowRight":
          setMovement((m) => ({ ...m, right: true }));
          break;
        case "Space":
          setMovement((m) => ({ ...m, jump: true }));
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case "KeyW":
        case "ArrowUp":
          setMovement((m) => ({ ...m, forward: false }));
          break;
        case "KeyS":
        case "ArrowDown":
          setMovement((m) => ({ ...m, backward: false }));
          break;
        case "KeyA":
        case "ArrowLeft":
          setMovement((m) => ({ ...m, left: false }));
          break;
        case "KeyD":
        case "ArrowRight":
          setMovement((m) => ({ ...m, right: false }));
          break;
        case "Space":
          setMovement((m) => ({ ...m, jump: false }));
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return movement;
}
