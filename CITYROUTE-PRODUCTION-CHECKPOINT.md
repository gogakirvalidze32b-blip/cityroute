# CityRoute Production Checkpoint

- Date: 2026-11-06
- Branch: `preview/design-plus-pin-audio-20261104`
- Source commit at preview verification: `0c4e2ed7ee2b73390071f4529d3ae57fb5ccff`
- Preview project: `cityroute-vite-preview`
- Production project: `cityroute`
- Production domain: `cityroute.ge`

## Final route changes

- Route 1 PIN 32: `41.933707, 45.477971`
- Route 2 PIN 26: `41.933707, 45.477971`
- Route 3 PIN 28: `41.933707, 45.477971`
- Route 4 PIN 29: `41.933707, 45.477971`
- Removed the ROUNDABOUT gate from Route 1 PIN 32, Route 2 PIN 26, and Route 4 PIN 29.
- Preserved standard sequential activation for the four pins and prevented repeated activation of passed pins.
- Final right-turn instruction audio uses a 10 m trigger radius for these four pins.
- Other PIN audio trigger distances remain 20 m.

## Exam lifecycle and navigation

- Continue restores elapsed time, passed PINs, current PIN, error counts, start mode, pending audio, and route state without creating a new exam.
- Finish preserves the final timestamp and result data until the summary is reliably saved; completed sessions do not remain resumable.
- New exam clears progress only through the explicit restart action.
- Refresh and remount restore active route saves, including route-scoped Route 2 ID-to-UUID progress.
- GPS gaps and route refresh do not cause passed PINs to repeat.
- Active exams block Exit, browser history, and Back navigation away from the route.
- Exit attempts show: `გთხოვთ, დაასრულოთ მარშრუტი და შემდეგ გამოხვიდეთ.`
- Menu navigation is available after successful finalization and summary persistence.

## Speed-limit HUD

- The speed-limit sign is positioned on the left in its previous location.
- The timer, `km/h`, speed value, and responsive layout remain unchanged.

## Verification

- PIN/audio/location and relocation suites: 55 tests passed.
- Route 2/3 resume component suite: 93 tests passed.
- Demo navigation guard suite: 3 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Preview deployment

- Preview deployment ID: `dpl_EB1jeJ9w4Ymk3hMjrC93PEZsq5sg`
- Preview URL: https://cityroute-vite-preview-2mm5r0wy2-gogas-projects-8280b2a8.vercel.app
- Preview project: `cityroute-vite-preview`
- Preview target: Preview, ready state `READY`
- Production deployment was not used for the Preview upload.

## Production deployment

- Vercel project: `cityroute`
- Vercel project ID: `prj_HYruSM96EoyTjeeNNFZyGYEMf0kd`
- Production deployment ID: `dpl_6Gyo5h9vYaahAcpRheUfjAzw3b2L`
- Production deployment URL: https://cityroute-5hs6vghru-gogas-projects-8280b2a8.vercel.app
- Aliased production domain: https://cityroute.ge
- Production deployment status: `READY`
- Production deployment date: 2026-11-06
- Vercel target: `production`
- Branch source used by the local deployment workflow: `preview/design-plus-pin-audio-20261104`
- Preview and production project separation was verified; only the main `cityroute` project was deployed to production.
- Production domain: `cityroute.ge`
- Environment variables, Supabase configuration, and payment configuration were not modified.
