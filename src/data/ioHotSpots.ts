/**
 * Io's persistent volcanic hot spots, for its night-side glow (spec §5.5, L33).
 *
 * Positions: the IAU/USGS Gazetteer of Planetary Nomenclature feature centres
 * (https://planetarynames.wr.usgs.gov, Io), planetographic latitude and WEST
 * longitude, as Io's coordinates are published; ioGlow.ts lays them out on the
 * Io map's east-positive grid. tests/ioGlow.test.ts checks Loki's and
 * Prometheus's dark paterae on the shipped map lie under them.
 *
 * `power` is a relative glow (Loki 1), ordered after the thermal surveys
 * (Galileo NIMS, Lopes et al. 2004, Icarus 169; Keck adaptive optics, de Kleer
 * & de Pater 2016, Icarus 280): Loki Patera is the most powerful persistent
 * volcano, then Pele; the rest are steady or often-active centres. The values
 * and the glow radii (`sigmaDeg`, a Gaussian in degrees of arc) are a look,
 * not a measurement: the real spots are a few to tens of km, under a pixel at
 * any range the game shows Io from.
 */
export interface IoHotSpot {
  name: string;
  latDeg: number;
  lonWDeg: number;
  power: number;
  sigmaDeg: number;
}

export const IO_HOT_SPOTS: readonly IoHotSpot[] = [
  { name: "Loki Patera", latDeg: 12.6, lonWDeg: 308.8, power: 1, sigmaDeg: 3.2 },
  { name: "Pele", latDeg: -18.7, lonWDeg: 255.3, power: 0.7, sigmaDeg: 2.4 },
  { name: "Prometheus", latDeg: -1.6, lonWDeg: 153.1, power: 0.45, sigmaDeg: 2 },
  { name: "Pillan Patera", latDeg: -12.1, lonWDeg: 244.2, power: 0.4, sigmaDeg: 1.8 },
  { name: "Marduk Fluctus", latDeg: -27.7, lonWDeg: 209.7, power: 0.4, sigmaDeg: 1.8 },
  { name: "Tvashtar Paterae", latDeg: 62.8, lonWDeg: 123.5, power: 0.4, sigmaDeg: 1.8 },
  { name: "Amirani", latDeg: 24.5, lonWDeg: 114.7, power: 0.35, sigmaDeg: 1.8 },
  { name: "Culann Patera", latDeg: -19.9, lonWDeg: 160.1, power: 0.3, sigmaDeg: 1.6 },
  { name: "Zamama", latDeg: 18.3, lonWDeg: 173.4, power: 0.3, sigmaDeg: 1.6 },
  { name: "Masubi", latDeg: -45.1, lonWDeg: 55.5, power: 0.3, sigmaDeg: 1.6 },
  { name: "Janus Patera", latDeg: -4, lonWDeg: 38.5, power: 0.35, sigmaDeg: 1.6 },
  { name: "Kanehekili Fluctus", latDeg: -17.7, lonWDeg: 35.8, power: 0.35, sigmaDeg: 1.6 },
  { name: "Gish Bar Patera", latDeg: 16.2, lonWDeg: 90.4, power: 0.3, sigmaDeg: 1.6 },
  { name: "Surt", latDeg: 45.6, lonWDeg: 336.2, power: 0.3, sigmaDeg: 1.6 },
];
