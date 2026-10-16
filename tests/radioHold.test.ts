import { describe, it, expect } from "vitest";
import { BROADCAST_HOLD_MS, flavourAllowed, holdUntil } from "../src/utils/radioHold";

describe("radio broadcast hold", () => {
  it("holds a content broadcast for 8 seconds", () => {
    expect(BROADCAST_HOLD_MS).toBe(8000);
    expect(holdUntil(1000, { silent: false })).toBe(9000);
  });

  it("does not start a hold for a silent broadcast, and clears any earlier one", () => {
    expect(holdUntil(1000, { silent: true })).toBe(0);
    expect(flavourAllowed(1001, holdUntil(1000, { silent: true }))).toBe(true);
  });

  it("blocks flavour lines until the hold ends, then allows them", () => {
    const until = holdUntil(1000, { silent: false });
    expect(flavourAllowed(1000, until)).toBe(false);
    expect(flavourAllowed(8999, until)).toBe(false);
    expect(flavourAllowed(9000, until)).toBe(true);
    expect(flavourAllowed(20000, until)).toBe(true);
  });

  it("allows flavour when no hold was ever set", () => {
    expect(flavourAllowed(0, 0)).toBe(true);
    expect(flavourAllowed(500, 0)).toBe(true);
  });
});
