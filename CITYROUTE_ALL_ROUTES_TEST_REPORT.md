# CityRoute — Auto / Manual resume & device check

**Date:** 2026-11-14  
**Tree:** `cityroute-preview-design-pin-audio-20261104` (local preview only)  
**Scope:** Field-test routes 1–4 · Auto + Manual · phone/tablet preview

## Verdict

Auto and Manual keep mid-route progress on **დასრულება**. Auto **დაწყება** / **გაგრძელება** resume from the live GPS nearest unfinished PIN (not PIN 1). Explicit **თავიდან / ახალი** still clears progress.

## Behaviour locked in

| Case | Result |
|------|--------|
| Auto finish @15 → progress kept | Yes (`1…15` in storage) |
| გაგრძელება with GPS @17 | Next PIN **17**; gap-fill `16` only |
| დაწყება with saved progress + GPS ahead | Nearest unfinished PIN |
| დაწყება without GPS | Sequential next PIN |
| თავიდან / ახალი | Clears pins; fresh GPS may pick nearest |
| Manual pin pick | Unchanged; no Auto GPS jump |

## Automated checks

- `vitest` auto-start + resume + demo panel: **pass** (110+ resume suite, demo panel OK)
- `tsc --noEmit`: **pass**
- `npm run build`: **pass**

## Browser (phone 390×844 + tablet 768×1024)

Preview demo `/preview-demo/route/route-1`:

1. Mid-route **დასრულება** → summary showed **გავლილი PIN-ები: 15**; storage `[1…15]` (not cleared).
2. Set demo GPS to PIN 17 → **გაგრძელება** → instruction **შემდეგი - PIN 17**; storage `[1…16]`.
3. UI readable on phone and tablet viewports.

## Notes

- Demo GPS now publishes on საწყისი PIN change (exact pin chainage) so Auto Start/Continue can resolve like a real device.
- Real phone/tablet GPS uses the same `resolveAutoStart` / `continueFromSummary` path.
- No prod deploy / push / SQL / ENV changes.
