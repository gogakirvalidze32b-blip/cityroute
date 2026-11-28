# Kilometre-based PIN system (chainage migration)

## What changed — and what did not

**Not changed:** the driving route, every PIN location (bit-for-bit), PIN order,
instruction text, audio files and their mapping, trigger radii, speed-limit
bands, Supabase, payments, authentication. See `PIN_COMPARISON_REPORT.md`.

**Changed:** how PINs are anchored and (behind a flag) how they are triggered.

| Piece | File |
|---|---|
| Frozen, versioned route geometry (single source of truth for route km) | `src/data/route-geometry.ts`, `src/data/route-geometry/route-N.geometry.json` |
| PIN ⇄ kilometre table (km, lead, exact offset) | `src/data/pin-chainage.json`, `src/data/pin-chainage.ts` |
| PIN coordinate = route point at km + exact offset | `src/lib/pin-chainage-geometry.ts`, used by `src/data/telavi-routes.ts` |
| Kilometre-crossing trigger (pure) | `src/lib/pin-chainage-trigger.ts` |
| Feature flag + shadow events | `src/lib/pin-chainage-flag.ts` |
| Runtime integration (shadow / active, audio queue, persistence) | `src/components/ExamDriveSession.tsx` |
| Move a PIN by kilometre | `scripts/move-pin-chainage.mts` |
| Replay harness + baselines | `src/components/ExamDriveSession.replay.test.tsx`, `src/test/replay/`, `src/test/migration-baseline/` |

## How a PIN is defined now

```
pin-chainage.json  →  { sort_order, chainage_m, lead_m, offset_lat_deg, offset_lng_deg, origin }
coordinate          =  positionAt(frozen route line, chainage_m) + offset
trigger point       =  chainage_m − lead_m          (lead = the existing audio radius: 10/15/20 m)
audio               =  bound to instruction_ka (unchanged)
```

The route line no longer depends on PIN coordinates, so moving a PIN can never
reshape the route or shift the kilometres of anything after it.

### Moving a PIN (example: Route 2 PIN 9 from 3.114 km to 3.200 km)

```powershell
node scripts/move-pin-chainage.mts --route route-2 --pin 9 --km 3.2           # dry run
node scripts/move-pin-chainage.mts --route route-2 --pin 9 --km 3.2 --write   # save
```

Marker, kilometre trigger and audio move together. The tool refuses a
kilometre that would break PIN order. The moved PIN is placed on the route line
(`--keep-offset` keeps its old sideways offset). Moved PINs are marked
`origin: "edited"` and are excluded from the "unchanged position" guard.

## How the kilometre trigger works (flag ON)

GPS is still required — it is what produces route progress. On every GPS fix
whose route match is accepted and adopted as progress:

1. The next unhandled PIN (strict order) is due when `progress ≥ km − lead`.
2. It is spoken only if the fix is physically consistent with the matched
   route point (cross-track ≤ 25 m), the GPS heading does not contradict the
   route direction (≤ 100° when moving ≥ 3 m/s), and the fix is within 60 m
   of the PIN.
3. If progress passed several pending PINs between fixes, only the latest still
   relevant PIN is spoken; earlier ones are marked passed silently.
4. A PIN passed by more than 30 m is outdated: never spoken, marked passed
   silently after 2 consistent fixes.
5. Rejected / frozen matches (GPS jump, poor accuracy, outage) trigger nothing;
   the next accepted fix catches up. Nothing is lost, nothing is repeated.
6. Matcher steering in active mode targets the next PIN whose trigger point has
   not been reached, and a steered match rejected as off-route / jump /
   ambiguous is retried without lit-PIN steering (forward + consistent only).
   This removes the legacy "stuck after an outage" deadlock.

Decisions go through the existing audio queue (duplicate protection, retries,
persistence). Silent passes complete without playback and are persisted
(`silentPinSortOrders`) so they are never spoken after a reload.

## Validation (synthetic GPS replays of the real ExamDriveSession pipeline)

11 scenarios × 4 routes (clean 1 Hz, 2 s / 60 km/h, 5 s / 50 km/h, 6 m jitter,
GPS outages around PIN 10 / PIN 15, idle start, slow start). Legacy results are
frozen in `src/test/replay/baselines/legacy-trigger.json`.

| Scenario | Legacy trigger | Kilometre trigger |
|---|---|---|
| Clean 1 Hz, all routes | all PINs | all PINs, same set, 0–17 m before the PIN |
| 6 m jitter | R1 stops after #15, R4 after #18 | all PINs on all routes |
| 2 s fixes, 60 km/h | 0–5 voices (PIN 1 missed blocks the route) | 28–35 per route, rest passed silently |
| GPS outage at PIN 10 / 15 | every later PIN lost | only the outdated PIN is silent, all later PINs speak |
| 5 s fixes, 50 km/h | 0–3 voices | 11–19 voices; passed PINs silent; never early, never wrong-pass |

Every active-mode replay is asserted: once only, forward order, never more than
lead + 25 m early, never more than 30 m (+15 m measurement lag) late, handled
orders always a resumable prefix, and nothing legacy spoke is lost.

### Known limitations

* At 5 s fix spacing the legacy route matcher stays ambiguous through the
  hairpin / dual-pass finish corridors; the last 2–4 PINs are then held (never
  spoken wrongly) instead of being handled. 1–2 s fixes are unaffected.
* In shadow mode (flag OFF) the matcher is still steered by the legacy pending
  PIN, so shadow events stop wherever the legacy trigger gets stuck.
* Validation used synthetic traces; record real drives in a dev build with the
  built-in recorder (`copy(JSON.stringify(window.__cityrouteGpsTrace))`) and
  replay them before enabling a route in the field.
* No route-specific matcher exceptions were removed (Phase 7 not done).

## Feature flag and rollback

Exactly one PIN audio authority per route: when chainage is active the GPS
handler returns before the legacy trigger path (tested end to end per route).

| Environment | PIN audio trigger |
|---|---|
| **Vercel Preview** build | **Chainage, Routes 1–4** (default — no variable needed) |
| Production build | Legacy, hard-wired (activation code removed at build time) |
| Local `npm run dev` / plain `vite build` / tests | Legacy (chainage runs in shadow, logging only) |
| Route 5 (any environment) | Legacy (no frozen geometry / chainage table) |

* Optional Preview build-time override (Vercel *Preview* scope only):
  `VITE_PIN_CHAINAGE_TRIGGER_ROUTES=route-2,route-4` (subset) or `=none` (all legacy).
* **Emergency rollback** (works in any build, wins over everything, only ever
  disables): open the app with `?pinTrigger=legacy` → legacy trigger for that
  browser tab (kept in sessionStorage across navigation/reload);
  `?pinTrigger=chainage` clears it.
* A route whose chainage table fails validation stays on legacy automatically
  (console: `[PIN KM] chainage table unavailable`).
* Field diagnostics in dev / Preview only: console lines
  `[PIN KM] trigger mode ROUTE-2 KILOMETRE|LEGACY`, `[PIN KM] … play/passed silently`,
  `[ROUTE MATCH]` per fix, and the raw trace via
  `copy(JSON.stringify(window.__cityrouteGpsTrace))`.
* Where chainage is not active the legacy trigger is in control and chainage
  only runs in shadow (reports what it would do, never speaks).
* Rollback, fastest first: `?pinTrigger=legacy` in the browser tab →
  `VITE_PIN_CHAINAGE_TRIGGER_ROUTES=none` on the Preview build and redeploy →
  restore a backup (`D:\CityRoute\backups\…`).
