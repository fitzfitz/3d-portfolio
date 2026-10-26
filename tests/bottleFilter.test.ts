import { describe, it, expect } from "vitest";
import { checkBottleText, bottleReasonMessage, BOTTLE_MAX_CHARS } from "../src/utils/bottleFilter";

const reason = (s: string) => {
  const r = checkBottleText(s);
  return r.ok ? "ok" : r.reason;
};

describe("normalisation", () => {
  it("trims and collapses whitespace", () => {
    expect(checkBottleText("  hello \n\t  world  ")).toEqual({ ok: true, text: "hello world" });
  });
  it("strips zero-width and control characters", () => {
    expect(checkBottleText("he​ll\u0007o th﻿ere")).toEqual({ ok: true, text: "hello there" });
  });
  it("applies NFKC", () => {
    expect(checkBottleText("ｈｅｌｌｏ")).toEqual({ ok: true, text: "hello" });
  });
  it("catches fullwidth-obfuscated contact details", () => {
    expect(reason("visit ｅｘａｍｐｌｅ．ｃｏｍ")).toBe("contact");
  });
});

describe("length", () => {
  it("rejects under 3 characters after normalising", () => {
    expect(reason("hi")).toBe("too_short");
    expect(reason("  a ​ ")).toBe("too_short");
    expect(reason("")).toBe("too_short");
  });
  it("accepts exactly 3 and exactly 140", () => {
    expect(reason("hey")).toBe("ok");
    expect(BOTTLE_MAX_CHARS).toBe(140);
    expect(reason("ab ".repeat(46) + "ab")).toBe("ok"); // 140
  });
  it("rejects over 140", () => {
    expect(reason("ab ".repeat(46) + "abc")).toBe("too_long");
  });
});

describe("contact details", () => {
  it.each([
    "see https://example.com/me",
    "http://foo.bar",
    "go to www.example",
    "my site is example.com",
    "try fitz.dev or foo.net",
    "kunjungi situs saya contoh.id",
    "find me at fitz.me",
    "fitz.me/about",
    "lihat contoh.co.id",
    "site: fitz.me",
    "fine.id", // accepted edge case: ends the note, so it reads as a domain
    "EXAMPLE.COM",
    "VISIT EXAMPLE.COM NOW",
    "+62-812-34-56-7890",
    "0812-34-56-7890",
    "0812.34.56.7890",
    "hxxp://example",
    "hxxps example",
    "example[.]com",
    "example(dot)com",
    "example dot com",
    "contoh dot id",
    "mail me a@b.com",
    "hubungi saya di nama.saya@gmail.com",
    "follow @fitzgeral",
    "ig: @some_user.name",
    "call 555-123-4567",
    "call +62 812 3456 7890",
    "wa 0812.3456.7890",
    "(555) 123 4567 now",
    "hubungi 081234567890",
  ])("rejects %s", (s) => expect(reason(s)).toBe("contact"));

  it("does not flag ordinary text with numbers or dots", () => {
    expect(reason("hello from 2026")).toBe("ok");
    expect(reason("I was here in 2026, aged 34. Wow.")).toBe("ok");
    expect(reason("Wait.Then I saw it")).toBe("ok");
    expect(reason("room 12 floor 3 seat 45")).toBe("ok");
    expect(reason("Mr. Smith says hi")).toBe("ok");
  });

  it("does not flag dates or spaced numbers", () => {
    expect(reason("Visited on 26-10-2026")).toBe("ok");
    expect(reason("Posted 2026.10.26 12:30")).toBe("ok");
    expect(reason("I scored 1 000 000 points")).toBe("ok");
  });

  it("does not flag a missing space after a full stop", () => {
    expect(reason("Nice.In my opinion")).toBe("ok");
    expect(reason("love it.My favorite")).toBe("ok");
    expect(reason("bagus.Id suka")).toBe("ok");
    expect(reason("ok.to be honest")).toBe("ok");
    // Sentence-case "Hello.Com" is a missing space; only lowercase-TLD or ALL-CAPS tokens are domains.
    expect(reason("Hello.Com on in")).toBe("ok");
    expect(reason("Nice.In my opinion again")).toBe("ok");
    expect(reason("love it.my favorite")).toBe("ok");
    expect(reason("thanks.me too")).toBe("ok");
    expect(reason("Hi.my name is")).toBe("ok");
    expect(reason("I like it.id is nice")).toBe("ok");
    expect(reason("so fun.co wow")).toBe("ok");
    expect(reason("I have 1 000 000 000 coins")).toBe("ok");
    expect(reason("Born 05-06-2026 10:30")).toBe("ok");
  });

  it("rejects over-long raw input before normalising", () => {
    expect(reason("a b ".repeat(300))).toBe("too_long");
  });
});

describe("profanity", () => {
  it.each([
    "what the fuck",
    "you are a SHIT",
    "such an asshole",
    "kamu anjing",
    "dasar bangsat",
    "ngentot lu",
    "dasar kontol",
    "goblok banget",
  ])("rejects %s", (s) => expect(reason(s)).toBe("profanity"));

  it("maps leetspeak", () => {
    expect(reason("sh1t happens")).toBe("profanity");
    expect(reason("what a fuck5")).toBe("profanity");
    expect(reason("$hit")).toBe("profanity");
    // Known gap: unmapped lookalikes such as "fvck" are not caught.
    expect(reason("a$$hole")).toBe("profanity");
    expect(reason("b4ngs4t kamu")).toBe("profanity");
    expect(reason("4nj1ng")).toBe("profanity");
    expect(reason("b1tch please")).toBe("profanity");
  });

  it("matches across punctuation boundaries", () => {
    expect(reason("well, shit!")).toBe("profanity");
  });

  it("allows words removed from the list", () => {
    expect(reason("I do tai chi")).toBe("ok");
    expect(reason("my Maine coon cat")).toBe("ok");
    expect(reason("summa cum laude")).toBe("ok");
    expect(reason("sakit pantat")).toBe("ok");
    expect(reason("kamu bodoh")).toBe("profanity");
  });

  it("does not flag substrings of longer words", () => {
    expect(reason("Greetings from Scunthorpe")).toBe("ok");
    expect(reason("what a class act")).toBe("ok");
    expect(reason("assess the situation")).toBe("ok");
    expect(reason("hello from Sussex")).toBe("ok");
    expect(reason("Penistone is lovely")).toBe("ok");
    expect(reason("a classic assassin")).toBe("ok");
    expect(reason("bassist and cocktail")).toBe("ok");
    expect(reason("anjingku lucu")).toBe("ok"); // not a whole word
  });
});

describe("junk", () => {
  it("rejects 6+ repeats of one character", () => {
    expect(reason("hellooooooo there")).toBe("junk");
    expect(reason("aaaaaa")).toBe("junk");
    expect(reason("wooooow")).toBe("ok"); // 5 o's
    expect(reason("!!!!!!! hi there")).toBe("junk");
  });
  it("rejects more than 50% non-letters", () => {
    expect(reason("a1 2b 3c 4d 5e 6")).toBe("junk");
    expect(reason("hi ??!! ##")).toBe("junk");
  });
  it("accepts exactly 50% or fewer non-letters", () => {
    expect(reason("hello from 2026")).toBe("ok");
    expect(reason("ab12")).toBe("ok");
  });
  it("rejects all caps longer than 20 characters", () => {
    expect(reason("THIS IS A VERY LOUD MESSAGE")).toBe("junk");
    expect(reason("LOUD MESSAGE")).toBe("ok");
    expect(reason("HELLO FROM MY LITTLE SHIP")).toBe("junk");
    expect(reason("Hello From My Little Ship")).toBe("ok");
  });
  it("does not treat short emoji notes as junk", () => {
    expect(reason("🙂🙂🙂")).toBe("ok");
    expect(reason("❤️🚀✨")).toBe("ok");
    expect(reason("hi 👋🌍")).toBe("ok");
  });
});

describe("rule order and messages", () => {
  it("returns the first failing rule", () => {
    expect(reason("hi")).toBe("too_short");
    expect(reason("fuck example.com")).toBe("contact");
  });
  it("returns normalised text on success", () => {
    expect(checkBottleText("  Hello   from  Jakarta ")).toEqual({ ok: true, text: "Hello from Jakarta" });
  });
  it("has friendly copy for every reason", () => {
    expect(bottleReasonMessage("contact")).toBe("Links and contact details can't be posted.");
    expect(bottleReasonMessage("profanity")).toBe("Please keep it friendly.");
    expect(bottleReasonMessage("too_short")).toBe("Too short.");
    for (const r of ["too_long", "junk"] as const) expect(bottleReasonMessage(r).length).toBeGreaterThan(3);
  });
});
