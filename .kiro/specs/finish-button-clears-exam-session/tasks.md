# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Finish Button Clears Session Permanently
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists (finish button clicked but session resumes)
  - **Scoped PBT Approach**: Scope the property to the concrete failing case - finish button click during active exam session
  - Test that clicking "დასრულება" during active exam permanently clears the session from localStorage
  - Test that phase transitions to 'summary' and remains 'summary' (does not revert to 'active')
  - Test that localStorage.getItem('cityroute-active-exam') returns null after finish
  - Test that useEffect does NOT call setPhase('active') after clearActiveExam() executes
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: "Finish button clears localStorage, but useEffect restoration logic runs and forces phase back to 'active'"
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 2.1, 2.2, 2.3, 2.5_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Home → Return Resume Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (navigation away and return scenarios)
  - Test that navigating Home during active exam and returning to the same route restores the exact session state (elapsed time, triggered pins, user position, heading, GPS status)
  - Test that valid active exams in localStorage (< 24 hours old) automatically resume when returning to the route
  - Test that component mount with saved session matching route slug hydrates state variables correctly
  - Test that restartPreview() clears saved state and presents fresh preview phase
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.4, 3.7_

- [x] 3. Fix for finish button session clearing race condition

  - [x] 3.1 Add finishInProgressRef declaration
    - Add `const finishInProgressRef = useRef(false)` near other refs (after resumedSlugRef, around line 110)
    - Place declaration in the component's ref block for consistency
    - _Bug_Condition: isBugCondition(input) where input.action == 'FINISH_BUTTON_CLICK' AND useEffect_restoration_logic() executes before phase transition completes_
    - _Expected_Behavior: finishInProgressRef acts as a guard to suppress restoration logic during intentional finish operations_
    - _Preservation: Home → Return resume behavior must continue working exactly as before_
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 3.2 Set flag in finishSession() before clearActiveExam()
    - In finishSession() (line ~430), add `finishInProgressRef.current = true` as the FIRST line
    - This must execute BEFORE `clearActiveExam()` is called
    - Ensures the flag is set before any state clearing or useEffect triggering occurs
    - _Bug_Condition: clearActiveExam() triggers React state update causing useEffect to run_
    - _Expected_Behavior: Flag prevents useEffect restoration logic from overriding phase change_
    - _Preservation: Finish logic for summary display and audio playback unchanged_
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 3.3 Add early return guard in useEffect restoration logic
    - In the useEffect at lines 150-168 (dependencies: route.id, route.slug, route.name_ka, sortedPins, features.mapNav)
    - Add as the FIRST statement in the effect: `if (finishInProgressRef.current) { finishInProgressRef.current = false; return }`
    - This guard checks if a finish operation is in progress
    - If true, reset the flag and exit early (skip all restoration logic)
    - Place BEFORE the `const saved = loadActiveExam(route.id, route.slug)` line
    - _Bug_Condition: useEffect runs after clearActiveExam() and re-detects stale session_
    - _Expected_Behavior: Early return prevents setPhase('active') from overriding 'summary' phase_
    - _Preservation: Normal resume logic (when flag is false) continues unchanged_
    - _Requirements: 2.2, 2.3, 3.1, 3.2_

  - [x] 3.4 Reset flag in restartPreview()
    - In restartPreview() (line ~450), add `finishInProgressRef.current = false` at the start of the function
    - Ensures the flag is reset when user restarts from summary view
    - Prevents interference with future sessions
    - _Expected_Behavior: Flag is clean for next session cycle_
    - _Preservation: Restart logic clears saved state and presents fresh preview_
    - _Requirements: 3.3_

  - [x] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Finish Button Permanently Clears Session
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - Verify that finish button permanently clears session from localStorage
    - Verify that phase remains 'summary' without reverting to 'active'
    - Verify that useEffect does NOT override the phase after clearActiveExam()
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Home → Return Resume Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - Verify Home → Return resume behavior still works correctly
    - Verify automatic session resumption for valid saved exams
    - Verify state hydration on component mount
    - Verify restartPreview() still clears and resets correctly
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
