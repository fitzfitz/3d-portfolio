import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * backdrop-filter over a live WebGL canvas forces the compositor to
 * re-snapshot and re-blur the canvas region every single frame. The dossier
 * modal did this while animating its own scale and while scrolling, which is
 * what made every modal open lag.
 *
 * It is also invisible here: every overlay that used .glass-card also sets an
 * opaque bg-black/8x, so the blur had nothing to show through it.
 *
 * If a future design genuinely needs a blur, add the file to ALLOWLIST with a
 * comment explaining why the canvas is not behind it.
 */
const ALLOWLIST: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("no backdrop-filter over the live canvas", () => {
  it("finds no backdrop-filter or backdrop-blur outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.(css|tsx?|jsx?)$/.test(file)) continue;
      if (ALLOWLIST.includes(file)) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (/backdrop-filter|backdrop-blur/.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
