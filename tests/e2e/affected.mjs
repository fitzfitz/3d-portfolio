// Runs only the e2e probes a change touches: `npm run test:e2e:affected`
// (against main), or `node tests/e2e/affected.mjs --base <ref> [--dry-run]`
// (--dry-run prints the selection and runs nothing). For everyday
// work; the full suite still runs before a merge. Changed files are the
// branch's commits since it left the base plus anything uncommitted.
//
// Safe by default: a file no rule covers runs the full suite, as does any
// change to the harness, the app's shell (App, main, store) or shared utils.
// Files outside the app and its e2e tests (docs, unit tests, scripts that
// build nothing shipped) run nothing.
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ALL } from "./probeList.mjs";

/** Probes that hold the scene's budgets: any change to what the canvas draws runs them. */
const BUDGETS = ["smoke", "programs", "memory", "perf", "transition"];

/** [pattern, probes]; the first rule that matches a file decides it. "ALL" means the full suite. */
export const RULES = [
  // The test machinery itself.
  [/^tests\/e2e\/([a-z]+)\.probe\.mjs$/, (m) => [m[1]]],
  [/^tests\/e2e\/gpuLedger\.mjs$/, () => ["memory"]],
  [/^tests\/e2e\//, () => "ALL"],
  // Canvas, by what each probe flies through.
  [/^src\/components\/canvas\/(CargoTraffic|EngineWake|wakeGeometry|Comets|WorldEventDirector)\b/, () => [...BUDGETS, "events", "reactions"]],
  [/^src\/components\/canvas\/(SolarBodies|SolarMoons|Sun|Atmosphere|atmosphereMaterial|CloudLayer|bodyRings|sunShadow|sunMaterials|nightGlow|oceanGloss|hueToe|toksvig|BodyDots)\b/, () => [...BUDGETS, "sky", "mechanics", "assets"]],
  [/^src\/components\/canvas\/(Spaceship|TractorBeam|enginePlume|WarpTunnel|ShootingStars)\b/, () => [...BUDGETS, "flight", "gameplay", "fuel", "mechanics", "gamepad", "touch"]],
  [/^src\/components\/canvas\/ProjectProbes\b/, () => [...BUDGETS, "probes"]],
  [/^src\/components\/canvas\/(CareerStation|CareerTrail|guideLine)\b/, () => [...BUDGETS, "career", "careerphone"]],
  [/^src\/components\/canvas\/(Shipyard|DormantGate|PortalRing|SpacePlanets)\b/, () => [...BUDGETS, "shipyard", "contact"]],
  [/^src\/components\/canvas\/(AsteroidBelt|Asteroids)\b/, () => [...BUDGETS, "mechanics", "gameplay"]],
  [/^src\/components\/canvas\/(PlasmaAnomalies|DataShards|Scanner)\b/, () => [...BUDGETS, "fuel", "gameplay"]],
  [/^src\/components\/canvas\/SpaceJellyfish\b/, () => [...BUDGETS, "reactions", "jellyguide"]],
  // The guide's pure logic (the creature's frame, posture and radio gate); waypointTarget also feeds the HUD, so it stays with ALL.
  [/^src\/(utils\/(jellyGuide|jellyFrame|jellyMood|jellyPosture|guideRadio|guideToggle)|data\/jellyfishPath)\b/, () => [...BUDGETS, "reactions", "jellyguide"]],
  [/^src\/components\/canvas\/(Ghosts|Beacons)\b/, () => [...BUDGETS, "livesky", "beacons"]],
  [/^src\/components\/canvas\/RingCourse\b/, () => [...BUDGETS, "race"]],
  [/^src\/components\/canvas\/(SkyBackdrop|DistantGalaxies|starLayer|softSprite|orbitRibbon|WaypointDriver|noIbl|logDepth)\b/, () => [...BUDGETS, "sky"]],
  // GlobalCanvas, PostFX and anything else in the canvas: everything.
  [/^src\/components\/canvas\//, () => "ALL"],
  // The HUD and panels.
  [/^src\/components\/layout\/(LogbookPanel|LogbookTracker|ChangelogPanel|PlumePicker|HangarPanel)\b/, () => ["smoke", "logbook", "shipyard"]],
  [/^src\/components\/layout\/(CareerDossier|BuoyCard)\b/, () => ["smoke", "career", "careerphone"]],
  [/^src\/components\/layout\/(ProjectDossier|reopenDossier|dossierCopy)\b/, () => ["smoke", "probes", "logbook"]],
  [/^src\/components\/layout\/(BeaconPicker)\b/, () => ["smoke", "beacons"]],
  [/^src\/components\/layout\/(RaceHUD)\b/, () => ["smoke", "race"]],
  [/^src\/components\/layout\/(TouchControls)\b/, () => ["smoke", "touch", "careerphone"]],
  [/^src\/components\/layout\//, () => ["smoke", "logbook", "touch", "careerphone", "reducedmotion", "transition"]],
  [/^src\/components\/sections\/Contact\b/, () => ["smoke", "contact"]],
  [/^src\/components\/sections\//, () => ["smoke", "logbook", "careerphone"]],
  [/^src\/data\/changelog\.ts$/, () => ["logbook"]],
  [/^src\/audio\//, () => ["audio"]],
  [/^(public\/models|public\/basis)\//, () => ["assets", "memory", "sky", "startup", "basepath"]],
  [/^public\/sw\.js$/, () => ["basepath"]],
  // The space monsters: dev-only until the combat stage imports them (the game imports none of these).
  [/^(src\/lab\/|src\/utils\/monsters\/|src\/data\/(saucerRig|tardigradeRig)\.json$|public\/models-lab\/|monster-lab\.html$)/, () => ["monsterlab"]],
  // The app's shell, its state and shared code: everything.
  [/^(src|public)\//, () => "ALL"],
  [/^(index\.html|vite\.config\.ts|package\.json|package-lock\.json|tsconfig[^/]*\.json)$/, () => "ALL"],
  // Nothing shipped and no e2e test.
  [/^(docs|tests|scripts|assets-src|beacon-api)\/|\.md$/, () => []],
];

/** The probes `files` touch, in suite order; ALL when a rule says so or none matches. */
export function affectedProbes(files) {
  const picked = new Set();
  for (const file of files) {
    const rule = RULES.find(([re]) => re.test(file));
    if (!rule) return [...ALL];
    const probes = rule[1](file.match(rule[0]));
    if (probes === "ALL") return [...ALL];
    for (const p of probes) picked.add(p);
  }
  return ALL.filter((p) => picked.has(p));
}

function changedFiles(base) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
  const since = git("merge-base", "HEAD", base)[0];
  const committed = git("diff", "--name-only", since, "HEAD");
  const uncommitted = git("status", "--porcelain", "--untracked-files=all").map((l) => l.slice(3).replace(/^.* -> /, ""));
  return [...new Set([...committed, ...uncommitted])];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--base");
  const base = i >= 0 ? args[i + 1] : "origin/main";
  const files = changedFiles(base);
  const probes = affectedProbes(files);
  console.log(`${files.length} changed file(s) since ${base}: ${probes.length === ALL.length ? "the full suite" : probes.join(" ") || "no e2e probe"}`);
  if (!probes.length || args.includes("--dry-run")) process.exit(0);
  const run = fileURLToPath(new URL("./run.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [run, ...(probes.length === ALL.length ? [] : probes)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
