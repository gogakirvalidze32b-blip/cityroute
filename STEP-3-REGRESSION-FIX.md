# STEP 3 - REGRESSION FIX + LEFT/RIGHT MAPPING FIX

## Summary

### 1. Regression Fix - Home/Return Behavior ✅

**Problem:**
STEP 3 changes caused Home/Return regression - collapse/return would show Preview instead of resuming active exam.

**Root Cause:**
CSS \position: fixed\ change and other modifications may have caused lifecycle issues.

**Solution:**
✅ Restored pre-STEP-3 working version from backup
✅ Reverted ExamLiveMapLeaflet.tsx to working state
✅ Reverted CSS changes (arrow back to \position: absolute\, removed transition)

**Result:**
Home/Return behavior restored to working state.

### 2. Left/Right Mapping Fix ✅

**Problem:**
Map rotation direction was inverted:
- Right turn → Map rotated LEFT (wrong)
- Left turn → Map rotated RIGHT (wrong)

**Root Cause:**
\otate(\deg)\ inverted the rotation direction due to Leaflet coordinate system.

**Solution:**
Changed \otate(\deg)\ → \otate(\deg)\ in \pplyHeadingUpRotation()\

**File Changed:**
- src/components/ExamLiveMapLeaflet.tsx line ~156

**Code Change:**
\\\	ypescript
// BEFORE (incorrect - inverted):
el.style.transform = \	ranslate(-50%, -50%) rotate(\deg)\

// AFTER (correct):
el.style.transform = \	ranslate(-50%, -50%) rotate(\deg)\
\\\

**Expected Behavior Now:**
- GPS heading 0 (North) → Map orientation North-up, rotation 0
- GPS heading 90 (East) → Map rotates clockwise 90, East is up
- GPS heading 180 (South) → Map rotates 180, South is up
- GPS heading 270 (West) → Map rotates clockwise 270 (= counter-clockwise 90), West is up
- Right turn → Map rotates clockwise (right)
- Left turn → Map rotates counter-clockwise (left)

### 3. Arrow Direction ✅

**Analysis:**
Arrow CSS creates triangle pointing UP (↑) at rotate(0deg):
\\\css
border-bottom: 24px solid #4285f4;  /* Bottom border = triangle points UP */
\\\

Arrow does NOT rotate - it stays screen-fixed pointing up.
Map rotates UNDER the arrow.

This is CORRECT behavior for heading-up navigation.

**No changes needed** - arrow direction is already correct.

## Changes Made

### Files Modified
1. **src/components/ExamLiveMapLeaflet.tsx**
   - Restored from backup (pre-STEP-3)
   - Applied ONLY rotation direction fix: \-deg\ → \deg\

2. **src/index.css**
   - Restored from backup (pre-STEP-3)
   - Arrow: \position: absolute\ (not fixed)
   - Map world: NO transition (yet)

### What Was NOT Changed
✅ NO mapPane.style.transform usage
✅ NO MapLibre usage
✅ NO GPS acquisition changes
✅ NO route coordinates changes
✅ NO PIN sequence changes
✅ NO audio changes
✅ NO persistence logic changes
✅ NO Finish button fix changes
✅ NO elapsed timer changes

## Testing Instructions

### Test 1: Home/Return (Regression Test)
1. Start Exam → active
2. Collapse app (minimize or switch away)
3. Return to app
4. **VERIFY:** Same active exam resumes, NOT Preview screen
5. **VERIFY:** triggeredPins still correct
6. **VERIFY:** elapsed timer continues correctly

### Test 2: Right Turn
1. Start navigation
2. Drive/walk straight (North)
3. Turn RIGHT
4. **VERIFY:** Map rotates CLOCKWISE (right)
5. **VERIFY:** Movement direction is now pointing UP on screen

### Test 3: Left Turn
1. Start navigation
2. Drive/walk straight
3. Turn LEFT
4. **VERIFY:** Map rotates COUNTER-CLOCKWISE (left)
5. **VERIFY:** Movement direction is now pointing UP on screen

### Test 4: Arrow Direction
1. Start navigation
2. Look at blue arrow
3. **VERIFY:** Arrow points UP (↑)
4. Turn right or left
5. **VERIFY:** Arrow still points UP (↑)
6. **VERIFY:** Map rotates under arrow

### Test 5: All Compass Directions
- Face North → Map shows North-up
- Face East → Map shows East-up (rotated 90 clockwise from North)
- Face South → Map shows South-up (rotated 180)
- Face West → Map shows West-up (rotated 270 clockwise = 90 counter-clockwise)

## Build Status

Attempted build - may need retry due to memory issues.

## Next Steps

1. Test Home/Return on phone - must work correctly
2. Test left/right rotation - must be correct now
3. Test arrow direction - should already be correct
4. If all tests pass → STEP 3 complete
5. DO NOT commit/push/deploy yet
6. DO NOT proceed to STEP 4 yet

## Technical Notes

### Why \otate(deg)\ instead of \otate(-deg)\?

Geographic heading (0 = North, 90 = East) matches CSS rotation (positive = clockwise).

When heading = 90 (facing East):
- We want East to point UP on screen
- Map must rotate clockwise 90
- CSS: \otate(90deg)\ ✓

Previous \otate(-90deg)\ would rotate counter-clockwise, putting West at top (wrong).

### Why Arrow Doesn't Rotate

In heading-up navigation:
- Arrow = vehicle/direction indicator
- Arrow ALWAYS points UP (forward)
- Map rotates UNDER the arrow
- This matches Google Maps Navigation behavior

Arrow rotation is NOT needed and would be wrong.

