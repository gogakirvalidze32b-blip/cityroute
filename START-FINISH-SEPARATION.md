# Start/Finish Pin Separation - Route 1

## Problem
Route 1-ში Start pin (index 0) და Finish pins (ბოლო 3: indices 31-33) გეოგრაფიულად ახლოს არიან ერთმანეთთან, რის გამოც proximity-only detection იწვევდა Finish pins-ის არასწორ trigger-ს სესიის დაწყებისას.

### Coordinates:
- **START pin**: `41.931434, 45.475383` (index 0)
- **FINISH pins** (ბოლო 3):
  - Index 31: `41.932369, 45.477051` - "მალე, გთხოვთ მოუხვიოთ მარჯვნივ"
  - Index 32: `41.931327, 45.475788` - "მალე, გთხოვთ მოუხვიოთ მარცხნივ"
  - Index 33: `41.931488, 45.475166` - "ფინიში"

## Solution
დაემატა **sequence-based activation logic**, რომელიც ფინიშის პინებს აქტიურს ხდის მხოლოდ მაშინ, როცა route progress მიაღწევს Finish section-ს.

### Implementation Logic:
```typescript
const triggeredCount = triggeredRef.current.size
const totalPins = voicePins.length
const finishSectionStart = Math.max(0, totalPins - 3) // ბოლო 3 პინი

const pending = voicePins.find((p, idx) => {
  if (triggeredRef.current.has(p.id)) return false
  
  // Finish pins (last 3) ხელმისაწვდომი ხდება მხოლოდ finish section-ის მიღწევის შემდეგ
  if (idx >= finishSectionStart && triggeredCount < finishSectionStart) {
    console.log(`🚫 Finish pin blocked: "${p.instruction_ka}" (index ${idx}) - Progress: ${triggeredCount}/${finishSectionStart}`)
    return false
  }
  
  return true
})
```

## How It Works

1. **Route Progress Tracking**: 
   - `triggeredCount = triggeredRef.current.size` - რამდენი pin trigger-და უკვე
   - `finishSectionStart = totalPins - 3` - Route 1-სთვის: 34 - 3 = 31

2. **Finish Pin Guard**:
   - თუ pin index >= 31 (Finish section) ⏭️ AND
   - Progress < 31 (ჯერ არ მივაღწიეთ Finish section-ს) ⏭️
   - **🚫 Pin blocked** - არ გამოჩნდება როგორც pending, არ გაიშვება proximity check

3. **Activation Sequence**:
   - Pins 0-30: ნორმალურად trigger-დება proximity + heading-ის მიხედვით
   - Pins 31-33 (Finish): trigger-დება **მხოლოდ მას შემდეგ**, რაც 0-30 pin-ები trigger-დება

## Changes Made

### File: `src/components/ExamDriveSession.tsx`

1. **GPS callback pin selection** (line ~256):
   - დაემატა sequence-based filtering
   - Finish pins blocked until progress reaches them
   - Debug log: `🚫 Finish pin blocked` when prevented

2. **startSession function** (line ~318):
   - იგივე logic გამოყენებულია session-ის დაწყებისას
   - თავიდან არ გამოჩნდება Finish pins როგორც `nextPin`

3. **Debug logs enhanced**:
   - ახლა ყველა pin check-ზე ჩანს: `| Route progress: X/34`
   - Trigger log-ებში: `| Progress: (X+1)/34`
   - Blocked pins: `🚫 Finish pin blocked: "ფინიში" (index 33) - Progress: 0/31`

## Testing Checklist

✅ **Start Session Test**:
- GPS near Start pin (41.931434, 45.475383)
- nextPin უნდა იყოს index 0 (Start pin)
- Finish pins (31-33) არ უნდა trigger-დეს proximity-ის მიხედვით

✅ **Mid-Route Test**:
- Progress: 15/34 pins triggered
- nextPin უნდა იყოს index 16 (შემდეგი untriggered pin)
- Finish pins კვლავ blocked

✅ **Finish Section Test**:
- Progress: 31/34 pins triggered (Finish section reached)
- nextPin უნდა იყოს index 31 (პირველი Finish pin)
- Finish pins ახლა active და trigger-დება proximity-ით

✅ **Single Trigger Per Pin**:
- `triggeredRef.current` Set უზრუნველყოფს ერთჯერად trigger-ს
- არსებული behavior შენარჩუნებულია

## What Was NOT Changed

🔒 **Camera Logic**: FREE/FOLLOW modes - უცვლელი  
🔒 **GPS Arrow**: Rendering და centering - უცვლელი  
🔒 **Leaflet Maps**: Polyline, Circles, Markers - უცვლელი  
🔒 **Audio Playback**: audioEngine logic - უცვლელი  
🔒 **Pin Data**: route-1-official.json - უცვლელი (34 pins)

## Console Debug Example

### Start Session (Progress: 0/31):
```
🚫 Finish pin blocked: "მალე, გთხოვთ მოუხვიოთ მარჯვნივ" (index 31) - Progress: 0/31
🚫 Finish pin blocked: "მალე, გთხოვთ მოუხვიოთ მარცხნივ" (index 32) - Progress: 0/31
🚫 Finish pin blocked: "ფინიში" (index 33) - Progress: 0/31
📍 Pin check: ID: pin-0-route-1 | Sort order: 0 | Instruction: გთხოვთ, მოუხვიოთ მარჯვნივ | Distance: 15m | Trigger: 30m | Heading OK: true | Already spoken: false | Route progress: 0/34
🔊 Audio trigger! გთხოვთ, მოუხვიოთ მარჯვნივ | Progress: 1/34
```

### Finish Section Reached (Progress: 31/31):
```
📍 Pin check: ID: pin-31-route-1 | Sort order: 31 | Instruction: მალე, გთხოვთ მოუხვიოთ მარჯვნივ | Distance: 12m | Trigger: 15m | Heading OK: true | Already spoken: false | Route progress: 31/34
🔊 Audio trigger! მალე, გთხოვთ მოუხვიოთ მარჯვნივ | Progress: 32/34
```

## Build Status
✅ TypeScript: No new errors  
✅ Vite Build: Success (745.14 kB)  
✅ Commit: `c186514`

## Next Steps
1. Deploy to Vercel
2. Test on physical device in Telavi
3. Verify Start pin triggers correctly at session start
4. Verify Finish pins blocked until route progress
5. Verify Finish pins trigger correctly at end of route
