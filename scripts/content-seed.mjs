// Writes beacon-api/content-seed.sql from the bundled content (src/data/projects.json,
// src/data/career.ts), so D1 starts identical to the site. Run after editing
// either file: `npm run content:seed`. tests/contentSeed.test.ts fails until you do.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import projects from "../src/data/projects.json" with { type: "json" };
import { BUNDLED_CAREER } from "../src/data/career.ts";
import { contentSeedSql } from "../beacon-api/src/contentSeed.ts";

const out = fileURLToPath(new URL("../beacon-api/content-seed.sql", import.meta.url));
writeFileSync(out, contentSeedSql(projects, BUNDLED_CAREER));
console.log(`wrote ${out}: ${projects.length} projects, ${BUNDLED_CAREER.length} career rows`);
