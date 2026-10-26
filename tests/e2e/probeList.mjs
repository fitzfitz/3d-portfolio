// Every e2e probe (tests/e2e/<name>.probe.mjs), in the order run.mjs runs
// the full suite. Shared by run.mjs and affected.mjs; a module of its own
// because run.mjs runs the suite when imported.
export const ALL = ["startup", "smoke", "audio", "perf", "transition", "sky", "flight", "gameplay", "touch", "gamepad", "race", "bottles", "content", "assets", "contact", "career", "careerphone", "shipyard", "reducedmotion", "fuel", "reactions", "jellyguide", "events", "mechanics", "logbook", "livesky", "combat", "programs", "probes", "monsterlab", "basepath", "memory"];
