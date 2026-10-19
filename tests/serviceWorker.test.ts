import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

/** public/sw.js is a classic worker script: run it against a stub `self` and read its helpers. */
function loadWorker() {
  const ctx = createContext({
    self: { addEventListener: () => {}, location: { origin: "http://site.test" }, registration: { scope: "http://site.test/3d-portfolio/" } },
    URL,
  });
  runInContext(readFileSync("public/sw.js", "utf8"), ctx);
  return ctx as unknown as { staleAssetUrls: (cached: string[], build: string[], scope: string) => string[] };
}

const SCOPE = "http://site.test/3d-portfolio/";
const at = (p: string) => SCOPE + p;

describe("service worker pruning", () => {
  it("keeps every build file, loaded or not", () => {
    // A ?cv visit never loads the GlobalCanvas chunk; pruning by what the page
    // loaded would delete it and break flying offline later.
    const { staleAssetUrls } = loadWorker();
    expect(staleAssetUrls([at("assets/index-B.js")], ["assets/GlobalCanvas-A.js", "assets/index-B.js"], SCOPE)).toEqual([]);
  });

  it("drops assets from older builds", () => {
    const { staleAssetUrls } = loadWorker();
    expect(staleAssetUrls([at("assets/index-OLD.js"), at("assets/index-B.js")], ["assets/index-B.js"], SCOPE))
      .toEqual([at("assets/index-OLD.js")]);
  });

  it("never touches non-asset URLs", () => {
    const { staleAssetUrls } = loadWorker();
    expect(staleAssetUrls([SCOPE, at("favicon.svg"), at("?cv")], ["assets/index-B.js"], SCOPE)).toEqual([]);
  });
});
