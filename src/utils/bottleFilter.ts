// Message-in-a-bottle text filter. Pure TypeScript (no DOM, no Node APIs) so the
// client and beacon-api share one implementation. The Worker is the authority;
// the client runs the same function for instant feedback.
import { BOTTLE_PROFANITY } from "../data/bottleFilter";

export const BOTTLE_MIN_CHARS = 3;
export const BOTTLE_MAX_CHARS = 140;

export type BottleRejectReason = "too_short" | "too_long" | "contact" | "profanity" | "junk";

export type BottleCheck =
  | { ok: true; text: string }
  | { ok: false; reason: BottleRejectReason };

const MESSAGES: Record<BottleRejectReason, string> = {
  too_short: "Too short.",
  too_long: `Too long. Keep it under ${BOTTLE_MAX_CHARS} characters.`,
  contact: "Links and contact details can't be posted.",
  profanity: "Please keep it friendly.",
  junk: "That doesn't look like a message. Try a few real words.",
};

export function bottleReasonMessage(reason: BottleRejectReason): string {
  return MESSAGES[reason];
}

// Only unambiguous TLDs: word-like ones (in, to, me, my, us, id, co, de, cc...) would hit
// "Nice.In my opinion". Links using them are still caught by http(s)/www./email.
const TLDS =
  "com|net|org|io|dev|app|xyz|info|ly|gg|tv|ai|biz|edu|gov|site|online|shop|link|ws|sg|au|jp|uk";

const URL_RE = /(?:https?:\/\/|ftp:\/\/|www\.|hxxps?)\S*/i;
// TLD must be lowercase in the original text (so "Hello.Com" after a typo is not a domain).
const DOMAIN_RE = new RegExp(`\\b[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*\\.(?:${TLDS})\\b`);
const OBFUSCATED_RE = /\[\.\]|\(dot\)|\bdot (?:com|net|org|io|id|co)\b/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const HANDLE_RE = /(?:^|[^\w])@[\w.]{2,}/;
// Date shapes (dd-mm-yyyy, yyyy.mm.dd, optionally with a time) are not phone numbers.
const DATE_RE = /(?<!\d)\d{1,4}[-./]\d{1,2}[-./]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?(?!\d)/g;
// Plausible phone: leading +, or leading 0 with 9+ digits, or 10+ digits (separators allowed).
const PHONE_RES = [
  /\+\d(?:[\s().-]*\d){6,}/,
  /(?<!\d)0(?:[\s().-]*\d){8,}/,
  /\d(?:[\s().-]*\d){9,}/,
];

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "$": "s", "@": "a",
};

function normalise(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\t\n\v\f\r]+/g, " ") // line breaks and tabs become spaces before control chars go
    .replace(/[\p{Cc}\p{Cf}]/gu, "") // control + format (zero-width, BOM, soft hyphen, ZWJ...)
    .replace(/\s+/g, " ")
    .trim();
}

function hasContact(text: string): boolean {
  const noDates = text.replace(DATE_RE, " ");
  return (
    URL_RE.test(text) || EMAIL_RE.test(text) || HANDLE_RE.test(text) || DOMAIN_RE.test(text) ||
    OBFUSCATED_RE.test(text) || PHONE_RES.some((re) => re.test(noDates))
  );
}

function hasProfanity(text: string): boolean {
  const mapped = text.toLowerCase().replace(/[01345$@]/g, (c) => LEET[c]);
  for (const word of mapped.split(/[^a-z]+/)) {
    if (word && BOTTLE_PROFANITY.has(word)) return true;
  }
  return false;
}

function isJunk(text: string): boolean {
  if (/(.)\1{5,}/su.test(text)) return true;
  let letters = 0;
  let nonLetters = 0;
  for (const ch of text.replace(DATE_RE, " ")) { // dates are normal content, not noise
    if (/\s/.test(ch)) continue;
    if (/\p{L}/u.test(ch)) letters++;
    else if (!/\p{Extended_Pictographic}/u.test(ch) && ch !== "️") nonLetters++;
  }
  // Emoji count neither way, so a short emoji note is fine.
  if (nonLetters > 0 && nonLetters > (letters + nonLetters) / 2) return true;
  if (Array.from(text).length > 20 && text === text.toUpperCase() && text !== text.toLowerCase()) return true;
  return false;
}

export function checkBottleText(raw: string): BottleCheck {
  if (typeof raw === "string" && raw.length > 1000) return { ok: false, reason: "too_long" };
  const text = normalise(typeof raw === "string" ? raw : "");
  const len = Array.from(text).length;
  if (len < BOTTLE_MIN_CHARS) return { ok: false, reason: "too_short" };
  if (len > BOTTLE_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (hasContact(text)) return { ok: false, reason: "contact" };
  if (hasProfanity(text)) return { ok: false, reason: "profanity" };
  if (isJunk(text)) return { ok: false, reason: "junk" };
  return { ok: true, text };
}
