# Realistic Comet Specification

Ground-up rebuild of the comet, built to real cometary science and verified
against it. Sources: Rosetta/67P morphology and albedo studies
(aanda.org, MNRAS), comet tail physics (UCLA/Jewitt, Swinburne COSMOS),
C2 green-coma chemistry (UNSW/Chemistry World, 2021).

## Nucleus

- **N1 Bilobed shape**: two unequal lobes joined by a narrow neck
  (67P: 4.1×3.5×1.6 km + 2.5×2.1×1.6 km lobes). Verify in silhouette render.
- **N2 Extremely dark**: geometric albedo 0.04–0.06 — darker than coal.
  Base color in the ~0.03–0.07 linear range, charcoal-grey, never icy blue.
- **N3 Surface morphology**: pits, boulders, layered cliff facets, smoother
  dust plains — readable in a close render (geometry + normal map).
- **N4 Sparse exposed ice**: small, localized bright bluish-white patches
  (few % of surface), matching Rosetta's exposed-H2O detections.
- **N5 Slow tumble**: rotation ≤ 0.15 rad/s in game (real: hours per rev).
- **N6 Budget**: high-poly look, ≤ 0.5 MB optimized GLB.

## Coma

- **C1 Green inner coma**: C2 (dicarbon) fluorescence green, enveloping the
  nucleus, diffuse falloff.
- **C2 Scale**: visible envelope ≥ 4× nucleus radius near perihelion.
- **C3 Activity scaling**: coma brightness/size ∝ ~1/r² heliocentric
  distance — near-invisible at aphelion, blazing at perihelion.
- **C4 Green stays in the coma**: sunlight destroys C2 before it reaches the
  tails — tails must never be green.

## Ion tail

- **I1 Direction**: points exactly anti-sunward (radially away from the sun,
  origin), independent of velocity.
- **I2 Shape**: straight and narrow with subtle waves/kinks (solar wind).
- **I3 Color**: blue (CO+ scattering).
- **I4 Length**: scales with activity; visually the longest tail feature.

## Dust tail

- **D1 Curvature**: broad and curved — dust released earlier lags along the
  orbital path and is pushed outward by radiation pressure (position =
  orbit position at emission time + anti-sunward drift ∝ age²).
- **D2 Color**: white / pale yellow (reflected sunlight), diffuse.
- **D3 Separation**: visibly distinct in direction from the ion tail when
  the comet is moving across the sky.
- **D4 Brightness**: scales with activity like the coma.

## Removals (violations of realism in the old build)

- **R1**: no velocity-aligned "beam" — no real tail follows the velocity
  vector.
- **R2**: no warm orange fire coma — comas are green/teal gas, not flame.

## Verification protocol

1. Blender close render of nucleus → N1, N2, N3, N4.
2. Code review of tail math → I1, D1, C3, N5.
3. In-game probe screenshots near perihelion → C1, C2, I2/I3, D2/D3, R1/R2.
4. Any failed item → rework → re-verify.
