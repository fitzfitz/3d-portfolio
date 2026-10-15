import { describe, it, expect } from "vitest";
import { refuseLive, skyRequest, visitorKey } from "../beacon-api/src/liveRoute";

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

describe("skyRequest", () => {
  it("sets the visitor header the room trusts, overwriting anything the client sent", () => {
    const forged = upgrade({ "X-Sky-Visitor": "forged" });
    expect(skyRequest(forged, "real-key").headers.get("X-Sky-Visitor")).toBe("real-key");
  });
  it("strips a client-sent visitor header when there is no key", () => {
    const forged = upgrade({ "X-Sky-Visitor": "forged" });
    expect(skyRequest(forged, null).headers.has("X-Sky-Visitor")).toBe(false);
  });
  it("keeps the upgrade and country headers", () => {
    const r = skyRequest(upgrade({ "CF-IPCountry": "ID" }), "k");
    expect(r.headers.get("Upgrade")).toBe("websocket");
    expect(r.headers.get("CF-IPCountry")).toBe("ID");
  });
});

describe("visitorKey", () => {
  const SALT = "pepper-pepper-pepper-pepper";
  it("is the same for one pilot's /64 and differs between pilots", async () => {
    const a = await visitorKey("2001:db8:1:2::1", SALT);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await visitorKey("2001:db8:1:2::99", SALT)).toBe(a);
    expect(await visitorKey("198.51.100.4", SALT)).not.toBe(a);
  });
  it("is null without a usable salt, which turns the limit off rather than hashing weakly", async () => {
    expect(await visitorKey("198.51.100.4", "short")).toBeNull();
  });
});
