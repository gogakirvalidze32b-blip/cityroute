# CityRoute — Preview checkpoint (2026-11-28)

**Project folder:** `D:\CityRoute\cityroute-preview-design-pin-audio-20261104`
**Branch:** `preview/design-plus-pin-audio-20261104` (pushed only to this branch; `main` / Production untouched)
**Base commit before this release:** `fd7b314` (*Fix automatic route start and PIN geometry*), which sat 2 commits ahead of `origin` (`63c103a`, `fd7b314`, both included in this push).
**Release commit:** the commit that adds this file (`git log -1 -- CITYROUTE_CHECKPOINT_PREVIEW_20261128.md`).
**Target:** Vercel **Preview only**. Production is not deployed and not reconfigured.

Earlier checkpoints are kept unchanged: `CITYROUTE_CHECKPOINT.md`, `CITYROUTE-PRODUCTION-CHECKPOINT.md`, and the backup folders under `D:\CityRoute\` (`backups`, `_backups`, `cityroute-preprod-backup-*`, …).

---

## 1. What this version contains

### Map design
- Route line: turquoise/cyan "navigation" line with glow layers (`RoutePolyline.tsx`, variant `navigation`: 2 glow layers, dark casing, bright core, thin highlight).
- PINs: golden markers — next PIN bright/large, upcoming gold, passed small/dim (`route-pin-style.ts`, shared by the live map and the demo route preview).
- Demo route preview (`/preview-demo/route/…`) uses the same line and PINs (`RoutePreviewMap` `navigationStyle`).
- Exactly one vehicle arrow (class collision with the legacy `.nav-arrow` removed); smaller Google-style chevron with halo.

### Arrow / Smooth Glide (display only — never feeds GPS progress, chainage, PIN triggering or speed)
- `display-progress.ts`: filtered display chainage per fix — alpha-beta tracker (speed learned from real progress, reported speed only a hint, a reported standstill trusted), never backwards, forward-snap protection, lead cap (never clearly ahead of the measured position), gap resync after >2 s without fixes, relocation snap >150 m.
- `vehicle-motion.ts`: per-frame prediction along the frozen route line (no lag), extrapolation ≈ one fix interval then eases off (no stop-and-go), smooth error correction, first fix starts from the drawn position (no hop).
- `ExamDriveSession.tsx` `publishMapArrow`: local re-projection of the raw fix around the arrow, so matcher snaps / holds on a parallel pass of the route (roads doubling back) no longer drag the arrow ahead or behind; rejected stretches (hairpins) keep the arrow moving with an untrusted estimate.
- `ExamLiveMapLeaflet.tsx`: single rAF camera loop, marker moved imperatively, FOLLOW camera locked to the drawn arrow, FREE camera untouched by GPS, smooth recenter (decaying offset), idle-frame guard.
- `vehicle-glide.ts` kept as fallback (off-route / before session start).

### Chainage system (Routes 1–4) and PINs
- Frozen versioned route geometry (`src/data/route-geometry/*.json`, `g1-<hash>`) as the single chainage source; PIN table `src/data/pin-chainage.json` (chainage, lead 10/15/20 m, degree offsets that reproduce the PIN coordinates bit-exactly).
- Kilometre-crossing trigger `pin-chainage-trigger.ts`: fires at `progress ≥ km − lead`, 30 m pass tolerance, safety gates (cross-track ≤ 25 m, heading ≤ 100° at ≥ 3 m/s, ≤ 60 m from the PIN), missed PINs passed silently after 2 confirmations, only the latest relevant PIN is spoken.
- Gating `pin-chainage-flag.ts`: active only when `VERCEL_ENV === 'preview'`; Production bundle strips the activation code (verified: 0 bundle files mention `pinTrigger`). Rollback: `?pinTrigger=legacy` (kept in sessionStorage), `?pinTrigger=chainage` clears it. Locally (dev) the legacy trigger runs.
- PIN coordinates, order, instructions unchanged (migration baseline tests in `src/test/migration-baseline/`, replay harness in `src/test/replay/`).
- Route 5 untouched.

### Audio
- Audio files unchanged: `public/audio/` 30 `.wav` (3 + 27 in `points/`), `src/audio/` 23 `.mp3` (3 + 20) — no file added, removed, renamed or modified vs `fd7b314`.
- Audio modules unchanged in this release (`audio.ts`, `pin-audio.ts`, `audio-normalization.ts`); mapping is by instruction text.
- Local demo verified 2026-11-28: start sound + PIN 1, 2, 3 play (`play()` resolved, files 206).

### Pages: Login, Rules & Terms, consent
- Login: footer and terms box removed; only the required checkbox "ვეთანხმები წესებსა და პირობებს" — never pre-checked; cannot be ticked before the terms are read (window opens; "წავიკითხე" at the end of the text unlocks it); email and Google sign-in both blocked without consent (disabled + handler guard).
- Signed-in Home: small "წესები და პირობები" text link (footer text size) opening the same terms window.
- Terms text: "ონლაინ" and "თელავში/თელავის" removed from sections 1–2; section 1 wording per user; contact phone in section 9 = `579 15 59 75` (footer/contact page keep `597 595 9575`).
- Public pages (pre-existing work in this branch): `/about`, `/contact`, `/pricing`, `/terms`, `/cancellation-refunds`, shared `PublicSiteFooter`.
- Preview Demo: demo home shows the terms link; `/preview-demo/login` renders the real Login screen with demo handlers (no sign-in, no credential storage).
- `LoginPage` split into `LoginView` (screen) + auth wrapper; auth logic unchanged.

### BOG Payment / Supabase (pre-existing work in this branch, included as Preview-intended)
- `api/_lib/bog-payment.ts`, `bog-production.ts` (+ tests) and migrations `028`–`037` + pgTAP tests.
- **Every BOG route (initialize / verify / callback) refuses unless `VERCEL_ENV === 'production'`** (404 "available only in Production"; test `bog-production.test.ts:658`). The BOG code calls the real BOG hosts, so this gate is what keeps Preview from charging.
- Vercel Preview env (checked 2026-11-28, names only): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` → Supabase project `agtcdzxltvtcfxmpnwxr` (the Preview project where BOG SQL 029 + 032–035 were applied). **No BOG keys and no service-role key in Preview.** BOG keys, service role and `PRODUCTION_APP_URL` exist only in Production.
- Not committed (kept untracked locally): `operations/`, `supabase/operations/`, `.github/workflows/cityroute-production-backup.yml`, `CITYROUTE_BOG_FINAL_DELIVERY.md` (Production ops material / contains a user id).

---

## 2. Test results (2026-11-28)

| Check | Result |
| --- | --- |
| TypeScript (`tsc -p tsconfig.json --noEmit`) | pass |
| Lint | **not available** — the project has no ESLint config or dependency |
| Production build (`vite build`) | pass; chainage activation absent |
| Preview build (`VERCEL_ENV=preview vite build`) | pass; chainage activation present |
| Arrow suites (display-progress, vehicle-motion, pipeline simulation, vehicle-glide) | pass |
| Login / Home / demo / public pages / Register | pass (42/42) |
| Full suite | see section 2a |

### 2a. Full suite (`vitest run`, 622 s)

**1068 passed, 35 failed (1103 tests, 100 files).** Compared name-by-name with the baseline captured before this work (36 failures): **no new failures**; one baseline failure now passes ("recovers an expired claim that never reached the bank with one later call").

All 35 failures are pre-existing:

| File | Failed | Note |
| --- | --- | --- |
| `src/lib/exam-session-edge.test.ts` | 16 / 17 | pre-existing (edge exam-session API) |
| `src/components/ExamDriveSession.routes-2-3-resume.test.tsx` | 13 / 110 | pre-existing (Routes 2–3 resume scenarios) |
| `src/lib/audio-headroom.test.ts` | 1 / 4 | pre-existing |
| `src/data/audio-audit.test.ts` | 1 / 9 | pre-existing |
| `src/lib/exam-persistence.merge.test.ts` | 1 / 23 | pre-existing |
| `src/lib/route-arrow-sharp-tips.test.ts` | 1 / 11 | pre-existing |
| `src/lib/route-arrow-pin3-diag.test.ts` | 1 / 3 | pre-existing |
| `src/components/ExamDriveSession.pin-audio.test.tsx` | 1 / 28 | pre-existing ("route-2 PIN 26 plays once …") |

---

## 3. Verified vs not verified

**Verified locally (dev server, browser pane):** demo drive Routes 1–4 end to end at 1× (arrow within ≈ −4…+4 m of the demo car, no backwards moves, no per-frame jumps, smooth heading); starts PIN 1→3 on all four routes; Route 2 PIN 3 hairpin; PIN audio playback in the demo; Login consent flow (desktop + 375 px mobile); terms window scrolling; demo home terms link.

**Not verified yet:** real-phone GPS on the road; production-build frame rate; Google OAuth round-trip on Preview; signed-in Home on Preview with a real account; BOG flow on Preview (expected: refused, 404); behaviour on the deployed Preview URL (to be checked after deploy).

---

## 3b. Follow-up commit (same day)

- Signed-in Home: bottom footer panel (contacts + public links) removed; only the "წესები და პირობები" link remains at the bottom.
- Route pages (not only the demo): the route preview map before starting uses the turquoise navigation line and golden PINs (`RoutePreviewMap navigationStyle`).

## 3a. Deployment record (first Preview deploy)

- Release commit: `1901927` pushed to `origin/preview/design-plus-pin-audio-20261104` (remote head `19019279519f…`); `origin/main` unchanged at `928c0c9`.
- Vercel project `cityroute`: Git-linked to `gogakirvalidze32b-blip/cityroute`, **Production branch `main`**; the push created an automatic **Preview** deployment.
- Preview URL: `https://cityroute-1efuq1j8p-gogas-projects-8280b2a8.vercel.app` — target `preview`, status Ready (Vercel deployment protection: requires Vercel sign-in).
- Latest Production deployment unchanged: `cityroute-dpmdxb68d…` (2026-11-27).
- Checked on the live Preview (via `vercel curl` protection bypass): bundle uses only Supabase `agtcdzxltvtcfxmpnwxr`; contains chainage activation, consent checkbox + "წავიკითხე", terms phone `579 15 59 75`, new line/PIN colours. BOG `initialize` / `verify` / `callback` → **404 "BOG Live payments are available only in Production"**.
- Preview Demo (`/preview-demo`) is **off** in this Preview build: `VITE_PREVIEW_DEMO_MODE` is not set in the Preview environment, so the demo check is compiled out.

## 4. Rollback

- **Chainage only (Preview):** open the app with `?pinTrigger=legacy` → legacy PIN trigger for the session.
- **Whole release on Preview:** in Vercel, promote/redeploy the previous Preview deployment of this branch, or redeploy commit `fd7b314`.
- **Git:** `git revert <release-commit>` on `preview/design-plus-pin-audio-20261104` and push (no force push, no reset).
- **Local untracked files** (scratch scripts, ops notes) were not deleted and are still in the folder.
- Production: nothing to roll back — not deployed, env not changed.
