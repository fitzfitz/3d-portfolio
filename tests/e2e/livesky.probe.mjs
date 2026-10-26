import {
  withPage, settle, lockFullFidelity, readStore, sceneQuery, pollUntil, chatterText, toDeepSpace, hold,
  SCENE_READY_TIMEOUT_MS, installFakeSky,
} from "./harness.mjs";

const inPage = (page, fn, arg) => page.evaluate(fn, arg);

export default async function run() {
  return withPage({ label: "livesky" }, async (page, checks) => {
    const absent = await sceneQuery(page, "LiveGhost_0");
    checks.check("without a live sky URL the scene has no ghosts", !absent.found);

    // Full fidelity from the start, as on a real GPU (see lockFullFidelity).
    await page.evaluateOnNewDocument(lockFullFidelity);
    await page.evaluateOnNewDocument(installFakeSky);
    await page.evaluate(() => {
      localStorage.setItem("fitz-live-sky-dev", "fake://sky");
      localStorage.removeItem("fitz-live-seen-2");
      localStorage.removeItem("fitz-live-sky");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__fitz?.store?.getState().sceneReady, { timeout: SCENE_READY_TIMEOUT_MS });
    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(false, true));
    await settle(page, 2000);

    const slot = await sceneQuery(page, "LiveGhost_0");
    checks.check("with a live sky URL the ghost slots mount hidden", slot.found && !slot.visible, JSON.stringify(slot));
    const created0 = await inPage(page, () => window.__fakeSky.created);
    checks.check("nothing connects before the ship has flown", created0 === 0, `created=${created0}`);

    // Leaving the spawn pad counts as flying; deep space has nothing else to scan.
    await toDeepSpace(page);
    const notice = await pollUntil(async () => (await chatterText(page)).includes("LIVE SKY"), { timeoutMs: 20_000 });
    checks.check("the first flight plays the live sky notice", notice.ok);
    const connected = await pollUntil(() => inPage(page, () => window.__fakeSky.open() === 1), { timeoutMs: 5000 });
    checks.check("then it connects", connected.ok);
    const seen = await pollUntil(async () => (await readStore(page)).liveSkySeen === true, { timeoutMs: 5000 });
    checks.check("the notice is remembered once shown", seen.ok);

    await inPage(page, () => window.__fakeSky.serve({ t: "hello", id: "me1", peers: 0 }));
    await hold(page, ["KeyW"], 800);
    const aloneSent = await inPage(page, () => window.__fakeSky.sent.length);
    checks.check("alone, the client sends nothing", aloneSent === 0, `sent=${aloneSent}`);
    await settle(page, 3000); // coast to a stop

    const programKeys = () => inPage(page, () => window.__fitz.gl.info.programs.map((p) => `${p.name}|${p.cacheKey}`));
    const keysBefore = await programKeys();
    const programsBefore = keysBefore.length;
    const ship = await inPage(page, () => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
    const snap = (dx) => ({ t: "snap", ships: [
      { id: "g1", p: [ship.x + 6 + dx, ship.y, ship.z], q: [0, 0, 0, 1], plume: "ring", cc: "ID" },
      { id: "g2", p: [ship.x - 16, ship.y, ship.z + dx], q: [0, 0, 0, 1], plume: "stock", cc: null },
    ] });
    await inPage(page, (s) => { window.__fakeSky.serve({ t: "peers", n: 2 }); window.__fakeSky.serve(s); }, snap(0));
    const visible = await pollUntil(async () => (await sceneQuery(page, "LiveGhost_0")).visible, { timeoutMs: 5000 });
    checks.check("ghosts appear for pilots in the room", visible.ok);
    const radar = await inPage(page, () => ({ count: window.__fitz.liveRadar.count, hexes: window.__fitz.liveRadar.blips.slice(0, window.__fitz.liveRadar.count).map((b) => b.hex) }));
    checks.check("every pilot in the room is on the radar", radar.count === 2 && radar.hexes.includes("#ff3df0"),
      JSON.stringify(radar));
    const sent = await inPage(page, () => window.__fakeSky.sent);
    checks.check("with company, the client shares its pose once", sent.length >= 1 && sent[0].t === "me" && sent[0].plume === "stock",
      JSON.stringify(sent[0]));

    // Smoothness: record the nearest ghost's offset from the ship every frame
    // while a moved snapshot arrives; it should glide, not teleport.
    const xs = await inPage(page, async (next) => {
      const g = () => window.__fitz.scene.getObjectByName("LiveGhost_0");
      const out = [];
      const t0 = performance.now();
      setTimeout(() => window.__fakeSky.serve(next), 100);
      await new Promise((done) => {
        const step = () => {
          out.push(g().position.x); // world x: slots sit at the ghost's own (wrapped) position
          if (performance.now() - t0 < 1200) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      });
      return out;
    }, snap(1.2));
    const x0 = xs[0], x1 = xs.at(-1);
    const between = xs.some((v) => v > x0 + 0.15 && v < x1 - 0.15);
    checks.check("a ghost glides between snapshots", x1 - x0 > 1 && between,
      `from=${x0?.toFixed(2)} to=${x1?.toFixed(2)} frames=${xs.length} xs=${xs.map((v) => v.toFixed(2)).join(",")}`);

    await settle(page, 1000);
    const programsAfter = await inPage(page, () => window.__fitz.gl.info.programs.length);
    // ShaderWarmup compiles hidden objects for the render target the scene
    // actually draws into, so ghosts appearing must not compile anything.
    const added = (await programKeys()).filter((k) => !keysBefore.includes(k));
    checks.check("ghosts add no shader program", programsAfter === programsBefore,
      `before=${programsBefore} after=${programsAfter} added=${JSON.stringify(added)}`);

    const target = await pollUntil(async () => (await readStore(page)).scanTarget !== null, { timeoutMs: 3000 });
    checks.check("a ghost is a scan target", target.ok);
    await hold(page, ["KeyE"], 2600); // scan takes 1.6s
    const after = await readStore(page);
    checks.check("scanning a ghost names its pilot's country", after.broadcast?.text === "PILOT FROM ID · LIVE",
      `broadcast=${after.broadcast?.text}`);
    checks.check("a ghost scan earns no badge", !after.badges.some((b) => b.id === "comet"));

    // --- C2: the cartographer in the live sky ---
    // This pilot charts all nine bodies (in memory only: setState skips the
    // store's persistence) with the shout-out due, and flies AURUM. The pose
    // carries ch 9 (CHART_TOTAL).
    await inPage(page, () => {
      const st = window.__fitz.store;
      const at = new Date().toISOString().slice(0, 10);
      const ids = ["mercury", "venus", "earth", "mars", "ceres", "jupiter", "saturn", "uranus", "neptune"];
      st.setState({ charted: ids.map((id) => ({ id, at })), chartShoutAt: Date.now() });
      st.getState().setPlumeColor("cartographer");
    });
    await hold(page, ["KeyW"], 1500); // moving keeps poses going out after the first
    const c2 = await inPage(page, () => window.__fakeSky.sent);
    const pose = c2.filter((m) => m.t === "me" && m.ch === 9).at(-1);
    checks.check("a cartographer's pose carries ch 9 and the AURUM plume", pose?.plume === "cartographer",
      JSON.stringify(pose));
    const claims = c2.filter((m) => m.t === "charted").length;
    const cleared = (await readStore(page)).chartShoutAt === null;
    checks.check("the shout-out is sent once", claims === 1 && cleared, `claims=${claims} cleared=${cleared}`);
    await settle(page, 2000);

    await inPage(page, () => window.__fakeSky.serve({ t: "charted", cc: "ID" }));
    const shout = await pollUntil(async () => (await chatterText(page)).includes("A PILOT FROM ID HAS CHARTED EVERY WORLD"), { timeoutMs: 15_000 });
    checks.check("a shout-out from the room plays on the radio", shout.ok);

    const ship2 = await inPage(page, () => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
    await inPage(page, (s) => window.__fakeSky.serve({ t: "snap", ships: [
      { id: "g1", p: [s.x + 6, s.y, s.z], q: [0, 0, 0, 1], plume: "cartographer", cc: "ID", ch: 9 },
    ] }), ship2);
    await settle(page, 1500);
    await hold(page, ["KeyE"], 2600);
    const scanned = await pollUntil(async () => (await readStore(page)).broadcast?.text === "CARTOGRAPHER · ID", { timeoutMs: 3000 });
    checks.check("a charted ghost scans as CARTOGRAPHER · ID", scanned.ok, `broadcast=${(await readStore(page)).broadcast?.text}`);

    await page.evaluate(() => window.__fitz.store.getState().setLogbookOpen(true));
    await page.click('[data-testid="livesky-toggle"]');
    const off = await page.$eval('[data-testid="livesky-toggle"]', (el) => el.getAttribute("aria-checked"));
    checks.check("the logbook switch turns live sky off", off === "false", `aria-checked=${off}`);
    const gone = await pollUntil(async () => !(await sceneQuery(page, "LiveGhost_0")).visible, { timeoutMs: 3000 });
    checks.check("turning it off hides the ghosts", gone.ok);
    const radarOff = await inPage(page, () => window.__fitz.liveRadar.count);
    checks.check("turning it off clears the radar", radarOff === 0, `count=${radarOff}`);
    const open = await inPage(page, () => window.__fakeSky.open());
    checks.check("turning it off closes the socket", open === 0, `open=${open}`);
    await settle(page, 800);
    const s2 = await readStore(page);
    checks.check("turning it off removes the ghost scan target", s2.scanTarget === null, `scanTarget=${s2.scanTarget}`);

    await page.evaluate(() => {
      localStorage.removeItem("fitz-live-sky-dev");
      localStorage.removeItem("fitz-live-sky");
      localStorage.removeItem("fitz-live-seen-2");
      localStorage.removeItem("fitz-plume");
      localStorage.removeItem("fitz-charted-shout");
    });
  });
}
