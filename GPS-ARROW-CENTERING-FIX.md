# GPS Arrow Centering Fix

## Problem Summary
The GPS navigation arrow was moving in a circular trajectory instead of staying perfectly centered on screen. This was caused by the map rotation anchor point being calculated relative to the GPS position's container coordinates rather than the fixed screen center.

## Root Causes Identified

### 1. **Incorrect Transform Origin** (CRITICAL)
**Files:** 
- `src/components/ExamLiveMapLeaflet.tsx`
- `src/components/NavigationMap.tsx`

**Issue:** Map rotation was anchored to GPS position:
```typescript
const anchor = map.latLngToContainerPoint(state.position)
pane.style.transformOrigin = `${anchor.x}px ${anchor.y}px`
```

As the map pans to follow the user, this anchor point moves, causing the arrow to appear to loop in a circle.

**Fix:** Anchor rotation to fixed screen center:
```typescript
const center = map.getSize().divideBy(2) // Fixed screen center
pane.style.transformOrigin = `${center.x}px ${center.y}px`
```

### 2. **Arrow Overlay Transform Conflict**
**File:** `src/components/ExamLiveMapLeaflet.tsx`, `src/index.css`

**Issue:** CSS had `transform: translate(-50%, -50%)` but React inline style was applying `transform: rotate(${heading}deg)`, causing the centering to be overridden.

**Fix:** Combined both transforms in inline style:
```typescript
<div className="nav-arrow-overlay" style={{ transform: `translate(-50%, -50%) rotate(${heading}deg)` }}>
```

### 3. **No Pan Prevention During Navigation**
**File:** `src/components/ExamLiveMapLeaflet.tsx`

**Issue:** User could manually pan/zoom the map during navigation, disrupting the driving view.

**Fix:** Disabled map interactions during active navigation:
```typescript
useEffect(() => {
  if (isNavigating) {
    map.dragging.disable()
    map.touchZoom.disable()
    map.doubleClickZoom.disable()
    map.scrollWheelZoom.disable()
    map.boxZoom.disable()
    map.keyboard.disable()
  } else {
    // Re-enable when paused
    map.dragging.enable()
    // ... etc
  }
}, [map, isNavigating])
```

## Changes Made

### ExamLiveMapLeaflet.tsx
1. ✅ Fixed map rotation anchor to screen center (line ~77)
2. ✅ Combined arrow overlay transforms (line ~202)
3. ✅ Added pan/zoom blocking during navigation (MapFollowPause component)
4. ✅ Updated MapFollowPause to accept `isNavigating` prop

### NavigationMap.tsx
1. ✅ Fixed map rotation anchor to screen center (line ~198)

### index.css
1. ✅ Removed hardcoded transform from `.nav-arrow-overlay` to prevent conflicts

## How It Works Now

### Arrow Positioning
```
Screen Layout:
┌─────────────────────┐
│                     │
│                     │
│         ↑           │ ← Arrow fixed at exact center
│      (arrow)        │    Only rotates, never moves
│                     │
│                     │
└─────────────────────┘
```

### Map Rotation
```
Map rotates around screen center:
- User GPS position: pans smoothly to keep user visible
- Map rotation origin: FIXED at screen center (50%, 50%)
- Arrow overlay: FIXED at screen center, only rotates
```

### User Interaction States
```
NAVIGATING (active):
- Map: follows GPS automatically
- User input: DISABLED (no pan/zoom)
- Arrow: centered, rotating with heading

PAUSED:
- Map: user can pan/zoom freely
- User input: ENABLED
- Arrow: still visible but map doesn't follow
- Recenter button: visible

PREVIEW (before navigation):
- Map: can pan/zoom
- GPS marker: visible
- No arrow overlay
```

## Testing Checklist

### Visual Tests
- [ ] Arrow stays perfectly centered at all times during navigation
- [ ] Arrow only rotates, never translates
- [ ] Map rotates smoothly around screen center
- [ ] No circular trajectory visible
- [ ] Use screen ruler to verify exact centering (should be pixel-perfect)

### Interaction Tests
- [ ] Cannot pan map during active navigation
- [ ] Cannot zoom map during active navigation
- [ ] Recenter button works when navigation paused
- [ ] Can pan/zoom when navigation paused
- [ ] Can pan/zoom in preview mode (before starting)

### GPS Movement Tests
- [ ] Arrow rotates smoothly when heading changes
- [ ] Map pans smoothly as GPS position updates
- [ ] No jitter or jumps in arrow position
- [ ] Interpolation works smoothly at 60fps
- [ ] Works correctly during turns and curves

### Edge Cases
- [ ] Works on different screen sizes (phone, tablet)
- [ ] Works in portrait and landscape modes
- [ ] Arrow stays centered after map resize
- [ ] Arrow stays centered after orientation change
- [ ] Works correctly at route start
- [ ] Works correctly at route finish

## Technical Notes

### Transform Order Matters
CSS transforms are applied **right to left**:
```typescript
transform: `translate(-50%, -50%) rotate(${heading}deg)`
```
1. First: rotate around origin (0, 0)
2. Then: translate to center

This keeps the arrow centered while rotating.

### Map Pane Rotation
Leaflet's `mapPane` is rotated to create the "north-up" driving view. By fixing `transformOrigin` to screen center instead of GPS position, the rotation pivots correctly.

### Why No Circular Path?
**Before:** 
- Rotation origin = GPS position in container coords (moves with map)
- As map pans, rotation pivot moves → creates circular arc

**After:**
- Rotation origin = fixed screen center (50%, 50%)
- Map pans under the arrow → arrow appears stationary

### Performance Considerations
- `will-change: transform` on arrow overlay for GPU acceleration
- Map rotation uses CSS transforms (hardware accelerated)
- Interpolation runs at 60fps via `requestAnimationFrame`
- No layout recalculation needed (pure transform changes)

## Files Modified
1. `src/components/ExamLiveMapLeaflet.tsx` - Arrow positioning, rotation origin, pan blocking
2. `src/components/NavigationMap.tsx` - Rotation origin fix
3. `src/index.css` - Removed conflicting transform from arrow overlay

## Rollback Instructions
If issues arise, revert these commits:
1. Map rotation anchor changes
2. Arrow overlay transform changes
3. Pan blocking changes

The changes are isolated and can be rolled back independently.

## Future Improvements
- [ ] Add visual indicator showing arrow is "locked" to center
- [ ] Add haptic feedback when reaching destination
- [ ] Consider adding smooth transition when entering/exiting navigation mode
- [ ] Add option to toggle map rotation (north-up vs route-up)

## References
- Original issue: Arrow looping on circular trajectory
- User screenshot: Showed ideal behavior with centered arrow
- Leaflet transform documentation: https://leafletjs.com/reference.html
- CSS transforms spec: https://developer.mozilla.org/en-US/docs/Web/CSS/transform
