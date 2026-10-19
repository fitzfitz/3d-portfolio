/**
 * The banded giant's atmosphere: the cyan it always had. It used to be read
 * from the planet's colour, which was the Portfolio project's; that colour is
 * now the probe's, so the planet keeps its look through this literal.
 */
export const PORTFOLIO_ATMOSPHERE = "#00f0ff";

/**
 * Each planet's atmosphere shell, as SpacePlanets draws it (Atmosphere `color`
 * and `thickness`, the shell radius in planet radii), keyed by planet name.
 * The colours are the look the planets always had (project probes spec §4.4,
 * G5); they are not the planets' UI colour (PLANET_PROPS). The thickness is
 * also the camera's keep-out shell (utils/worldCollide.ts SOLID_BODIES): the
 * shell is FrontSide and culls from inside.
 */
export const PLANET_ATMOSPHERES: Readonly<Record<string, { color: string; thickness: number }>> = {
  ruangrapi: { color: "#7dffd0", thickness: 1.12 },
  portfolio: { color: PORTFOLIO_ATMOSPHERE, thickness: 1.06 },
  fuxx: { color: "#c77dff", thickness: 1.05 },
};
