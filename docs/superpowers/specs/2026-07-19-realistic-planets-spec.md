# Realistic Planets Specification

Uplift the three portfolio planets (saas/earth-type, video/jupiter-type,
agent/mars-type) from neon-emissive balls to physically-plausible bodies.
Sources: NASA/skyatnight solar-system color references, Jupiter atmosphere
(NASA/Wikipedia), Mars surface color studies, real-time planet rendering
techniques (Heckel, Schafhitzel & Falk).

## Global

- **G1 Patterns readable**: surface texture (continents, belts, rust plains)
  clearly visible — metalness 0, no full-surface neon emissive wash.
- **G2 Sun-consistent lighting**: one sun light at the origin dominates;
  every planet shows a day side and a night side (terminator) facing the sun
  correctly. Neon per-planet lights demoted to faint accents.
- **G3 Identity preserved**: each planet keeps its gameplay color identity
  via accessories (orbit ring, zone circle, moons, accent light) — not by
  tinting the surface.

## Earth-type (saas)

- **E1 Blue marble**: ocean/continent map visible, moderate specular.
- **E2 Rayleigh rim**: blue-green atmosphere rim, brighter on the sunlit
  limb, fading on the night side (sun-aware shader).
- **E3 Independent cloud deck**: white clouds drifting over the surface.

## Jupiter-type (video)

- **J1 Bands visible**: belt/zone striping reads from gameplay distance.
- **J2 Limb darkening**: gas giant dims toward the limb (opposite of a rim
  glow) — dark translucent fresnel overlay.
- **J3 Fastest rotation** of the three (Jupiter: ~10 h day).
- **J4 No terrestrial extras**: no white puffy cloud sprites, high roughness
  (no hard-surface specular).

## Mars-type (agent)

- **M1 Butterscotch surface**: rust/tan patterns visible.
- **M2 Thin dust haze**: faint tan-pink rim, far thinner/weaker than the
  earth-type atmosphere.
- **M3 No cloud deck**: cloud layer removed.

## Verification protocol

In-game probe: fly to each planet, screenshot day side and terminator;
check each item; rework failures.
