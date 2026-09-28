# CityRoute Telavi - Offline Architecture

## Overview

CityRoute Telavi implements a **login-required, offline-ready** architecture:

1. **Online**: Login + Synchronization
2. **Offline**: Full navigation without internet
3. **Sync**: Automatic updates when online

---

## System States

```
┌─────────────────┐
│   NOT_SYNCED    │ ← First launch, no data
└────────┬────────┘
         │
         │ Login + Download
         ▼
┌─────────────────┐
│    SYNCING      │ ← Downloading map/routes/audio
└────────┬────────┘
         │
         │ Complete
         ▼
┌─────────────────┐
│   READY         │ ← Offline navigation available
└────────┬────────┘
         │
         │ Internet available + newer version
         ▼
┌─────────────────┐
│   OUTDATED      │ ← New data available
└────────┬────────┘
         │
         │ Update
         ▼
┌─────────────────┐
│   SYNCING       │
└─────────────────┘
```

---

## Data Architecture

### 1. Offline Package Structure

```typescript
interface OfflinePackage {
  version: string              // e.g. "1.0.0"
  timestamp: number            // Download timestamp
  routes: RouteConfig[]        // All Telavi routes
  pins: PinConfig[]            // All navigation pins
  audioManifest: AudioFile[]   // Audio file mapping
  mapBounds: MapBounds         // Offline map coverage
  checksum: string             // Validation hash
}
```

### 2. Route Configuration

```typescript
interface RouteConfig {
  id: string                   // "telavi_route_01"
  name: string                 // "მარშრუტი 1"
  nameEn: string               // "Route 1"
  geometry: LatLng[]           // Route polyline
  pins: string[]               // Pin IDs in order
  startPoint: LatLng
  endPoint: LatLng
  distance: number             // meters
  estimatedTime: number        // seconds
  difficulty: 'easy' | 'medium' | 'hard'
  active: boolean
}
```

### 3. Pin Configuration

```typescript
interface PinConfig {
  id: string                   // "telavi_route_01_turn_01"
  routeId: string              // "telavi_route_01"
  order: number                // 1, 2, 3...
  position: LatLng
  instruction: string          // "მოუხვიეთ მარჯვნივ 300 მეტრში"
  instructionEn: string        // "Turn right in 300 meters"
  audioFile: string            // "turn_right_300m.mp3"
  triggerDistance: number      // 300 (meters)
  direction: PinDirection      // 'left' | 'right' | 'straight' | 'roundabout'
  maneuverType: ManeuverType   // 'turn' | 'merge' | 'exit' | 'arrive'
  metadata?: {
    speed_limit?: number
    road_name?: string
    landmark?: string
  }
}

type PinDirection = 'left' | 'right' | 'straight' | 'roundabout' | 'u-turn'
type ManeuverType = 'turn' | 'merge' | 'exit' | 'arrive' | 'depart' | 'continue'
```

### 4. Audio Manifest

```typescript
interface AudioFile {
  id: string                   // "turn_right_300m"
  filename: string             // "turn_right_300m.mp3"
  localPath: string            // Local storage path
  remoteUrl: string            // Fallback URL
  duration: number             // seconds
  size: number                 // bytes
  checksum: string             // Validation
  downloaded: boolean
}
```

---

## Storage Strategy

### IndexedDB Structure

```
Database: cityroute_offline
├── routes (table)
│   └── [routeId] → RouteConfig
├── pins (table)
│   └── [pinId] → PinConfig
├── audio (table)
│   └── [audioId] → Blob
├── map_tiles (table)
│   └── [z/x/y] → Blob
└── metadata (table)
    └── version, timestamp, checksum
```

### Local Storage

```typescript
// Lightweight sync status
localStorage.setItem('cityroute:sync_status', 'READY')
localStorage.setItem('cityroute:offline_version', '1.0.0')
localStorage.setItem('cityroute:last_sync', '2026-09-29T12:00:00Z')
```

---

## Synchronization Flow

### Initial Sync (After Login)

```
1. User logs in (requires internet)
2. Check offline package version
3. Download offline package:
   ├── Route configurations
   ├── Pin configurations
   ├── Audio files
   └── Map tiles (Telavi area)
4. Validate checksums
5. Store in IndexedDB
6. Mark as READY
7. → Offline navigation available
```

### Update Sync (When Online)

```
1. Check current offline version
2. Query server for latest version
3. If newer version available:
   ├── Download new package to temp storage
   ├── Validate checksums
   ├── Atomic swap: old → new
   └── Update version
4. Keep old package until new is validated
5. Never delete last working package
```

---

## Offline Map Strategy

### Option 1: MBTiles Package (Recommended)

- Pre-rendered tile package for Telavi area
- Covers zoom levels 12-18
- ~50-200MB depending on coverage
- Served via Leaflet plugin or custom tile provider

### Option 2: Vector Tiles

- Smaller file size
- Dynamic styling
- Requires MapLibre GL JS

### Option 3: Raster Tile Cache

- Cache tiles on-demand
- Service Worker intercepts tile requests
- Falls back to cache when offline

### Coverage Area

```typescript
const TELAVI_BOUNDS = {
  north: 41.9350,
  south: 41.8950,
  east: 45.5000,
  west: 45.4500,
}

const ZOOM_LEVELS = {
  min: 12,  // City overview
  max: 18,  // Street detail
}
```

---

## Audio Strategy

### Storage

```typescript
// Store audio as Blobs in IndexedDB
async function storeAudio(id: string, blob: Blob) {
  await db.audio.put({ id, blob, timestamp: Date.now() })
}

// Retrieve audio URL
async function getAudioUrl(id: string): Promise<string> {
  const record = await db.audio.get(id)
  return URL.createObjectURL(record.blob)
}
```

### Playback

```typescript
// Offline-first audio player
class OfflineAudioPlayer {
  async play(audioId: string) {
    // 1. Try IndexedDB first
    const localUrl = await getAudioUrl(audioId)
    if (localUrl) return this.playFromBlob(localUrl)
    
    // 2. Fall back to network if online
    if (navigator.onLine) {
      return this.playFromUrl(remoteUrl)
    }
    
    // 3. Fail gracefully
    console.error('Audio not available offline:', audioId)
  }
}
```

---

## Pin Trigger System

### State Machine

```typescript
type PinState = 'PENDING' | 'TRIGGERED' | 'COMPLETED'

interface PinTrigger {
  pinId: string
  state: PinState
  distance: number          // Current distance to pin
  triggeredAt?: number      // Timestamp when triggered
  completedAt?: number      // Timestamp when completed
}

class PinTriggerManager {
  private triggers: Map<string, PinTrigger> = new Map()
  
  update(pinId: string, currentPosition: LatLng, pin: PinConfig) {
    const distance = calculateDistance(currentPosition, pin.position)
    const trigger = this.triggers.get(pinId) || {
      pinId,
      state: 'PENDING',
      distance,
    }
    
    // State transitions
    if (trigger.state === 'PENDING' && distance <= pin.triggerDistance) {
      // PENDING → TRIGGERED
      trigger.state = 'TRIGGERED'
      trigger.triggeredAt = Date.now()
      this.playAudio(pin.audioFile)
    }
    
    if (trigger.state === 'TRIGGERED' && distance <= 20) {
      // TRIGGERED → COMPLETED (passed the pin)
      trigger.state = 'COMPLETED'
      trigger.completedAt = Date.now()
    }
    
    trigger.distance = distance
    this.triggers.set(pinId, trigger)
  }
  
  reset() {
    // Reset for new navigation session
    this.triggers.clear()
  }
}
```

### Hysteresis

```typescript
// Prevent repeated triggers due to GPS jitter
const TRIGGER_HYSTERESIS = 50 // meters

if (distance <= triggerDistance && lastDistance > triggerDistance + TRIGGER_HYSTERESIS) {
  // Actually trigger
}
```

---

## Authentication Strategy

### Current (Supabase)

```typescript
// Login requires internet
await supabase.auth.signInWithPassword({ email, password })

// Session persists via Supabase storage
// Tokens automatically refreshed when online
// Works offline if session hasn't expired
```

### Offline Session

```typescript
// Check if user has valid session
const session = await supabase.auth.getSession()

if (session) {
  // Valid session - allow offline use
  return true
} else {
  // No session - require login (needs internet)
  return false
}
```

---

## Service Worker Strategy

### Cache Strategy

```typescript
// Service Worker: offline-first for critical assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  
  // Map tiles: cache-first
  if (url.pathname.includes('/tiles/')) {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    )
  }
  
  // Audio: cache-first
  if (url.pathname.includes('/audio/')) {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    )
  }
  
  // API: network-first
  if (url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    )
  }
})
```

---

## UI Status Indicators

### Online/Offline Badge

```typescript
<div className="network-status">
  {navigator.onLine ? (
    <span className="badge-online">🟢 ონლაინ</span>
  ) : (
    <span className="badge-offline">🔴 ოფლაინ</span>
  )}
</div>

<div className="sync-status">
  {syncStatus === 'READY' && '✅ მზადაა ოფლაინ რეჟიმისთვის'}
  {syncStatus === 'SYNCING' && '⏳ სინქრონიზაცია...'}
  {syncStatus === 'OUTDATED' && '⚠️ განახლება ხელმისაწვდომია'}
  {syncStatus === 'NOT_SYNCED' && '❌ მონაცემები არ არის ჩამოტვირთული'}
</div>
```

---

## Version Management

### Semantic Versioning

```typescript
interface OfflineVersion {
  major: number  // Breaking changes
  minor: number  // New routes/pins
  patch: number  // Audio/map updates
}

// Check if update needed
function needsUpdate(local: string, remote: string): boolean {
  const [localMajor, localMinor, localPatch] = local.split('.').map(Number)
  const [remoteMajor, remoteMinor, remotePatch] = remote.split('.').map(Number)
  
  if (remoteMajor > localMajor) return true  // Major update
  if (remoteMajor === localMajor && remoteMinor > localMinor) return true  // Minor update
  if (remoteMajor === localMajor && remoteMinor === localMinor && remotePatch > localPatch) return true  // Patch
  
  return false
}
```

### Update Strategy

```typescript
async function updateOfflinePackage(newVersion: string) {
  // 1. Download to temp location
  const tempPackage = await downloadPackage(newVersion)
  
  // 2. Validate
  if (!validatePackage(tempPackage)) {
    throw new Error('Invalid package')
  }
  
  // 3. Atomic swap
  await db.transaction('rw', [db.routes, db.pins, db.audio], async () => {
    // Clear old data
    await db.routes.clear()
    await db.pins.clear()
    // Don't clear audio - incremental update
    
    // Insert new data
    await db.routes.bulkPut(tempPackage.routes)
    await db.pins.bulkPut(tempPackage.pins)
  })
  
  // 4. Update version
  await db.metadata.put({ key: 'version', value: newVersion })
  
  // 5. Clean up
  // Keep old package for 24h as backup
}
```

---

## Error Handling

### Graceful Degradation

```typescript
try {
  // Try offline resources
  const route = await db.routes.get(routeId)
  if (!route) throw new Error('Route not found')
  
  const audio = await getOfflineAudio(audioId)
  if (!audio) {
    // Fall back to network if online
    if (navigator.onLine) {
      return await fetchAudioFromNetwork(audioId)
    }
    // Silent failure - navigation continues
    console.warn('Audio not available:', audioId)
  }
} catch (error) {
  // Never crash navigation
  console.error('Offline error:', error)
  showNotification('ოფლაინ რეჟიმში ზოგიერთი ფუნქცია შეზღუდულია')
}
```

---

## Testing Offline Mode

### Chrome DevTools

1. Open DevTools → Network tab
2. Set throttling to "Offline"
3. Reload application
4. Verify navigation works

### Programmatic

```typescript
// Simulate offline
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: false
})

// Test sync status
assert(await getSyncStatus() === 'READY')

// Test route loading
const route = await loadRoute('telavi_route_01')
assert(route !== null)

// Test audio playback
const audioUrl = await getAudioUrl('turn_right_300m')
assert(audioUrl.startsWith('blob:'))
```

---

## Migration Path

### Phase 1: Prepare Infrastructure
- ✅ Create pin configuration system
- ✅ Create offline storage layer
- ✅ Implement sync manager

### Phase 2: Offline Map
- Choose map strategy (MBTiles recommended)
- Generate Telavi tile package
- Implement offline tile provider

### Phase 3: Audio System
- Download audio to IndexedDB
- Implement offline audio player
- Test playback without network

### Phase 4: Integration
- Connect navigation to offline data
- Implement sync UI
- Add status indicators

### Phase 5: Testing
- Test complete offline flow
- Test sync updates
- Test error scenarios

---

## Files to Create/Modify

### New Files
```
src/
├── lib/
│   ├── offline-storage.ts      # IndexedDB wrapper
│   ├── sync-manager.ts         # Sync orchestration
│   ├── pin-trigger.ts          # Pin state machine
│   └── offline-audio.ts        # Audio player
├── data/
│   └── telavi/
│       ├── routes.json         # Route configurations
│       └── pins.json           # Pin configurations
└── components/
    ├── SyncStatus.tsx          # Online/offline indicator
    └── OfflineGuard.tsx        # Require sync before navigation
```

### Modified Files
```
src/
├── components/
│   └── ExamDriveSession.tsx    # Use offline data
└── lib/
    └── audio.ts                # Support offline playback
```

---

## Next Steps

1. ✅ Fix camera FREE mode (DONE - this commit)
2. ✅ Fix zoom behavior (DONE - this commit)
3. Create `lib/offline-storage.ts`
4. Create `lib/pin-trigger.ts`
5. Create route/pin configuration files
6. Choose offline map strategy
7. Implement sync UI
8. Test complete offline flow
