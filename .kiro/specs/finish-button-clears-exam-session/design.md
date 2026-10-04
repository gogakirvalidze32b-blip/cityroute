# Finish Button Clears Exam Session - Bugfix Design

## Overview

The "დასრულება" (Finish) button fails to permanently terminate active exam sessions due to a race condition between the persistence clearing logic and the component's lifecycle hooks. When `finishSession()` clears localStorage via `clearActiveExam()`, the `useEffect` that monitors route changes (dependencies: `[route.id, route.slug, route.name_ka, sortedPins, features.mapNav]`) runs afterward and re-detects the cleared session through `loadActiveExam()` or `hasSavedExamForSlug()`, forcing the phase back to 'active'. This creates an infinite loop where the exam appears to finish but immediately resumes.

The fix uses a **finish-in-progress ref flag** to suppress the session restoration logic during intentional finish operations, ensuring `clearActiveExam()` takes immediate effect while preserving the critical Home → Return resume behavior.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when the finish button is clicked and clears localStorage but the useEffect restoration logic races to reload the session
- **Property (P)**: The desired behavior when finish is clicked - the session must be permanently cleared and phase must remain 'summary' without being overridden
- **Preservation**: The Home → Return resume behavior that must continue working exactly as before (load saved session, restore state, continue exam)
- **finishSession()**: The function in `src/components/ExamDriveSession.tsx` (line ~430) that transitions the exam to summary phase and should clear persistence
- **clearActiveExam()**: The function in `src/lib/exam-persistence.ts` that removes the saved exam state from localStorage
- **useEffect restoration logic**: The useEffect at lines 150-168 in ExamDriveSession.tsx that detects and restores saved sessions when route changes or component remounts
- **resumedSlugRef**: A ref tracking the currently resumed slug, used to prevent duplicate hydration on the same route
- **Race condition**: The useEffect fires after finishSession() clears localStorage, but before React commits the phase change to DOM, allowing stale session detection

## Bug Details

### Bug Condition

The bug manifests when a user clicks the "დასრულება" button during an active exam session. The `finishSession()` function calls `clearActiveExam()` to remove saved state from localStorage and then sets `phase` to 'summary'. However, because `clearActiveExam()` triggers a React state update, the component's useEffect (with dependencies `[route.id, route.slug, route.name_ka, sortedPins, features.mapNav]`) runs before the phase change fully commits. This useEffect calls `hasSavedExamForSlug(route.slug)` which may still detect the session (timing-dependent), causing it to call `setPhase('active')` and overriding the intended 'summary' phase.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type UserAction
  OUTPUT: boolean
  
  RETURN input.action == 'FINISH_BUTTON_CLICK'
         AND phase == 'active'
         AND clearActiveExam() is called
         AND useEffect_restoration_logic() executes before phase transition completes
         AND hasSavedExamForSlug() returns true (race-dependent)
         AND setPhase('active') overrides setPhase('summary')
END FUNCTION
```

### Examples

- **Example 1**: User completes Route 1 exam, clicks "დასრულება", sees summary screen flash briefly, then exam resumes to active phase with the same state (elapsed time, triggered pins, errors preserved)
- **Example 2**: User fails Route 2 exam with severe errors, clicks "დასრულება", summary briefly shows "გაიმეორე" button, then immediately returns to active driving session as if finish never happened
- **Example 3**: User clicks finish, localStorage.removeItem() executes successfully, but 50ms later the useEffect runs and sees the stale cached reference, calls setPhase('active'), and exam resumes
- **Edge case**: Very fast finish clicks (double-click) may trigger multiple race conditions, with useEffect running multiple times and potentially seeing inconsistent localStorage state

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Home → Return resume behavior must continue to work: navigating away from the active exam (to Home or another route) and then returning to the same route slug MUST restore the exact session state (elapsed time, triggered pins, user position, heading, GPS status)
- Valid active exams in localStorage (< 24 hours old, matching route slug) MUST automatically resume when returning to the route
- The `restartPreview()` function must continue to clear saved state and present a fresh preview phase
- Component mount with a saved session for a matching route slug/id MUST hydrate state variables (exam, userPos, heading, speedKmh, elapsedMs, triggeredPins) exactly once per slug
- GPS watch, audio playback, pin triggering, error recording, and all other active exam features must remain completely unaffected
- The finish button transitions to 'summary' phase with ExamSummary display (score, errors, restart option) must remain unchanged
- Success audio playback on passing exams must continue working

**Scope:**
All inputs that do NOT involve clicking the "დასრულება" (Finish) button should be completely unaffected by this fix. This includes:
- Navigating Home during active exam and returning (MUST restore session)
- Starting a new exam from preview
- Resuming an existing saved session from preview
- All GPS, audio, pin, error, and map functionality during active exam
- Restarting from summary view via `restartPreview()`

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

1. **React State Update Timing**: The `clearActiveExam()` call in `finishSession()` removes localStorage data, but React's state update batching means the `phase` change to 'summary' hasn't committed to the component state yet. When the useEffect runs (triggered by dependency changes or re-render), it still sees a condition where it should attempt restoration.

2. **useEffect Dependency Over-Triggering**: The useEffect has dependencies `[route.id, route.slug, route.name_ka, sortedPins, features.mapNav]`. Some of these may change or reference-change during the finish transition, causing the effect to re-run at an inopportune time.

3. **Missing Guard for Intentional Clears**: The restoration logic in useEffect (lines 150-168) lacks a guard to distinguish between:
   - **Legitimate resume**: User navigated away and returned (SHOULD restore session)
   - **Intentional finish**: User clicked finish button (SHOULD NOT restore session)
   
   Currently, `resumedSlugRef` prevents duplicate hydration for the same slug, but does NOT prevent restoration after an intentional clear.

4. **Cached Session Detection**: `hasSavedExamForSlug()` or `loadActiveExam()` may be reading from a cached reference or stale closure state, returning true even after `localStorage.removeItem()` has executed.

## Correctness Properties

Property 1: Bug Condition - Finish Button Permanently Clears Session

_For any_ user action where the "დასრულება" (Finish) button is clicked during an active exam session, the fixed `finishSession()` function SHALL permanently clear the active exam session from localStorage AND set phase to 'summary' AND prevent any subsequent useEffect restoration logic from overriding the 'summary' phase by re-detecting or restoring the cleared session.

**Validates: Requirements 2.1, 2.2, 2.3, 2.5**

Property 2: Preservation - Home → Return Resume Behavior

_For any_ user action where the user navigates away from an active exam (to Home or another route) and then returns to the same route, the fixed code SHALL produce exactly the same behavior as the original code, preserving the session restoration logic that loads the saved exam state and resumes the session at the exact point where the user left off (elapsed time, triggered pins, user position, heading, speed, GPS status).

**Validates: Requirements 3.1, 3.2, 3.4, 3.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct (missing guard for intentional finish):

**File**: `src/components/ExamDriveSession.tsx`

**Function**: `finishSession()` (line ~430) and useEffect restoration logic (lines 150-168)

**Specific Changes**:

1. **Add finishInProgressRef flag**: Introduce a new ref `const finishInProgressRef = useRef(false)` to track when a finish operation is in progress. This acts as a guard to suppress restoration logic during intentional clears.

2. **Set flag before clearing in finishSession()**: 
   ```typescript
   function finishSession() {
     finishInProgressRef.current = true  // NEW: Set flag before clear
     clearActiveExam()                    // Existing: Clear localStorage
     const summary = finishExamSession(exam)
     saveExamSummary(summary)
     setExamSummary(summary)
     setPhase('summary')
     releaseWake.current?.()
     audioEngine.stopAll()
     resumedSlugRef.current = null
     // ... success audio logic
   }
   ```

3. **Guard useEffect restoration logic**: Add an early return in the useEffect (after line 150) to skip restoration when finish is in progress:
   ```typescript
   useEffect(() => {
     // NEW: Skip restoration if finishing
     if (finishInProgressRef.current) {
       finishInProgressRef.current = false  // Reset flag
       return
     }
     
     // Existing restoration logic...
     const saved = loadActiveExam(route.id, route.slug)
     // ... rest of effect
   }, [route.id, route.slug, route.name_ka, sortedPins, features.mapNav])
   ```

4. **Reset flag in restartPreview()**: Ensure the flag is reset when restarting to prevent interference with future sessions:
   ```typescript
   function restartPreview() {
     finishInProgressRef.current = false  // NEW: Reset flag
     setPhase('preview')
     // ... existing restart logic
     clearActiveExam()
   }
   ```

5. **Alternative implementation consideration**: If the ref flag approach proves insufficient, a secondary approach would be to check the current `phase` value in the useEffect before attempting restoration:
   ```typescript
   useEffect(() => {
     if (phase === 'summary') return  // Don't restore when viewing summary
     // ... existing restoration logic
   }, [phase, route.id, route.slug, route.name_ka, sortedPins, features.mapNav])
   ```
   However, this requires adding `phase` to the dependency array, which may cause additional re-runs. The ref flag approach is preferred as it's more surgical.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code (finish button fails to clear session), then verify the fix works correctly (finish permanently clears) and preserves existing behavior (Home → Return resume still works).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm the root cause analysis (race condition between clearActiveExam and useEffect restoration).

**Test Plan**: Manually test the finish button on unfixed code in multiple scenarios. Observe localStorage state and React component phase transitions using browser DevTools. Run these tests on the UNFIXED code to observe the failure pattern and confirm the race condition.

**Test Cases**:
1. **Basic Finish Test**: Start Route 1 exam, trigger 2 errors, click "დასრულება" → EXPECT: Summary shows briefly, then exam resumes to active phase (will fail on unfixed code)
2. **Rapid Finish Click**: Start exam, immediately click finish → EXPECT: Session clears then immediately restores (will fail on unfixed code)
3. **Finish After GPS Updates**: Start exam, wait for 5+ GPS position updates, click finish → EXPECT: Exam resumes with preserved GPS state (will fail on unfixed code)
4. **Finish With Multiple Pins Triggered**: Trigger 3+ pins, click finish → EXPECT: Session clears but triggeredRef is restored when exam resumes (will fail on unfixed code)
5. **localStorage Inspection**: Add console.log in clearActiveExam() and loadActiveExam() to observe timing → EXPECT: clearActiveExam() executes, then loadActiveExam() runs 50-200ms later and finds stale data (will fail on unfixed code)

**Expected Counterexamples**:
- The phase transitions from 'active' → 'summary' → 'active' within 1 second
- localStorage.getItem('cityroute-active-exam') returns null immediately after finish, then returns a valid object 100ms later (stale closure/cache)
- Console logs show: "🗑️ Cleared saved exam state" followed by "✅ Loaded saved exam state" within same tick
- Possible causes: useEffect dependency array triggers re-run, React state batching delays phase commit, stale closure in useEffect captures old localStorage value

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (finish button click during active exam), the fixed function produces the expected behavior (session permanently cleared, phase remains 'summary').

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := finishSession_fixed(input)
  ASSERT phase == 'summary'
  ASSERT localStorage.getItem('cityroute-active-exam') == null
  ASSERT useEffect does NOT call setPhase('active')
  ASSERT examSummary is displayed
  ASSERT no session restoration occurs within 5 seconds
END FOR
```

**Test Plan**: Implement the fix (finishInProgressRef flag), then repeat all exploratory test cases and verify the finish operation works correctly.

**Test Cases**:
1. **Basic Finish Verification**: Start Route 1 exam, trigger errors, click finish → ASSERT: Phase remains 'summary', localStorage cleared, summary displayed permanently
2. **Multiple Finish Scenarios**: Test finish at various points (immediately after start, mid-session, after all pins triggered) → ASSERT: All scenarios clear session permanently
3. **Finish + Refresh**: Click finish, wait 2 seconds, refresh page → ASSERT: No saved session exists, route starts in preview phase
4. **Finish + Navigate Away + Return**: Click finish → navigate Home → return to route → ASSERT: Route starts in preview (no session restoration)

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (Home → Return resume, normal session start, restart from summary), the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT finishSession_fixed_behavior(input) = original_behavior(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (different routes, different session states, different timing)
- It catches edge cases that manual unit tests might miss (e.g., sessions saved with different elapsedMs values, different routeSlug formats)
- It provides strong guarantees that behavior is unchanged for all non-finish inputs

**Test Plan**: Observe Home → Return resume behavior on UNFIXED code first to establish baseline, then write property-based tests capturing that exact behavior and verify it continues after the fix.

**Test Cases**:
1. **Home → Return Resume**: Start Route 1 exam → trigger 2 pins → navigate Home → return to Route 1 → ASSERT: Session restores with exact state (2 pins triggered, elapsed time continues, same errors)
2. **Cross-Route Navigation**: Start Route 1 exam → navigate to Route 2 → return to Route 1 → ASSERT: Route 1 session restores correctly
3. **Restart from Summary**: Finish exam (with fix applied) → click "დაიწყე თავიდან" → ASSERT: Preview phase, no saved session, fresh start
4. **Session Expiry Preservation**: Save a session with `savedAt` timestamp 25 hours ago → reload page → ASSERT: Expired session is ignored, route starts in preview
5. **Slug Match Preservation**: Save session with `routeSlug: 'route-1'` → navigate to same route with Supabase UUID → ASSERT: Session restores via slug match (critical for local-route-* → UUID migration)
6. **Multiple Session Save Cycles**: Start exam → wait 5s (auto-save) → trigger pin → wait 5s (auto-save) → navigate Home → return → ASSERT: Latest state restored with all pins
7. **GPS State Preservation**: Start exam → wait for GPS lock → get 10+ position updates → navigate Home → return → ASSERT: GPS continues from last position, watch continues running

### Unit Tests

- Test `finishInProgressRef` flag is set to true when `finishSession()` is called
- Test useEffect early return executes when flag is true
- Test flag is reset after useEffect runs
- Test `clearActiveExam()` removes localStorage entry
- Test phase transitions from 'active' → 'summary' without intermediate state
- Test `restartPreview()` resets the finishInProgressRef flag

### Property-Based Tests

- Generate random exam states (different routes, elapsed times, triggered pins, error counts) → call finishSession() → verify session is cleared and phase is 'summary' in all cases
- Generate random navigation sequences (Home → Return, cross-route navigation) → verify session restoration works correctly in all cases
- Generate random timing delays between finish and subsequent useEffect runs → verify flag prevents restoration regardless of timing

### Integration Tests

- **Full Finish Flow**: Start exam → trigger errors → trigger pins → click finish → verify summary displays → verify localStorage cleared → verify no restoration occurs → refresh page → verify preview phase
- **Finish + Restart Flow**: Finish exam → view summary → click restart → verify preview phase → start new exam → verify fresh session
- **Home → Return Resume Flow**: Start exam → navigate Home → return → verify session restored → continue exam → finish → verify clears correctly
- **Multi-Route Session Management**: Start Route 1 exam → navigate to Route 2 → start Route 2 exam → navigate back to Route 1 → verify Route 1 session (not Route 2) is restored
