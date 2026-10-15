# Bugfix Requirements Document

## Introduction

The "დასრულება" (Finish) button in the exam driving session fails to properly terminate the active exam. When clicked, the exam appears to finish momentarily but then immediately resumes to an active state, preventing users from completing their exam session. This occurs because the persistence clearing logic races with the component lifecycle that checks for saved sessions, causing the cleared session to be redetected and the phase to be forced back to 'active'.

This bugfix ensures that when a user finishes an exam, the session is permanently cleared and does not resume unexpectedly.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN user clicks "დასრულება" button during active exam THEN the system calls `clearActiveExam()` but the useEffect detecting saved sessions runs afterward and forces phase back to 'active'

1.2 WHEN `finishSession()` executes and clears localStorage THEN the component's useEffect (dependencies: route.id, route.slug) runs and calls `loadActiveExam()` or `hasSavedExamForSlug()` which may still detect stale cached session data

1.3 WHEN the useEffect detects a saved session exists (lines 150-168 in ExamDriveSession.tsx) THEN it calls `setPhase('active')` overriding the intended 'summary' phase set by `finishSession()`

1.4 WHEN user returns to the same route after finishing THEN the old saved exam persists in localStorage and automatically resumes instead of starting fresh

1.5 WHEN phase transitions from 'active' to 'summary' via `finishSession()` THEN the dependency array `[route.id, route.slug, route.name_ka, sortedPins, features.mapNav]` triggers the useEffect which re-evaluates saved state before the clear completes

### Expected Behavior (Correct)

2.1 WHEN user clicks "დასრულება" button during active exam THEN the system SHALL permanently clear the active exam session from localStorage AND prevent any useEffect from re-detecting or restoring it

2.2 WHEN `finishSession()` executes THEN the system SHALL set phase to 'summary' AND ensure no subsequent useEffect can override this phase by detecting stale saved sessions

2.3 WHEN the component's lifecycle useEffect runs after a finish action THEN it SHALL recognize that the session was intentionally finished and NOT call `setPhase('active')` based on stale saved session detection

2.4 WHEN user returns to the same route after finishing an exam THEN the system SHALL NOT resume the old session AND SHALL present the normal preview phase for starting a new exam

2.5 WHEN persistence is cleared via `clearActiveExam()` during finish THEN all subsequent calls to `loadActiveExam(route.id, route.slug)` and `hasSavedExamForSlug(route.slug)` SHALL return null/false immediately

### Unchanged Behavior (Regression Prevention)

3.1 WHEN user navigates Home during active exam and returns to the same route THEN the system SHALL CONTINUE TO restore the exact session state (elapsed time, triggered pins, user position, heading, GPS status)

3.2 WHEN a valid active exam exists in localStorage and is not expired (< 24 hours) THEN the system SHALL CONTINUE TO automatically resume the session when returning to the route

3.3 WHEN `restartPreview()` is called after viewing summary THEN the system SHALL CONTINUE TO clear saved state and present a fresh preview phase

3.4 WHEN component mounts with a saved session for a different route THEN the system SHALL CONTINUE TO ignore that saved session and start in preview phase

3.5 WHEN the finish button transitions phase to 'summary' THEN the system SHALL CONTINUE TO display the ExamSummary component with score, errors, and restart option

3.6 WHEN exam is finished successfully (no severe errors, passed) THEN the system SHALL CONTINUE TO play the success audio

3.7 WHEN savedState exists and matches route slug/id on mount THEN the system SHALL CONTINUE TO hydrate state variables (exam, userPos, heading, speedKmh, elapsedMs, triggeredPins) exactly once per slug
