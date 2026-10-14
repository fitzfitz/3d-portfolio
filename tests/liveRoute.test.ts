import { describe, it, expect } from "vitest";
import { refuseLive } from "../beacon-api/src/liveRoute";

const ORIGIN = "https://fitzfitz.github.io";
const deps = { allowedOrigins: [ORIGIN] };
function upgrade(headers: Record<string, string> = {}, method = "GET") {
  return new Request("https://api.example/live", {
    method,
    headers: { Upgrade: "websocket", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.7", ...headers },
  });
}

describe("refuseLive", () => {
  it("passes a websocket upgrade from the site", async () => {
    expect(await refuseLive(upgrade(), deps)).toBeNull();
  });
  it("426s anything that is not a websocket GET", async () => {
    expect((await refuseLive(upgrade({ Upgrade: "h2c" }), deps))!.status).toBe(426);
    expect((await refuseLive(upgrade({}, "POST"), deps))!.status).toBe(426);
  });
  it("403s another site, and a missing Origin", async () => {
    expect((await refuseLive(upgrade({ Origin: "https://evil.example" }), deps))!.status).toBe(403);
    const bare = new Request("https://api.example/live", { headers: { Upgrade: "websocket" } });
    expect((await refuseLive(bare, deps))!.status).toBe(403);
  });
  it("spends the pilot's request budget, keyed like beacons", async () => {
    const keys: string[] = [];
    const limiter = { async limit({ key }: { key: string }) { keys.push(key); return { success: keys.length < 2 }; } };
    expect(await refuseLive(upgrade({ "CF-Connecting-IP": "2001:db8:1:2::1" }), { ...deps, limiter })).toBeNull();
    const second = await refuseLive(upgrade({ "CF-Connecting-IP": "2001:db8:1:2::99" }), { ...deps, limiter });
    expect(second!.status).toBe(429);
    expect(keys).toEqual(["2001:0db8:0001:0002", "2001:0db8:0001:0002"]);
  });
});
