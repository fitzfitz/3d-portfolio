import { describe, it, expect } from "vitest";
import { isEditableTarget } from "../src/hooks/useKeyboardInput";

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
