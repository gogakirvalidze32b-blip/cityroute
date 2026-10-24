# CityRoute Work Checkpoint

Last updated: 2026-10-23 03:01 +04:00

## Current Git state

- Working directory: `C:\Users\For Home\Desktop\cityroute-speed-limit-preview`
- Branch: `preview/speed-limit-fix`
- HEAD: `4e90364fdabfc1491fe5c1db154b27107192b616`
- HEAD subject: `Fix route sequencing, resume, and voice gain`
- The worktree is dirty. Existing user changes and untracked files are present; do not discard, restore, stage, commit, or overwrite them without explicit authorization.
- No commit, push, or deployment was made.
- This checkpoint file is newly added and was not included in the previously successful build or test run.

## Work completed in the current task

The active runtime route data comes from `src/data/route-1-official.json` for Route 1, and `src/data/audio-audit-pins.fixture.json` for Routes 2–4. The four runtime routes in `src/data/telavi-routes.ts` use a shared final instruction sequence via `src/data/route-finish.ts`.

### Route 1 PIN coordinate updates

Coordinates below were read from the current `route-1-official.json` after the changes. The audit fixture contains corresponding Route 1 rows for regression auditing.

| PIN | Current latitude | Current longitude | Status |
|---|---:|---:|---|
| #5 | 41.926265 | 45.472910 | Updated |
| #10 | 41.924657 | 45.460514 | Updated; relocation mapping also updated |
| #22 | 41.918685 | 45.484366 | Updated |
| #23 | 41.918588 | 45.483955 | Kept as #23; instruction changed as requested |
| #24 | 41.918155 | 45.481760 | Reassigned to #24 |
| #26 | 41.918213 | 45.473228 | Updated from additional coordinate change A |
| #31 | 41.932953 | 45.477635 | Updated from additional coordinate change B |
| #32 | 41.933733 | 45.477972 | Updated from additional coordinate change C |

Route 1 #23 text is `შემდეგ მინიშნებამდე იმოძრავეთ პირდაპირ`; an explicit mapping to the existing direct-ahead WAV was added. The source audio files were not changed.

### Route 2 PIN updates

Current values from the route 2 rows in `audio-audit-pins.fixture.json`:

| PIN | Current latitude | Current longitude | Status |
|---|---:|---:|---|
| #3 | 41.931130 | 45.476467 | Retained; distinct from #25 |
| #12 | 41.920923 | 45.500863 | Updated |
| #17 | 41.918890 | 45.485221 | Updated |
| #20 | 41.918213 | 45.473228 | Updated |
| #25 | 41.933312 | 45.477867 | Retained; distinct from #3 |

The request described #3/#25 as sharing or having similar coordinates. In the current fixture, #3 is at `41.931130, 45.476467` and #25 is at `41.933312, 45.477867`; they are not duplicates. No replacement coordinate for #25 was explicitly given, so its existing position was preserved. Regression coverage checks their individual sequence positions and audio mappings.

### Route 3 PIN updates and #12 gate

Current values from `audio-audit-pins.fixture.json`:

| PIN | Current latitude | Current longitude | Status |
|---|---:|---:|---|
| #11 | 41.918278 | 45.482804 | Updated |
| #12 | 41.918300 | 45.482891 | Updated; gated to the later pass |
| #17 | 41.927579 | 45.457432 | Updated |
| #18 | 41.926853 | 45.455832 | Updated |
| #22 | 41.924907 | 45.466812 | Updated |
| #24 | 41.925079 | 45.470325 | Updated |

The user confirmed using Route 3's later route-trace pass as the #12 gate. Current implementation allows #12 when its progress on the bundled Route 3 trace reaches `u >= 256`; it rejects the earlier overlapping pass. The trace-based gate is covered by a targeted integration regression test. Its behavior still needs GPS verification on a real device and at the actual roundabout.

### Additional coordinate corrections assigned to Route 4

The three extra old coordinates uniquely matched current Route 4 fixture entries. The corresponding new values are:

| PIN | Current latitude | Current longitude |
|---|---:|---:|
| #10 | 41.918817 | 45.486591 |
| #12 | 41.919399 | 45.499970 |
| #14 | 41.919945 | 45.500247 |

This assignment was based on exact coordinate matches in the current fixture, not inferred from nearby route geometry.

### Shared finish behavior

- `src/data/route-finish.ts` defines one shared ordered sequence for the last seven PIN instructions on Routes 1–4 and a shared finish-section start-index helper.
- `src/data/telavi-routes.ts` applies that sequence to all four routes. PIN coordinates, PIN order, and instructions before the final seven PINs are not replaced by this helper.
- `src/components/ExamDriveSession.tsx` uses the shared helper for its existing finish-section gating, which remains the final three PINs on each route.
- The existing finish audio resolver maps `ფინიში` to the shared `ფინიში.wav`. No MP3/WAV source files were modified.

## Task-related files changed

- `src/data/route-1-official.json`
- `src/data/audio-audit-pins.fixture.json`
- `src/data/telavi-routes.ts`
- `src/data/route-finish.ts` (new)
- `src/data/route-finish.test.ts` (new)
- `src/data/route-1-voice.ts`
- `src/data/audio-audit.test.ts`
- `src/hooks/useRoutes.ts`
- `src/components/ExamDriveSession.tsx`
- `src/components/ExamDriveSession.routes-2-3-resume.test.tsx`
- `src/lib/pin-audio.ts`
- `src/lib/pin-audio.test.ts`
- `src/lib/relocated-pins.test.ts`

Some listed files also contain earlier uncommitted changes unrelated to this task. The working diff was not treated as exclusively authored by this task. Payment/Supabase changes and other unrelated edits were left untouched.

## Verification results

Most recent focused verification, completed before this checkpoint was created:

- `npm run test:run -- src/data/route-finish.test.ts src/data/audio-audit.test.ts src/lib/pin-audio.test.ts src/lib/relocated-pins.test.ts src/components/ExamDriveSession.pin-audio.test.tsx src/components/ExamDriveSession.routes-2-3-resume.test.tsx src/lib/speed-limit.test.ts`
  - Passed: 7 test files, 160 tests.
- `npx tsc --noEmit`
  - Passed.
- `npm run build`
  - Passed. Vite emitted a chunk-size warning for a minified JavaScript chunk larger than 500 kB.
- `git diff --check`
  - Passed; Git emitted a line-ending (LF/CRLF) warning for `ExamDriveSession.tsx`.

These checks were run before the checkpoint file was created. They do not validate this Markdown file, and no tests/build were repeated solely for this documentation change.

## Historical failures and stale reports

- An earlier full-suite run was reported as 422/432 passing, with 10 failures; the old failures included Tbilisi-specific tests and route-trace/start-PIN simulation assertions. This is historical information, not the result of the latest focused run.
- A later targeted run without Tbilisi was reported as 186/187 passing. The remaining historical failure was a Route 2 road-line threshold assertion expecting `41.9309` while the trace point was `41.930611`. Do not change route geometry or weaken that assertion solely to make it pass; investigate road correctness first if it is in scope.
- The user explicitly said the Tbilisi test is not used; do not treat its historical failure as a new application defect or edit it unless asked.
- `TEST_SUMMARY.md` currently describes a separate speed-limit diagnostic and says tests “should pass”; it is not evidence of the latest route/audio tests. Do not use it in place of command results above.
- The earlier speed-limit-focused suite was reported as 61/61 passing. In the latest task-specific run, the speed-limit suite was included in the 160-test passing command.

## Remaining work and next step

1. No further code change is currently required by the coordinate and shared-finish request. Real-device validation remains outstanding: GPS behavior, Route 3 #12 at the roundabout, audible ordering, and clipping/distortion risk.
2. Before any Preview upload, verify the Vercel project's Git integration, the configured Production branch, and Preview branch settings. Those Vercel settings were not inspected or confirmed in this task.
3. The current branch is `preview/speed-limit-fix`. A push of that branch can create a Vercel Preview deployment only if the linked Vercel project is configured to treat it as a non-Production branch. This behavior is not yet confirmed here; do not assume it is safe without checking the project settings.
4. Wait for explicit user approval before staging/committing, pushing, or deploying. Do not alter the Production branch or environment.

## Constraints for continuation

- Do not delete, revert, restore, or overwrite any uncommitted or untracked file.
- Do not modify unrelated payment/Supabase work, user data, audio assets, or route data beyond the explicit requested PIN changes.
- Do not commit, push, or deploy without explicit user approval.
- When continuing, re-check `git status`, branch, and this checkpoint against the current worktree first. This checkpoint does not replace checking actual current files.
