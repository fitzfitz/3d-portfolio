import { withPage, settle } from "./harness.mjs";

/**
 * Hostnames this probe deliberately lets reach the real network: the Vite
 * dev server itself (modules, GLBs, WebP textures, HMR). Everything else is
 * non-local and must never leave the machine, no matter what host
 * VITE_FORM_ENDPOINT names — see the request handler below for why we don't
 * try to predict that host at all.
 */
const isLocal = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

/**
 * Google Fonts is the one other non-local request this page legitimately
 * makes (index.html preconnects to fonts.googleapis.com/fonts.gstatic.com
 * and links a stylesheet from the former). Deliberately deny it rather than
 * allow it through: the probe never inspects rendered text metrics, so real
 * webfonts buy nothing, and it's one less network dependency for a suite
 * that's supposed to run offline-safe. See the "font" branch below for how
 * denial is implemented without generating console-error noise.
 */
const isFontHost = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "fonts.googleapis.com" || hostname === "fonts.gstatic.com";
  } catch {
    return false;
  }
};

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
    // Anything non-local that isn't recognized as font traffic or the form
    // submission's own preflight/POST. Should always stay empty — if it
    // doesn't, something the probe didn't anticipate tried to leave the
    // machine, and that needs to be visible rather than silently intercepted
    // away.
    const unexpectedNonLocal = [];
    // Direct, CDP-verified proof (not just trust in the code below) that no
    // non-local request actually reached the real network: a response
    // fulfilled locally via req.respond() never opens a real connection, so
    // Puppeteer reports an empty remoteAddress(). A non-empty one here means
    // something got past every branch below and hit the wire for real.
    const nonLocalNetworkHits = [];
    page.on("response", (res) => {
      const u = res.url();
      if (isLocal(u)) return;
      const remote = res.remoteAddress?.() ?? {};
      if (remote.ip) nonLocalNetworkHits.push(`${u} -> ${remote.ip}`);
    });

    page.on("request", (req) => {
      const url = req.url();

      if (isLocal(url)) {
        return req.continue();
      }

      // Fail closed: nothing non-local reaches the real network from here
      // on, regardless of which host it is. We deliberately do NOT match on
      // VITE_FORM_ENDPOINT's hostname — a probe that predicts the host can
      // silently stop mocking the instant .env's endpoint changes syntax or
      // value, letting a real submission (with the real access key) escape
      // to the network and mail the owner. Recognizing requests by *shape*
      // instead means no endpoint change can ever cause that.

      // CORS preflight for the real POST, whatever host it's aimed at.
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

      // The real form submission: a POST whose JSON body carries an
      // access_key (buildPayload always includes one, even if it's empty),
      // recognized by shape rather than destination.
      if (req.method() === "POST") {
        let body = null;
        try {
          body = JSON.parse(req.postData() ?? "{}");
        } catch {
          body = null;
        }
        if (body && typeof body.access_key === "string") {
          posted = body;
          return req.respond({
            status: 200,
            contentType: "application/json",
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ success: true, message: "Email sent successfully!" }),
          });
        }
      }

      if (isFontHost(url)) {
        // Deny, but don't req.abort() — an aborted resource load produces a
        // "Failed to load resource: net::ERR_FAILED" console.error (verified
        // during development of this probe: the same message appeared when
        // the relay POST was blocked before proper CORS headers were added),
        // and withPage()'s "no page errors" check would fail on it. An inert
        // 200 satisfies the <link rel="stylesheet"> without a real network
        // hit and without that noise.
        return req.respond({ status: 200, contentType: "text/css", body: "" });
      }

      // Genuinely unanticipated non-local request. Still never let it reach
      // the network, but record it — this is the "visible, not silent" case.
      unexpectedNonLocal.push(`${req.method()} ${url}`);
      return req.respond({ status: 200, contentType: "text/plain", body: "" });
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

    // Positive assertions of the fail-closed interception design, not just
    // configuration luck: nothing unrecognized tried to leave, and nothing
    // non-local actually touched the real network regardless.
    checks.check("no unexpected non-local request occurred", unexpectedNonLocal.length === 0,
      unexpectedNonLocal.join(", ").slice(0, 200));
    checks.check("no non-local request ever reached the real network",
      nonLocalNetworkHits.length === 0, nonLocalNetworkHits.join(", ").slice(0, 200));
  });
}
