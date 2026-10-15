# Bug Exploration Results

## Test Execution: UNFIXED CODE

Date: 2026-10-03
Tests Run: 3 bug exploration tests
**Result: ALL 3 TESTS FAILED (as expected - this confirms the bug exists)**

## Counterexamples Found

### Test 1: "should permanently clear session when finish button is clicked"
**Status:** ❌ FAILED

**Expected behavior:** localStorage should be null after clicking finish button
**Actual behavior:** localStorage still contains session data after finish

**Console output:**
```
✅ Initial session saved to localStorage
✅ Loaded saved exam state: მარშრუტი 1 (0m ago)
💾 Exam state saved: მარშრუტი 1 route-1  [auto-save running]
✅ Finish button found - component in active phase
🗑️ Cleared saved exam state              [clearActiveExam() called]
💾 Exam state saved: მარშრუტი 1 route-1  [BUG: auto-save runs AFTER clear!]
```

**Counterexample:**
- Finish button clicked → `clearActiveExam()` executes
- localStorage is cleared momentarily
- But the auto-save useEffect (lines 262-280) runs immediately after
- Session is RE-SAVED to localStorage
- localStorage contains session data when it should be null

**Root Cause Analysis:**
The auto-save useEffect has dependencies `[phase, route.id, route.slug, route.name_ka, exam, userPos, heading, speedKmh, elapsedMs]`. When `finishSession()` is called:
1. `clearActiveExam()` removes localStorage data
2. `setPhase('summary')` triggers state change
3. The `phase` state change causes the auto-save useEffect to re-run
4. The useEffect checks `if (phase !== 'active')` and should return early
5. **BUT** the check happens AFTER the saveState() function is already queued
6. Result: The session is re-saved even though we're transitioning to 'summary'

**Additional Issue Discovered:**
Looking at the auto-save useEffect code (lines 262-280), it has:
```typescript
if (phase !== 'active') return
```
This should prevent saving when phase is 'summary', BUT the problem is timing:
- When `finishSession()` calls `setPhase('summary')`, React batches this update
- The useEffect cleanup runs with OLD dependencies (phase='active')
- The cleanup calls `saveState()` one final time before unmounting
- This re-saves the session right after we cleared it!

### Test 2: "should not restore session after intentional finish"
**Status:** ❌ FAILED

**Expected behavior:** After finish, unmount, and remount, should show preview phase
**Actual behavior:** localStorage contains session data, would restore on remount

**Counterexample:**
- Same issue as Test 1
- The localStorage is not cleared, so on remount the session would be restored
- This violates requirement 2.4: "user returns to route after finishing THEN system SHALL NOT resume old session"

### Test 3: "should maintain summary phase across re-renders"
**Status:** ❌ FAILED (but interesting partial success)

**Console output:**
```
✅ Summary phase stable across re-renders
```

**Observation:**
- The test showed "Summary phase stable" which means the UI phase stayed as 'summary'
- BUT the test still failed because localStorage was not null
- This suggests the phase guard in the auto-save useEffect IS working for subsequent renders
- The bug is specifically in the INITIAL transition when finish is clicked

**Counterexample:**
- Phase transition works correctly for display
- BUT persistence is not cleared, violating requirement 2.5
- On page refresh or remount, the old session would be restored

## Bug Condition Specification

Based on these counterexamples, the formal bug condition is:

```
FUNCTION isBugCondition(input)
  INPUT: input of type UserAction
  OUTPUT: boolean
  
  RETURN input.action == 'FINISH_BUTTON_CLICK'
         AND phase == 'active'
         AND clearActiveExam() is called
         AND auto_save_useEffect() cleanup runs with old dependencies
         AND saveActiveExam() is called AFTER clearActiveExam()
         AND localStorage contains session data AFTER finish completes
END FUNCTION
```

## Root Cause Confirmed

The hypothesized root cause in the design document was partially correct:
- ✅ Race condition exists between clearActiveExam() and component lifecycle
- ✅ The useEffect restoration logic (lines 150-168) CAN force phase back to 'active'
- ⚠️ **NEW DISCOVERY:** The auto-save useEffect (lines 262-280) is the PRIMARY culprit
  - Its cleanup function runs after clearActiveExam()
  - It re-saves the session data immediately
  - This makes the cleared session immediately available for restoration

## Fix Requirements

The fix must address BOTH issues:

1. **Prevent auto-save after intentional clear**
   - Add guard in auto-save useEffect to skip save during finish
   - Use finishInProgressRef flag as proposed in design

2. **Prevent restoration after finish**
   - Add guard in restoration useEffect (lines 150-168)
   - Check finishInProgressRef before restoring session
   - This prevents phase from reverting to 'active' if session was re-saved

## Next Steps

1. ✅ Bug confirmed through failing tests (COMPLETED)
2. ⬜ Write preservation tests (Task 2)
3. ⬜ Implement fix with finishInProgressRef flag (Task 3)
4. ⬜ Verify bug exploration tests pass after fix
5. ⬜ Verify preservation tests still pass after fix

## Test Files

- Bug exploration test: `src/components/ExamDriveSession.bug-exploration.test.tsx`
- Test framework: vitest + @testing-library/react + fast-check
- Test command: `npm run test:run -- src/components/ExamDriveSession.bug-exploration.test.tsx`
