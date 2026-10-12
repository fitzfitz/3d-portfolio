import { describe, it, expect } from "vitest";
import {
  deadzone, readPadFlight, padFlightChanges, padActions, PAD_NEUTRAL, type PadLike,
} from "../src/utils/gamepad";

/** A standard-mapping pad at rest: 4 axes, 17 buttons. */
function pad(over: { axes?: Record<number, number>; buttons?: Record<number, number> } = {}): PadLike {
  const axes = [0, 0, 0, 0];
  for (const [i, v] of Object.entries(over.axes ?? {})) axes[Number(i)] = v;
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = over.buttons?.[i] ?? 0;
    return { pressed: value > 0.5, value };
  });
  return { axes, buttons };
}

describe("deadzone", () => {
  // Sticks at rest drift by ±0.05–0.1; without this the ship slowly turns by itself.
  it("zeroes drift inside the zone", () => {
    expect(deadzone(0.1)).toBe(0);
    expect(deadzone(-0.14)).toBe(0);
  });
  it("rescales outside the zone so full deflection still reaches 1", () => {
    expect(deadzone(1)).toBe(1);
    expect(deadzone(-1)).toBe(-1);
    expect(deadzone(0.575)).toBeCloseTo(0.5);
  });
});

describe("readPadFlight", () => {
  it("is neutral at rest", () => {
    expect(readPadFlight(pad())).toEqual(PAD_NEUTRAL);
  });
  it("maps the left stick to steer (right = +1, matching the touch joystick)", () => {
    expect(readPadFlight(pad({ axes: { 0: 1 } })).steer).toBe(1);
    expect(readPadFlight(pad({ axes: { 0: -1 } })).steer).toBe(-1);
  });
  it("maps left stick up to forward thrust and down to brake", () => {
    // Gamepad Y axes are +1 down.
    expect(readPadFlight(pad({ axes: { 1: -1 } })).thrust).toBe(1);
    expect(readPadFlight(pad({ axes: { 1: 1 } })).thrust).toBe(-1);
  });
  it("adds the triggers to thrust: RT throttles, LT brakes, clamped to ±1", () => {
    expect(readPadFlight(pad({ buttons: { 7: 0.6 } })).thrust).toBeCloseTo(0.6);
    expect(readPadFlight(pad({ buttons: { 6: 1 } })).thrust).toBe(-1);
    expect(readPadFlight(pad({ axes: { 1: -1 }, buttons: { 7: 1 } })).thrust).toBe(1);
  });
  it("maps the right stick to pitch, past half deflection", () => {
    expect(readPadFlight(pad({ axes: { 3: -0.9 } }))).toMatchObject({ ascend: true, descend: false });
    expect(readPadFlight(pad({ axes: { 3: 0.9 } }))).toMatchObject({ ascend: false, descend: true });
    expect(readPadFlight(pad({ axes: { 3: -0.3 } }))).toMatchObject({ ascend: false, descend: false });
  });
  it("maps RB to warp and A to scan", () => {
    expect(readPadFlight(pad({ buttons: { 5: 1 } })).boost).toBe(true);
    expect(readPadFlight(pad({ buttons: { 0: 1 } })).scan).toBe(true);
  });
  it("tolerates pads that report fewer axes and buttons", () => {
    expect(readPadFlight({ axes: [0.9], buttons: [] })).toEqual({ ...PAD_NEUTRAL, steer: deadzone(0.9) });
  });
});

describe("padFlightChanges", () => {
  // The pad shares flight.input with the keyboard and touch joystick. Writing
  // its whole state every frame would hold every channel at the pad's idle
  // value and cancel a held W or a touch drag.
  it("is empty when nothing changed, so an idle pad never overrides other inputs", () => {
    expect(padFlightChanges(PAD_NEUTRAL, PAD_NEUTRAL)).toEqual({});
  });
  it("reports only the channels the pad is driving", () => {
    const next = { ...PAD_NEUTRAL, steer: 0.4, boost: true };
    expect(padFlightChanges(PAD_NEUTRAL, next)).toEqual({ steer: 0.4, boost: true });
  });
  // Orbit lock, photo mode and Cmd-release all zero flight.input behind the
  // pad's back. A deflected stick must win it back on the next frame, not
  // wait for the stick to move to a different value.
  it("re-reports a held channel every frame, even when unchanged", () => {
    const held = { ...PAD_NEUTRAL, thrust: 1, scan: true };
    expect(padFlightChanges(held, held)).toEqual({ thrust: 1, scan: true });
  });
  it("reports the release back to neutral, so the pad lets go of what it held", () => {
    const held = { ...PAD_NEUTRAL, thrust: 1, ascend: true };
    expect(padFlightChanges(held, PAD_NEUTRAL)).toEqual({ thrust: 0, ascend: false });
  });
});

describe("padActions", () => {
  const press = (...idx: number[]) => Array.from({ length: 17 }, (_, i) => idx.includes(i));
  it("fires on the press edge only, not while held", () => {
    expect(padActions(press(), press(3))).toEqual([{ kind: "photo" }]);
    expect(padActions(press(3), press(3))).toEqual([]);
  });
  it("maps B to close", () => {
    expect(padActions(press(), press(1))).toEqual([{ kind: "close" }]);
  });
  it("maps the d-pad clockwise from up to the four jump targets", () => {
    expect(padActions(press(), press(12))).toEqual([{ kind: "jump", index: 0 }]);
    expect(padActions(press(), press(15))).toEqual([{ kind: "jump", index: 1 }]);
    expect(padActions(press(), press(13))).toEqual([{ kind: "jump", index: 2 }]);
    expect(padActions(press(), press(14))).toEqual([{ kind: "jump", index: 3 }]);
  });
});
