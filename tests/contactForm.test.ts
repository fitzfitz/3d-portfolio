import { describe, it, expect } from "vitest";
import { buildPayload, buildMailto, classifyResponse } from "../src/utils/contactForm";

const fields = { name: "Ada", email: "ada@lovelace.dev", message: "First contact" };

describe("buildPayload", () => {
  it("includes the access key and the Web3Forms field names", () => {
    const p = buildPayload(fields, "KEY-123");
    expect(p.access_key).toBe("KEY-123");
    expect(p.name).toBe("Ada");
    expect(p.email).toBe("ada@lovelace.dev");
    expect(p.message).toBe("First contact");
    expect(p.from_name).toBe("Ada");
    expect(p.subject).toContain("Ada");
  });

  it("sends an empty honeypot so real submissions are not flagged", () => {
    expect(buildPayload(fields, "K").botcheck).toBe("");
  });
});

describe("buildMailto", () => {
  it("preserves the typed message so a failed send loses nothing", () => {
    const url = buildMailto(fields, "me@domain.dev");
    expect(url.startsWith("mailto:me@domain.dev?")).toBe(true);
    const q = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(q.get("body")).toContain("First contact");
    expect(q.get("body")).toContain("ada@lovelace.dev");
    expect(q.get("subject")).toContain("Ada");
  });

  it("encodes characters that would break a URL", () => {
    const url = buildMailto({ ...fields, message: "a&b=c d" }, "me@domain.dev");
    expect(url).not.toContain("a&b=c d");
    const q = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(q.get("body")).toContain("a&b=c d");
  });
});

describe("classifyResponse", () => {
  it("treats ok + success!==false as ok", () => {
    expect(classifyResponse({ ok: true, status: 200 }, { success: true })).toBe("ok");
    expect(classifyResponse({ ok: true, status: 200 }, { message: "Sent" })).toBe("ok");
  });

  it("treats an ok response carrying success:false as rejected", () => {
    expect(classifyResponse({ ok: true, status: 200 }, { success: false })).toBe("rejected");
  });

  it("treats 4xx as rejected and 5xx as unreachable", () => {
    expect(classifyResponse({ ok: false, status: 422 }, { message: "bad key" })).toBe("rejected");
    expect(classifyResponse({ ok: false, status: 503 }, {})).toBe("unreachable");
  });
});
