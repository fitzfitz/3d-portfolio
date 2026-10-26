import { describe, it, expect } from "vitest";
import { activeBottle, BOTTLE_CARD_R, BOTTLE_CARD_EXIT_R } from "../src/utils/bottleCard";
import type { Bottle } from "../src/utils/beacons";

const bottle = (id: string, x: number): Bottle => ({ id, x, y: 0, z: 0, text: `note ${id}`, at: 0, country: null });
const ship = (x: number) => ({ x, y: 0, z: 0 });

describe("activeBottle (the read card)", () => {
  const a = bottle("a", 0), b = bottle("b", 12);
  const list = [a, b];

  it("opens within about 8 u and not beyond", () => {
    expect(BOTTLE_CARD_R).toBe(8);
    expect(activeBottle(ship(7.9), [a], null, null, 0)).toBe(a);
    expect(activeBottle(ship(8.1), [a], null, null, 0)).toBeNull();
  });
  it("shows the nearest of several bottles close by", () => {
    expect(activeBottle(ship(5), list, null, null, 0)).toBe(a);
    expect(activeBottle(ship(7), list, null, null, 0)).toBe(b);
    // Even over a card already up for the other one.
    expect(activeBottle(ship(7), list, a, null, 0)).toBe(b);
  });
  it("holds a card up to the exit radius so the edge cannot flicker, then closes it", () => {
    expect(activeBottle(ship(9), [a], a, null, 0)).toBe(a);
    expect(activeBottle(ship(BOTTLE_CARD_EXIT_R + 0.1), [a], a, null, 0)).toBeNull();
  });
  it("holds a scanned bottle's card until the hold runs out", () => {
    const scan = { bottle: b, until: 10 };
    expect(activeBottle(ship(-20), list, null, scan, 9)).toBe(b);
    expect(activeBottle(ship(-20), list, null, scan, 10)).toBeNull();
  });
  it("closes the card of a bottle that left the sky", () => {
    expect(activeBottle(ship(1), [b], a, { bottle: a, until: 99 }, 0)).toBeNull();
  });
});
