import { describe, it, expect } from "vitest";
import { budgetDpr, MAX_DPR, PIXEL_BUDGET } from "../src/utils/pixelBudget";

const pixels = (w: number, h: number, dpr: number) => Math.round(w * dpr) * Math.round(h * dpr);

describe("budgetDpr", () => {
  it("never draws more than the budget on a Retina laptop", () => {
    const dpr = budgetDpr(1512, 802, 2);
    expect(dpr).toBeLessThan(MAX_DPR);
    expect(pixels(1512, 802, dpr)).toBeLessThanOrEqual(PIXEL_BUDGET * 1.001);
    expect(pixels(1512, 802, dpr)).toBeGreaterThan(PIXEL_BUDGET * 0.99);
  });

  it("keeps the 1.5 cap where the budget allows more", () => {
    expect(budgetDpr(760, 377, 2)).toBe(MAX_DPR);
  });

  it("never asks for more than the screen has", () => {
    expect(budgetDpr(390, 844, 1)).toBe(1);
    expect(budgetDpr(800, 600, 1.25)).toBe(1.25);
  });

  it("never goes below one pixel per CSS pixel, even on a large screen", () => {
    expect(budgetDpr(2560, 1440, 1)).toBe(1);
    expect(budgetDpr(3840, 2160, 2)).toBe(1);
  });

  it("survives a zero-sized canvas", () => {
    expect(budgetDpr(0, 0, 2)).toBe(MAX_DPR);
  });
});
