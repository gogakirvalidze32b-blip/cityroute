# CityRoute Checkpoint — 2026-10-29

## Repository state at checkpoint

- Worktree: `C:\Users\For Home\Desktop\cityroute-integration-pin-audio-preview-20261029`
- Source branch: `preview/integration-pin-audio-resume-20261029`
- Source HEAD: `2c1415fc142587ba835c6773f66eb224d3888486`
- Source commit: `fix: update requested route PIN coordinates`
- Before creating this checkpoint file, `git status --short --branch` was clean and there were no staged, unstaged, or untracked files.
- The source branch tracks `origin/preview/integration-pin-audio-resume-20261029` at the same commit.

## PIN coordinate changes in the source commit

The last source commit changed only the route-coordinate fixture/source, local stale-coordinate rewrite, and related coordinate regression test:

- `src/data/audio-audit-pins.fixture.json`
- `src/data/route-1-official.json`
- `src/hooks/useRoutes.ts`
- `src/lib/relocated-pins.test.ts`

Coordinates recorded by the commit:

- Route 1 PIN 2: `41.931144, 45.476199` → `41.930935, 45.476066`.
- Route 1 PIN 32: `41.933733, 45.477972` → `41.933897, 45.478101`.
- Route 2 PIN 2: `41.931068, 45.476164` → `41.930982, 45.476086`.
- Route 2 PIN 26: `41.933177, 45.477598` → `41.933897, 45.478101`.
- Route 3 PIN 2: `41.931144, 45.476199` → `41.930935, 45.476066`.
- Route 3 PIN 28: `41.933177, 45.477598` → `41.933897, 45.478101`.
- Route 4 PIN 2: `41.931144, 45.476199` → `41.930935, 45.476066`.
- Route 4 PIN 10: `41.918817, 45.486591` → `41.918919, 45.486113`.
- Route 4 PIN 29: `41.933177, 45.477598` → `41.933897, 45.478101`.

PIN numbering, instructions, and audio mappings were preserved. The requested old coordinate `41.933177, 45.477598` did not identify a Route 1 PIN. The user clarified that Route 1's intended point was PIN 32 (`41.933733, 45.477972`), which was updated to the requested new coordinate.

## Validation

After the final coordinate and relocation-test updates:

- Targeted tests: 5 test files, 83 tests passed:
  - `src/data/audio-audit.test.ts`
  - `src/components/ExamDriveSession.routes-2-3-resume.test.tsx`
  - `src/components/RoutePreviewMap.test.tsx`
  - `src/data/route-finish.test.ts`
  - `src/lib/relocated-pins.test.ts`
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; Vite printed the existing large-chunk advisory.
- `git diff --check`: passed before the source commit.
- The old target coordinate pair was confirmed absent from `src`.

## Preview and Production observations

- Source commit `2c1415fc142587ba835c6773f66eb224d3888486` was pushed to the Preview source branch.
- Preview deployment:
  - Deployment ID: `dpl_2WkpP6BjMkpJP3KGjmneYrku3dQB`
  - URL: `https://cityroute-cwrpxdyi2-gogas-projects-8280b2a8.vercel.app/`
  - State: `READY`
  - Commit SHA: `2c1415fc142587ba835c6773f66eb224d3888486`
- Vercel inspection also showed a `target=production`, `READY` deployment from the same commit:
  - Deployment ID: `dpl_8Sz17mvYBJPzmxQSm6pHP6Gpku9Q`
  - Deployment URL: `https://cityroute-7444c54zp-gogas-projects-8280b2a8.vercel.app/`
  - Vercel listed `cityroute.ge`, `www.cityroute.ge`, and `cityroute-telavi.vercel.app` as aliases for it; inspecting `https://cityroute.ge` resolved to that deployment.
- The push command targeted only the Preview branch. No Production deployment command was run in this task. The Vercel Production-target observation above remains important and should not be mistaken for an intentional Production deploy by this checkpoint task.
- No migration was run.

## Other pending requests

- The temporary 99 GEL → 0.99 GEL request was not implemented. The client label and server-side BOG amount are separate: the server currently sets 99/179 GEL, and the existing payment validation/migration permits those amounts. Changing only the displayed price would not change the actual charged amount.
- No UI price, BOG logic, ENV, Supabase configuration, GPS/Camera behavior, or audio files were changed in the coordinate commit.

## Next safe steps

1. Review the complete four-file coordinate commit diff and verify every intended PIN ID/order and coordinate before any Production action.
2. **Do not upload to Production until the complete coordinate diff has been reviewed.**
3. Keep the 0.99 GEL test separate. Do not display it as a payable amount unless the server-side amount and payment validation are safely addressed and the payment environment is explicitly confirmed as a sandbox.
4. Do not run migrations or alter BOG, ENV, Supabase, route audio, GPS/Camera, or unrelated route data without separate approval.

## Checkpoint branch

This file is intended to be committed on a separate checkpoint branch based on the source HEAD above. The checkpoint commit should add only this Markdown file; it must not alter or replace the source branch's PIN-coordinate commit.
