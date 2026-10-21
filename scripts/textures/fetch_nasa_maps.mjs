#!/usr/bin/env node
/**
 * Downloads the NASA / USGS public-domain global maps the real bodies wear
 * (real-solar-system spec §5.5) into assets-src/nasa-src/, and checks each
 * file against its pinned SHA-256.
 *
 *   node scripts/textures/fetch_nasa_maps.mjs            # all, skipping files already verified
 *   node scripts/textures/fetch_nasa_maps.mjs mercury io # only these
 *
 * assets-src/ is the private assets repo (ignored by the main repo);
 * nasa-src/ is ignored there too: the sources are 0.3–800 MB each (Mercury's
 * would break GitHub's 100 MB file limit) and can always be fetched again
 * from these pinned URLs. The processed maps (scripts/textures/
 * process_body_maps.mjs) are what assets-src keeps.
 *
 * Each source names its product page and quotes that page's licence
 * evidence (or the NASA policy it falls under); tests/bodyMaps.test.ts
 * requires every quote to establish public domain. A source whose page said
 * otherwise would have been generated instead (and ledgered).
 *
 * Saturn has no source here (spec §5.5 asked for "a Cassini global map"):
 * a time-boxed search on 2026-10-20 found no public-domain, all-longitude,
 * visible-light natural-colour global cylindrical map of Saturn's cloud tops,
 * so its seeded w-ringed (gen_worlds.mjs) stays. Examined and rejected:
 *   - images.nasa.gov / Photojournal searches "Saturn cylindrical map Cassini",
 *     "Saturn global map", "Saturn map projection", "Saturn cylindrical",
 *     "Saturn mosaic Cassini global", "map of Saturn's clouds", "Saturn polar
 *     projection", "Saturn's atmosphere mosaic", "Saturn natural color mosaic",
 *     "Saturn full globe": every "global map" hit is a moon (Dione, Rhea,
 *     Tethys, Mimas, Enceladus, Iapetus, Phoebe, Titan), not Saturn;
 *   - PIA21617 Cassini "Noodle" Mosaic (5001 × 5301): one Grand Finale swath,
 *     north pole to ~the hexagon, partial longitudes;
 *   - PIA21622 Near-Infrared "Noodle" Mosaic: partial swath, infrared;
 *   - PIA06193 "The Greatest Saturn Portrait" (8888 × 4544), PIA17218 "A
 *     Farewell to Saturn" (6000 × 2500), PIA11141 "Saturn ... Four Years On",
 *     PIA17171/17172 "The Day the Earth Smiled": natural colour, but
 *     perspective views of one hemisphere with rings, not map projections;
 *   - PIA21611 hexagon comparison (2048 × 1024): north polar region only;
 *     PIA17654 hexagon polar projection: infrared, polar only; PIA23170 VIMS
 *     spectral map: the rings, false colour;
 *   - NASA SVS search API ("Saturn map", "Saturn texture", "Saturn global",
 *     "Saturn cylindrical"): no Saturn map product;
 *   - USGS Astrogeology: only "Saturn Voyager Airbrush Global Products", which
 *     are its moons' maps (Dione, Enceladus, Iapetus, Mimas, Rhea, Tethys).
 *
 * The USGS mosaics are served from S3 at ~50 KB/s per connection, so large
 * files are fetched as parallel byte ranges (verified by the hash).
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const NASA_SRC = path.join(ROOT, "assets-src", "nasa-src");

/** NASA's media usage guidelines, the policy for NASA-hosted imagery (fetched 2026-10-20). */
const NASA_GUIDELINES =
  "https://www.nasa.gov/nasa-brand-center/images-and-media/: \"NASA content – images, audio, video, and media files " +
  "used in the rendition of 3-dimensional models, such as texture maps and polygon data in any format – generally are " +
  "not subject to copyright in the United States. You may use this material for educational or informational purposes, " +
  "including ... computer graphical simulations and Internet Web pages.\"";

/**
 * Every source, keyed by id. `file` is the name in assets-src/nasa-src/.
 * `longitude` records how the product lays out longitude (from its PDS/ISIS
 * label where it has one); process_body_maps.mjs turns each into the one
 * convention the game uses.
 */
export const SOURCES = {
  "bmng-2004-07": {
    body: "earth",
    title: "Blue Marble Next Generation, July 2004 (base map, 5400 × 2700)",
    url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg",
    file: "world.200407.3x5400x2700.jpg",
    sha256: "f55226d46d27e05511f2118dc6aa24f5dbf9b6b2cddc87cc6e0e7dd067c00b11",
    bytes: 1617810,
    page: "https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/",
    credit: "NASA Earth Observatory / Reto Stöckli, NASA GSFC",
    licence: `NASA Earth Observatory (GSFC); ${NASA_GUIDELINES}`,
    longitude: "east, -180..180",
  },
  "bm-clouds": {
    body: "earth",
    title: "The Blue Marble: clouds (cloud_combined, 2048 × 1024)",
    url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/content-feature/bluemarble/images/cloud_combined_2048.jpg",
    file: "cloud_combined_2048.jpg",
    sha256: "daddaad84d7a33bbbc86cdda3f591099f57cee8607b7bcf3b67eb7e4f7a1c793",
    bytes: 829367,
    page: "https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/",
    credit: "NASA GSFC, Reto Stöckli (clouds), Robert Simmon",
    licence: `page: "These images are freely available to educators, scientists, museums, and the public."; ${NASA_GUIDELINES}`,
    longitude: "east, -180..180",
  },
  "black-marble-2016": {
    body: "earth",
    title: "Earth at Night / Black Marble 2016, grayscale, 0.1° (3600 × 1800)",
    url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144897/BlackMarble_2016_01deg_gray.jpg",
    file: "BlackMarble_2016_01deg_gray.jpg",
    sha256: "4d2158f59123dadf0696a1cf8909c45018a1de8d0daab40da04122a5aa7f27c6",
    bytes: 365655,
    page: "https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/",
    credit: "NASA Earth Observatory / Joshua Stevens, Miguel Román, NASA GSFC (Suomi NPP VIIRS)",
    licence: `NASA Earth Observatory (GSFC); ${NASA_GUIDELINES}`,
    longitude: "east, -180..180",
  },
  "cgi-moon-kit": {
    body: "moon",
    title: "CGI Moon Kit, LROC WAC colour with poles, 4K (lroc_color_poles_4k.tif)",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif",
    file: "lroc_color_poles_4k.tif",
    sha256: "918649a7f8ed2f1329b2cd95bb0d25483befdcb60ae1a66db681a637cc21344f",
    bytes: 13095388,
    page: "https://svs.gsfc.nasa.gov/4720/",
    credit: "NASA's Scientific Visualization Studio (Ernie Wright, Noah Petro); LRO LROC team",
    licence: "SVS FAQ (https://svs.gsfc.nasa.gov/help/): \"All of our content is in the public domain (unless otherwise noted)\"; the CGI Moon Kit page notes no exception.",
    longitude: "east, -180..180",
  },
  "mdis-color-665m": {
    body: "mercury",
    title: "Mercury MESSENGER MDIS Global Color Mosaic 665m (v3)",
    url: "https://planetarymaps.usgs.gov/mosaic/Mercury_MESSENGER_ClrMosaic_global_665m_v3.tif",
    file: "Mercury_MESSENGER_ClrMosaic_global_665m_v3.tif",
    sha256: "dfd0af2895bc91b028576359b2a0da6c86b5381619fd8e6d58d7d62876362032",
    bytes: 797507691,
    page: "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_global_color_mosaic_665m",
    credit: "NASA/JHUAPL/Carnegie Institution of Washington; USGS Astrogeology",
    licence: "USGS product page: \"Access Constraints public domain ... Use Constraints Please cite authors\"",
    longitude: "east, -180..180 (PDS3 label: POSITIVE_LONGITUDE_DIRECTION = EAST, -180..180)",
  },
  "viking-mdim21-color": {
    body: "mars",
    title: "Mars Viking MDIM 2.1 colorized global mosaic, 1 km JPEG",
    url: "https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/5ea881c6-01b3-41fa-a7af-42d2131b54f1/download/mars_viking_mdim21_clrmosaic_1km.jpg",
    file: "mars_viking_mdim21_clrmosaic_1km.jpg",
    sha256: "fdfcd335559c3dc67052b7e8a9565d850e336ac0d1f3ea7f5eb7826ffb44ecb2",
    bytes: 36708552,
    page: "https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m",
    credit: "NASA/JPL; USGS Astrogeology (MDIM 2.1)",
    licence: "USGS product page: \"Access Constraints Public domain ... Use Constraints None\"",
    longitude: "east, -180..180 (aux.xml GeoTransform origin -10,670,000 m)",
  },
  "dawn-fc-20ppd": {
    body: "ceres",
    title: "Ceres Dawn FC Global Mosaic 400m (DLR, 20 ppd, Oct 2015)",
    url: "https://planetarymaps.usgs.gov/mosaic/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif",
    file: "Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif",
    sha256: "920f65e7d0718c9f8d5e86783f35e0b466096251a8c1f2d01a7748a6d534c154",
    bytes: 27280830,
    page: "https://astrogeology.usgs.gov/search/map/ceres_dawn_fc_global_mosaic_400m",
    credit: "NASA/JPL-Caltech/UCLA/MPS/DLR/IDA; USGS Astrogeology",
    licence: "USGS product page: \"Primary Authors NASA/JPL-Caltech/UCLA/MPS/DLR/IDA ... Publisher USGS Astrogeology Science Center ... " +
      "Access Constraints None ... Use Constraints Please cite authors\" (NASA Dawn mission imagery, released through the PDS); " +
      `the page states no copyright, so NASA's policy applies: ${NASA_GUIDELINES}`,
    longitude: "east, 0..360 (label: PositiveEast, 0..360)",
  },
  "pia07782": {
    body: "jupiter",
    title: "PIA07782 Cassini's Best Maps of Jupiter (Cylindrical Map), 3601 × 1801",
    url: "https://images-assets.nasa.gov/image/PIA07782/PIA07782~orig.jpg",
    file: "PIA07782.jpg",
    sha256: "337781c2ca209f62b209b34b9a6646f7d3cf30d3d1c8e8a3f9ed13e3554d389f",
    bytes: 446531,
    page: "https://science.nasa.gov/photojournal/cassinis-best-maps-of-jupiter-cylindrical-map/",
    credit: "NASA/JPL/Space Science Institute",
    licence: `Photojournal PIA07782, credit NASA/JPL/Space Science Institute, no copyright noted; ${NASA_GUIDELINES}`,
    longitude: "as published (Jupiter's clouds drift; no fixed surface longitude)",
  },
  "io-ssi-voyager-clrmerge-1km": {
    body: "io",
    title: "Io Galileo SSI / Voyager Color Merged Global Mosaic 1km",
    url: "https://planetarymaps.usgs.gov/mosaic/Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif",
    file: "Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif",
    sha256: "135f88cb645bfdb4e045b380971ab2ba14e230590c96c9c86cfe7310fda881ac",
    bytes: 196637696,
    page: "https://astrogeology.usgs.gov/search/map/io_galileo_ssi_voyager_color_merged_global_mosaic_1km",
    credit: "NASA/JPL/USGS (PIA09257)",
    licence: "USGS product page: \"Access Constraints public domain ... Use Constraints None\"",
    longitude: "west-positive, -180..180, centre 0 (left edge 180° W): the same layout as east -180..180",
  },
  "europa-ssi-voyager-500m": {
    body: "europa",
    title: "Europa Voyager - Galileo SSI Global Mosaic 500m",
    url: "https://planetarymaps.usgs.gov/mosaic/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif",
    file: "Europa_Voyager_GalileoSSI_global_mosaic_500m.tif",
    sha256: "a323f0c9ccb47d5af9902ea8297fe81f9a9708795645b80801f103c3f7c9a624",
    bytes: 192777263,
    page: "https://astrogeology.usgs.gov/search/map/europa_voyager_galileo_ssi_global_mosaic_500m",
    credit: "NASA/JPL; USGS Astrogeology (T. Becker; Archinal, Colvin, Davies, Gitlin, Kirk, Weller)",
    licence: "USGS product page: \"Primary Authors Tammy Becker ... Publisher USGS Astrogeology Science Center ... Access Constraints None ... " +
      "Use Constraints None\": a USGS-authored work of the U.S. Government, so public domain (17 U.S.C. § 105)",
    longitude: "west-positive, 0..360, centre 180 (left edge 360° W = 0° E)",
  },
  "ganymede-ssi-voyager-clr-1435m": {
    body: "ganymede",
    title: "Ganymede Voyager - Galileo SSI Color Global Mosaic 1.4km",
    url: "https://planetarymaps.usgs.gov/mosaic/Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif",
    file: "Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif",
    sha256: "da47087e75bc530456d8206d5100ad3c687706353700b0cb44a8400957005a33",
    bytes: 199204541,
    page: "https://astrogeology.usgs.gov/search/map/ganymede_voyager_galileo_ssi_color_global_mosaic_1_4km",
    credit: "NASA/JPL; USGS Astrogeology",
    licence: "USGS product page: \"Access Constraints Public domain ... Use Constraints None\"",
    longitude: "east, 0..360, centre 180",
  },
  "callisto-ssi-voyager-1km": {
    body: "callisto",
    title: "Callisto Galileo/Voyager Global Mosaic 1km",
    url: "https://planetarymaps.usgs.gov/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif",
    file: "Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif",
    sha256: "e1f0bd2e0e05de605d067d6b5f5ededddaf31ca6c064562a1ca770f15a7dbaa3",
    bytes: 114640717,
    page: "https://astrogeology.usgs.gov/search/map/callisto_galileo_voyager_global_mosaic_1km",
    credit: "NASA/JPL; USGS Astrogeology",
    licence: "USGS product page: \"Access Constraints public domain ... Use Constraints None\"",
    longitude: "west-positive, 0..360, centre 180 (left edge 360° W = 0° E)",
  },
  "pia18668": {
    body: "triton",
    title: "PIA18668 Map of Triton (Voyager 2, P. Schenk), 14138 × 7069",
    url: "https://images-assets.nasa.gov/image/PIA18668/PIA18668~orig.jpg",
    file: "PIA18668.jpg",
    sha256: "b38960c7eb2a6c97c062eea891838e970de604b2cff8f8c1fa771009e5001cf1",
    bytes: 4286452,
    page: "https://science.nasa.gov/photojournal/map-of-triton/",
    credit: "NASA/JPL-Caltech/Lunar & Planetary Institute",
    licence: "USGS's edition of this map (https://astrogeology.usgs.gov/search/map/triton_voyager_2_global_color_mosaic_600m, " +
      "\"Edition Name PIA18668\"): \"Access Constraints public domain\"; Photojournal PIA18668 notes no copyright",
    longitude: "east, -180..180 (USGS edition's label: PositiveEast, -180..180)",
  },
};

const sha256File = (file) => new Promise((resolve, reject) => {
  const h = createHash("sha256");
  createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
});

/** Whole-file GET for small sources, parallel ranges (24 connections) for big ones. */
export async function download(url, bytes, out) {
  const tmp = `${out}.part`;
  const fh = await open(tmp, "w");
  try {
    const N = bytes > 20e6 ? 24 : 1;
    const chunk = Math.ceil(bytes / N);
    await Promise.all(Array.from({ length: N }, async (_, i) => {
      const start = i * chunk, end = Math.min(bytes, start + chunk) - 1;
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(url, { headers: N > 1 ? { Range: `bytes=${start}-${end}` } : {}, redirect: "follow" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length !== end - start + 1) throw new Error(`short read ${buf.length}`);
          await fh.write(buf, 0, buf.length, start);
          return;
        } catch (e) {
          if (attempt >= 5) throw new Error(`${url} [${start}-${end}]: ${e.message}`);
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    }));
  } finally {
    await fh.close();
  }
  renameSync(tmp, out);
}

async function main() {
  const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--")));
  mkdirSync(NASA_SRC, { recursive: true });
  let bad = 0;
  for (const [id, s] of Object.entries(SOURCES)) {
    if (only.size && !only.has(id) && !only.has(s.body)) continue;
    const out = path.join(NASA_SRC, s.file);
    if (!(existsSync(out) && statSync(out).size === s.bytes && (await sha256File(out)) === s.sha256)) {
      const t = Date.now();
      console.log(`${id}: downloading ${(s.bytes / 1048576).toFixed(1)} MB`);
      await download(s.url, s.bytes, out);
      console.log(`  ${((Date.now() - t) / 1000).toFixed(0)} s`);
    }
    const got = await sha256File(out);
    if (got !== s.sha256) {
      console.error(`${id}: SHA-256 MISMATCH ${got} (pinned ${s.sha256})`);
      bad++;
    } else {
      console.log(`${id}: ok ${s.file}`);
    }
  }
  if (bad) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
