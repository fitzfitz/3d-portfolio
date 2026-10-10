import { describe, it, expect } from "vitest";
import { isEditableTarget, isModifiedChord, resetFlightInput } from "../src/hooks/useKeyboardInput";
import type { FlightInput } from "../src/store/spaceStore";

describe("isEditableTarget", () => {
  it("blocks inputs, textareas, contenteditable", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("allows body/canvas/null", () => {
    expect(isEditableTarget({ tagName: "BODY" })).toBe(false);
    expect(isEditableTarget({ tagName: "CANVAS", isContentEditable: false })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("isModifiedChord", () => {
  // Cmd+D / Ctrl+S are browser shortcuts, not flight input — and on macOS the
  // keyup of the second key never arrives while Cmd is held, so treating the
  // keydown as flight input leaves the key stuck on.
  it("flags Cmd/Ctrl/Alt chords", () => {
    expect(isModifiedChord({ metaKey: true, ctrlKey: false, altKey: false })).toBe(true);
    expect(isModifiedChord({ metaKey: false, ctrlKey: true, altKey: false })).toBe(true);
    expect(isModifiedChord({ metaKey: false, ctrlKey: false, altKey: true })).toBe(true);
  });
  it("lets bare keys and Shift through (Shift is the warp key)", () => {
    expect(isModifiedChord({ metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
  });
});

describe("resetFlightInput", () => {
  it("releases every digital and analog channel", () => {
    const input: FlightInput = {
      forward: true, backward: true, left: true, right: true, boost: true,
      ascend: true, descend: true, steer: 0.7, thrust: -0.4, scan: true,
    };
    resetFlightInput(input);
    expect(input).toEqual({
      forward: false, backward: false, left: false, right: false, boost: false,
      ascend: false, descend: false, steer: 0, thrust: 0, scan: false,
    });
  });
});
