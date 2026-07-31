# Refuel Confirmation — Design

**Date:** 2026-07-31
**Status:** Approved by user (trigger rule and the two-message split both confirmed)

## Goal

Close the communication loop the DRY message opens. `HUDOverlay.tsx:92-94` broadcasts
`"WARP CORE DRY // COLLECT A FUEL CRYSTAL TO RECHARGE — THRUSTERS STILL NOMINAL"`. A visitor who
obeys that instruction gets a pickup sound and a moving gauge, but no acknowledgement that the
instruction worked. `FuelCrystals.tsx:133` broadcasts on exactly one case today — the *useless* one,
a pickup at a full tank.

This was flagged in the fuel-and-crystals whole-branch review as a deliberate non-fix ("a product
decision for the repo owner, and the spec does not ask for it"). This spec is that decision.

## Decisions (user-confirmed)

1. **Confirm on the transition, not on every pickup.** A pickup speaks only when it lifts the tank
   out of low. Rejected: the review's literal suggestion of one line on the `before < FUEL_MAX`
   branch — see §5 for why that one is not merely noisier but actively threatens an open QA check.
2. **Two messages, not one.** A dry-tank recovery and a low-tank top-up say different things,
   because only one of them restores warp. See §3.

## Decisions made without asking, and why

- **No persistence, no new store state.** The rule is a pure function of the pre-pickup fuel value,
  which `FuelCrystals.tsx:121` already captures as `before`. Nothing needs remembering between
  pickups, so nothing is added to the store.
- **The existing full-tank "VENTED" message stays exactly as it is.** It is pre-existing, and this
  spec preserves it unchanged rather than touching it; it only adds branches beside it. (Correction:
  an earlier revision of this bullet claimed the message was "already tested" — it is not; `grep
  VENTED tests/` returns nothing today. That false premise is struck; it carried no weight beyond
  itself, since the decision not to touch VENTED stands independent of whether it was tested.)

**Open follow-up, not settled by this spec: VENTED's frequency.** `flight.fuel` starts at
`FUEL_MAX` and only warp drains it, so a visitor who never presses Shift sits at a full tank
indefinitely and gets `"FUEL CRYSTAL VENTED // TANK ALREADY FULL"` on *every single pickup* in that
state — exactly the per-pickup frequency the `quiet` rule above exists to avoid, and the one branch
this design left untouched. Whether VENTED should be silenced, deduplicated, or rate-limited the way
`quiet` avoids the same problem is a product decision for the repo owner; this spec does not settle
it.

Mitigating factor, for balance: `CRYSTAL_PICKUP_RADIUS` is 3 against a ~146-unit mean crystal
spacing (`crystalField.ts`), so pickups of any kind are rare regardless of tank state — which means
the "machine-gun across a 40-crystal field" framing above overstates the risk for the `quiet` case
too, not only for VENTED.

## 1. The rule lives in `fuel.ts` as a pure function

The fuel feature's established pattern is pure transforms in `src/utils/fuel.ts`, unit-tested
without a scene (`tests/fuel.test.ts`). The trigger belongs there rather than inline in a
`useFrame`, so its boundaries are pinned by tests and the frame loop stays readable.

```ts
export type RefuelOutcome = "vented" | "restored" | "topped-up" | "quiet";

/** Which confirmation (if any) a pickup at `before` fuel should broadcast. */
export function refuelOutcome(before: number): RefuelOutcome;
```

`FuelCrystals` switches on the returned outcome. It does not host the branch logic itself.

## 2. One shared "low" threshold, not two

The 25% mark currently exists only as a bare `0.25` inside the HUD's rAF loop, in the gauge's
colour expression (`HUDOverlay.tsx:62`):

```ts
pct <= 0 ? "#ef4444" : pct < 0.25 ? "#f59e0b" : "#00ff87";
```

Writing a second `0.25` into `FuelCrystals` would let the two drift: a later change to the amber
point would leave the gauge going amber at a fuel level where the confirmation no longer fires,
with nothing to catch it. So the threshold is promoted into `fuel.ts` and imported by both call
sites:

```ts
/** Below this, the tank is "low": the gauge goes amber and a pickup announces itself. */
export const FUEL_LOW = 25;
```

This is the same move the repo already made deliberately for `SHIP_WARP_SPEED` in commit `bd5e69a`
("promote WARP_SPEED to constants so Task 1's tuning test pins both sides"), so it follows an
existing convention rather than inventing one.

`FUEL_LOW` is expressed in fuel units (25 of a 100 tank), matching `FUEL_MAX` and
`FUEL_PER_CRYSTAL`. `HUDOverlay` compares a 0–1 fraction, so it uses `pct < FUEL_LOW / FUEL_MAX`.

**Coincidence worth noting, not worth coupling:** `FUEL_LOW` and `FUEL_PER_CRYSTAL` are both 25.
They are independent numbers that happen to share a value — one is "when does the tank read as
low", the other is "how much does a crystal restore". They must stay separate constants. Two
consequences of the current values: a `restored` pickup lands at exactly 25% (it can only fire from
a tank at 0), and a `topped-up` pickup lands in `(25, 50)` and so can never reach full.

## 3. The four outcomes

| `before` | Outcome | Broadcast |
|---|---|---|
| `>= FUEL_MAX` | `vented` | existing `"FUEL CRYSTAL VENTED // TANK ALREADY FULL"` |
| `<= 0` | `restored` | `"WARP CORE RECHARGED // N% — WARP ONLINE"` |
| `0 < before < FUEL_LOW` | `topped-up` | `"FUEL CRYSTAL ABSORBED // N%"` |
| `FUEL_LOW <= before < FUEL_MAX` | `quiet` | *(silent)* |

`N` is computed **after** the refuel, using the *same expression the gauge uses*
(`HUDOverlay.tsx:66`: `(pct * 100).toFixed(0)`) rather than a `Math.round` that agrees with it on
today's values but not necessarily on all of them. §9 requires `N` to match the gauge, so the two
must be the same formula, not merely equivalent formulas.

**Why two messages rather than one.** `"WARP ONLINE"` is only news when warp was actually offline.
On a 10% → 35% pickup the visitor never lost warp, so announcing its restoration states something
untrue. This HUD is careful about precisely that distinction — the DRY line goes out of its way to
add "THRUSTERS STILL NOMINAL" so nobody believes they are stranded. `restored` is the line that
closes the DRY loop; `topped-up` acknowledges the pickup without claiming a restoration that did
not happen.

Ordering note: the branches are mutually exclusive as written, but `vented` must be tested before
`restored` if they are ever restructured, since `FUEL_MAX > 0`.

## 4. Render pressure: unchanged

`sendBroadcast` is a discrete per-pickup call, exactly as `DataShards.tsx:84` already does for every
shard. It cannot affect steady-state renders, so the project's zero-renders-during-flight guarantee
is not at stake.

The existing `store.setFuelEmpty(flight.fuel <= 0)` at `FuelCrystals.tsx:132` still runs first and
unchanged, so the `fuelEmpty` true→false edge still resets `dryAnnouncedThisSpell`
(`HUDOverlay.tsx:85-95`) and a later dry spell still re-announces. No change there.

## 5. `perf.probe.mjs` — risk assessed and found to be near-nil

**Correction.** An earlier revision of this section claimed the perf probe samples commits "with
warp held, draining the tank", making a mid-hold pickup below 25% a plausible new source of flake.
Reading the probe disproves both halves:

1. **The perf probe never warps.** Its sampling hold is `hold(page, ["KeyW"], 5000)`
   (`perf.probe.mjs:90`) and `Shift` appears nowhere in the file. Warp is never active, so the tank
   never drains: `flight.fuel` stays at `FUEL_MAX` for the whole probe. A crystal pickup during the
   hold therefore hits `before >= FUEL_MAX` → the **pre-existing** `vented` branch. The new
   `restored` and `topped-up` branches are unreachable in that probe, so this change cannot add
   churn there at all.
2. **`broadcast` is already a watched key.** It is in `KEYS` (`perf.probe.mjs:55`), so any
   broadcast — including today's `vented` one — is detected as churn and retried, rather than
   silently failing `commits=0`. The failure mode was already handled before this change.

So there is no mitigation to build. The residual obligation is only to confirm the reasoning
empirically rather than trust it:

- Run `npm run test:e2e perf` **at least 3 times** and report `commits` and any inconclusive
  attempts, rather than trusting one green run.
- If it *does* trip against this analysis, fix it by controlling the probe's crystal field (e.g.
  deactivating crystals near the sampling position before the hold, via the same live-reference
  debug bridge the radar-range block already uses) — **never** by weakening the `commits=0`
  assertion or widening a bound.

Note for the record: the fuel-and-crystals verification record states `commits=0` was measured
"with fuel actively draining during the 5s steady-flight hold". Per the source above, that cannot
have been the case — cruise does not drain (the fuel probe asserts exactly this) and the hold
presses only `KeyW`. The `commits=0` result stands; the "draining" characterisation of it does not.

## 6. Testing

**Unit (`tests/fuel.test.ts`).** Pin every boundary of `refuelOutcome`, since the whole feature is
that function: `0` → `restored`; `24.9` → `topped-up`; `25` → `quiet` (the comparison is strict
`<`, so exactly `FUEL_LOW` is not low); `99` → `quiet`; `100` → `vented`. Also a negative input
(`-1` → `restored`) — `drainFuel` clamps at 0 so it should be unreachable, but the function must
not fall through to `quiet` if it ever is.

**e2e (`tests/e2e/fuel.probe.mjs`).** The probe already builds the `restored` scenario exactly:
lines 114-131 assert the tank is at 0, then teleport the ship onto an active crystal and assert
`refuelled === 25`. The new check goes immediately after that existing assertion — it needs no new
setup and, critically, **relocates no crystals**, so it does not touch the ordering hazard in §7.

Read the chatter line the way `gameplay.probe.mjs` already establishes, via its `chatterText`
helper pattern (`gameplay.probe.mjs:23`), and match on the message text. `gameplay.probe.mjs:189-205`
documents why: reading `store.broadcast` before/after is not sufficient evidence, because
`RadioChatter`'s subscriptions call `typeLine` directly, and a matched-against-nothing read can
false-pass on an unrelated ambient line.

Two mechanical details for the check:

- `typeLine` types at ~22ms/char (`RadioChatter.tsx:26`), so the line appears progressively.
  Assert on a **substring** (`"WARP CORE RECHARGED"`, ~19 chars ≈ 420ms) rather than the full
  string, and **poll** for it rather than reading once.
- `typeLine` calls `scheduleAmbient()`, which resets the ambient timer, so an ambient line should
  not overwrite the broadcast within the poll window. Polling rather than sleeping keeps this from
  depending on that.

## 7. Also in scope: comment the probe's ordering hazard

The fuel-and-crystals review parked this as a known gap:

> `fuel.probe.mjs`'s crystal-relocation block must stay last in the probe. It mutates live crystal
> positions, and a relocated crystal has a ~2% chance of landing in an asteroid band — which would
> break the buried-in-bands check if that check ran afterwards. This hazard is not commented in the
> probe itself.

The radar-range block (which relocates crystals, `fuel.probe.mjs:246-256`) currently sits after the
buried-in-bands check (`fuel.probe.mjs:148`), so the probe is correct today purely by ordering, with
nothing in the file saying so. Since this spec adds a check to the same file, add the comment now.
It is two lines and it prevents a future edit from silently breaking an unrelated assertion.

## 8. Out of scope, deliberately

- **The warp-duration knob.** The review named it "the first knob to turn if the site reads as
  stingy" — a judgement that requires flying the thing. Deferred pending the owner's verdict from
  the `docs/QA-CHECKLIST.md` pass, so it is tuned once rather than twice.
- **Option C, the gauge flash** (pulsing the fuel bar on every pickup via the existing rAF DOM
  path). A possible additive follow-up, not a substitute: the DRY prompt arrives as a chatter line,
  so the reply belongs in the chatter channel.
- **The other parked test gaps** from the fuel-and-crystals review: the tautological
  `"found (or built) a ship position…"` diagnostic, the untested altitude chevron, the hard-coded
  `RANGE = 160`, and canvas alpha/`fillStyle` hygiene. Unrelated to this change.
- **Anything the QA pass surfaces.** Checks 1-9 are being run by the owner in parallel with this
  work; their findings become a separate design.

## 9. Acceptance

- A dry tank refuelled by a crystal produces `"WARP CORE RECHARGED // N% — WARP ONLINE"` in the
  chatter line, with `N` matching the gauge.
- A pickup below 25% but above empty produces `"FUEL CRYSTAL ABSORBED // N%"`.
- A pickup at or above 25% produces no chatter line at all.
- A pickup at a full tank still produces the existing VENTED line.
- `HUDOverlay` and `FuelCrystals` agree on the low threshold by importing `FUEL_LOW`. Neither file
  contains a bare threshold literal any more: the `0.25` at `HUDOverlay.tsx:62` is gone, and no `25`
  is introduced in `FuelCrystals`. (`FUEL_PER_CRYSTAL = 25` in `fuel.ts` is a different number and
  stays.)
- `npm run test:e2e perf` reports `commits=0` across at least 3 runs, with any inconclusive
  attempts reported rather than ignored.
- Full gate green: `npm run build && npm run lint && npm test && npm run test:e2e`, with lint
  showing only the two long-standing warnings (`Atmosphere.tsx:54`, `Scanner.tsx:9`).
