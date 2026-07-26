import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { withPage, settle } from "./harness.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Reads VITE_FORM_ENDPOINT straight out of .env (never VITE_FORM_KEY — that
 * stays untouched here) so the interception hostname below tracks whatever
 * Contact.tsx would actually POST to, instead of a literal that can silently
 * drift out of sync. If .env is missing the var (or the file itself), fall
 * back to the same default Contact.tsx uses. Never read the access key.
 */
function relayEndpointFromEnv() {
  const fallback = "https://api.web3forms.com/submit";
  try {
    const raw = readFileSync(path.join(repoRoot, ".env"), "utf8");
    const match = raw.match(/^VITE_FORM_ENDPOINT=(.*)$/m);
    const value = match?.[1]?.trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

// If VITE_FORM_ENDPOINT in .env ever points somewhere other than this host,
// interception below still matches it correctly — the mock never silently
// stops working and the probe never risks hitting (and mailing) the real
// service. See relayEndpointFromEnv() above.
const RELAY_HOST = new URL(relayEndpointFromEnv()).hostname;

const fill = async (page) => {
  await page.type('input[name="name"]', "Ada");
  await page.type('input[name="email"]', "ada@lovelace.dev");
  await page.type('textarea[name="message"]', "First contact");
};

const openClassicContact = async (page) => {
  await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(true));
  await settle(page, 1200);
  await page.evaluate(() => {
    document.querySelector('a[href="#contact"]')?.scrollIntoView();
  });
  await settle(page, 800);
};

export default async function run() {
  return withPage({ label: "contact" }, async (page, checks) => {
    await page.setRequestInterception(true);
    let posted = null;
    page.on("request", (req) => {
      if (req.url().includes(RELAY_HOST)) {
        // application/json makes this a non-simple request, so the browser
        // fires a CORS preflight (OPTIONS) before the real POST. Without
        // Access-Control-Allow-* on both legs, Chrome blocks the POST outright
        // and it never reaches this handler with a body.
        if (req.method() === "OPTIONS") {
          return req.respond({
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Accept",
            },
          });
        }
        posted = JSON.parse(req.postData() ?? "{}");
        return req.respond({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ success: true, message: "Email sent successfully!" }),
        });
      }
      req.continue();
    });

    await openClassicContact(page);
    const form = await page.$('textarea[name="message"]');
    checks.check("contact form renders when a key is configured", !!form,
      form ? "" : "no textarea — is VITE_FORM_KEY set in .env?");
    if (!form) return;

    await fill(page);
    await page.click('button[type="submit"]');

    // Contact.tsx holds the terminal on its final status line for ~600ms
    // before flipping to the success screen (React batches the log update
    // with the state flip, so without that beat the line is never painted).
    // Poll with short interleaved reads rather than one blind settle — a
    // single wait past 600ms would land after the view already transitioned
    // and the log div had been unmounted. See harness.mjs's note on why
    // physics/transient-state checks need interleaved page.evaluate() reads.
    let logs = "";
    for (let i = 0; i < 15; i++) {
      logs = await page.evaluate(() =>
        [...document.querySelectorAll("div")].map((d) => d.textContent ?? "")
          .filter((t) => t.startsWith("[system] >")).join("\n"));
      if (/relay ack \d/.test(logs)) break;
      await settle(page, 150);
    }

    checks.check("submitting POSTs to the relay", posted !== null);
    // Detail strings land in stdout, so never surface the real access_key —
    // redact it before it can be printed, even though Web3Forms keys are
    // public-by-design (send-only, scoped to one inbox).
    const redacted = posted ? { ...posted, access_key: posted.access_key ? "<redacted>" : posted.access_key } : posted;
    checks.check("payload carries the honeypot and access key",
      posted?.botcheck === "" && typeof posted?.access_key === "string",
      JSON.stringify(redacted)?.slice(0, 120));
    checks.check("payload carries the typed message", posted?.message === "First contact");

    checks.check("terminal never claims PGP encryption", !/PGP/i.test(logs), logs.slice(0, 200));
    checks.check("terminal reports the real relay status", /relay ack 200/.test(logs),
      logs.slice(0, 200));

    await settle(page, 1500); // let the success transition finish
    const success = await page.evaluate(() => document.body.innerText);
    // Absence alone proves nothing — a regression stuck on the terminal view,
    // or a blank page, would also pass "does not claim encryption". Pair it
    // with a positive assertion that the honest success copy actually
    // rendered, so the two together mean something.
    checks.check("success copy actually renders",
      /reached the relay/i.test(success), success.slice(0, 200));
    checks.check("success copy does not claim encryption",
      !/has been encrypted/i.test(success));
  });
}
