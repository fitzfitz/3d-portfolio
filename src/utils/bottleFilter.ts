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

const TLDS =
  "com|net|org|io|dev|co|id|my|app|xyz|info|me|ly|gg|tv|to|us|uk|de|ai|biz|edu|gov|site|online|shop|link|ws|cc|sg|au|in|jp";

const URL_RE = /(?:https?:\/\/|ftp:\/\/|www\.)\S*/i;
const DOMAIN_RE = new RegExp(`\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b`, "i");
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const HANDLE_RE = /(?:^|[^\w])@[\w.]{2,}/;
// 7+ digits with optional separators between them.
const PHONE_RE = /\+?\d(?:[\s().-]*\d){6,}/;

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
  return URL_RE.test(text) || EMAIL_RE.test(text) || HANDLE_RE.test(text) || DOMAIN_RE.test(text) || PHONE_RE.test(text);
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
  for (const ch of text) {
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
  const text = normalise(typeof raw === "string" ? raw : "");
  const len = Array.from(text).length;
  if (len < BOTTLE_MIN_CHARS) return { ok: false, reason: "too_short" };
  if (len > BOTTLE_MAX_CHARS) return { ok: false, reason: "too_long" };
  if (hasContact(text)) return { ok: false, reason: "contact" };
  if (hasProfanity(text)) return { ok: false, reason: "profanity" };
  if (isJunk(text)) return { ok: false, reason: "junk" };
  return { ok: true, text };
}
