import { describe, it, expect } from "vitest";
import { verticalStep, V_MAX, V_CEIL } from "../src/utils/verticalFlight";

const idle = { ascend: false, descend: false, autoLevel: false };

describe("verticalStep", () => {
  it("ascend accelerates upward", () => {
    const r = verticalStep(0, 0, { ...idle, ascend: true }, 0.1);
    expect(r.vy).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThan(0);
  });
  it("vertical speed is capped at V_MAX", () => {
    let s = { y: 0, vy: 0 };
    for (let i = 0; i < 100; i++) s = verticalStep(s.y, s.vy, { ...idle, ascend: true }, 0.05);
    expect(s.vy).toBeLessThanOrEqual(V_MAX + 1e-9);
  });
  it("idle decays vertical speed", () => {
    const r = verticalStep(10, 5, idle, 0.1);
    expect(r.vy).toBeLessThan(5);
    expect(r.vy).toBeGreaterThan(0);
  });
  it("autoLevel eases y toward 0 when no keys held", () => {
    const r = verticalStep(20, 0, { ...idle, autoLevel: true }, 1);
    expect(r.y).toBeLessThan(20);
    expect(r.y).toBeGreaterThan(0);
  });
  it("autoLevel does nothing while a key is held", () => {
    const r = verticalStep(20, 0, { ascend: true, descend: false, autoLevel: true }, 0.1);
    expect(r.y).toBeGreaterThanOrEqual(20);
  });
  it("soft ceiling: y never exceeds V_CEIL even under sustained ascend", () => {
    let s = { y: 50, vy: V_MAX };
    for (let i = 0; i < 300; i++) s = verticalStep(s.y, s.vy, { ...idle, ascend: true }, 0.05);
    expect(s.y).toBeLessThanOrEqual(V_CEIL);
  });
  it("soft floor mirrors the ceiling", () => {
    let s = { y: -50, vy: -V_MAX };
    for (let i = 0; i < 300; i++) s = verticalStep(s.y, s.vy, { ...idle, descend: true }, 0.05);
    expect(s.y).toBeGreaterThanOrEqual(-V_CEIL);
  });
});
