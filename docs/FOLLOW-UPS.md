# Follow-ups

Findings noticed while working on something else and deliberately not fixed at
the time, so the change in flight stayed scoped. Each one is real and
reproducible; none is urgent enough to have justified widening a branch.

Delete an entry when it is fixed.

- **Bake Fuxx's albedo into the texture.** `FUXX_ALBEDO_LIFT` (sunLight.ts)
  multiplies the material colour by 3 because the baked map is ~1.4% median
  linear luminance. Raise it in `scripts/textures/gen_planets.mjs` (target p90
  ~0.07, median ~0.04), regenerate the webp maps, then delete the constant and
  the `fuxx.color.setScalar` line in SpacePlanets.tsx.
- **Night-side red glow breaks L29.** The faint red on night sides is the
  specular IBL reflection of the `#ff5500` Lightformer in the studio
  `<Environment>` (GlobalCanvas.tsx), constant and lifted by exposure. Fix:
  give planet and cloud materials an explicit `envMap` with a low
  `envMapIntensity`, or neutralise the orange Lightformer. Verify the e2e
  programs probe still reports `added=0`.
