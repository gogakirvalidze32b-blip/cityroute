import fs from 'fs'
import https from 'https'
import { point } from '@turf/helpers'
import distance from '@turf/distance'

// Read route data
const route1 = JSON.parse(fs.readFileSync('./src/data/route-1-official.json', 'utf8'))
const manoeuvres = route1.manoeuvres

console.log('='.repeat(80))
console.log('ROUTE 1 PIN ROAD CENTERLINE SNAPPING DIAGNOSTIC')
console.log('='.repeat(80))
console.log()
console.log('GOAL: Snap each pin LATERALLY to actual road centerline')
console.log('      Using OSRM snap-to-roads API (real OSM road network)')
console.log('      NO full_path[] or route-polylines.ts used')
console.log()
console.log(`Total Pins: ${manoeuvres.length}`)
console.log()

// Helper: Call OSRM nearest API to snap coordinate to road
async function snapToRoad(lat, lng) {
  // OSRM Public API - nearest service
  // Returns nearest point on road network
  const url = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          resolve(result)
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

// Helper: Rate limit
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

console.log('SNAPPING EACH PIN TO ROAD CENTERLINE...')
console.log('(Using OSRM public API - may take 1-2 minutes)')
console.log('-'.repeat(80))
console.log()

const results = []

// Process each pin
for (let i = 0; i < manoeuvres.length; i++) {
  const pin = manoeuvres[i]
  
  console.log(`Pin #${pin.index}: [${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}]`)
  console.log(`  "${pin.instruction.substring(0, 45)}..."`)
  
  try {
    // Call OSRM to snap to nearest road
    const osrmResult = await snapToRoad(pin.lat, pin.lng)
    
    if (osrmResult.code !== 'Ok' || !osrmResult.waypoints || osrmResult.waypoints.length === 0) {
      console.log(`  ⚠️  OSRM error: ${osrmResult.code || 'No waypoints'}`)
      results.push({
        index: pin.index,
        oldLat: pin.lat,
        oldLng: pin.lng,
        newLat: null,
        newLng: null,
        lateralDistanceM: null,
        status: 'OSRM_ERROR',
        instruction: pin.instruction
      })
      console.log()
      continue
    }
    
    const snapped = osrmResult.waypoints[0]
    const newLat = snapped.location[1]
    const newLng = snapped.location[0]
    
    // Calculate lateral distance
    const oldPoint = point([pin.lng, pin.lat])
    const newPoint = point([newLng, newLat])
    const lateralDist = distance(oldPoint, newPoint, { units: 'meters' })
    
    const roadName = snapped.name || 'unnamed road'
    
    // Determine status
    let status = 'OK'
    if (lateralDist > 50) {
      status = 'MANUAL_REVIEW'
    } else if (lateralDist > 20) {
      status = 'CHECK'
    }
    
    console.log(`  → Snapped: [${newLat.toFixed(6)}, ${newLng.toFixed(6)}]`)
    console.log(`  Road: ${roadName}`)
    console.log(`  Lateral shift: ${Math.round(lateralDist * 100) / 100}m`)
    console.log(`  Status: ${status}`)
    
    results.push({
      index: pin.index,
      oldLat: pin.lat,
      oldLng: pin.lng,
      newLat,
      newLng,
      lateralDistanceM: Math.round(lateralDist * 100) / 100,
      roadName,
      status,
      instruction: pin.instruction
    })
    
  } catch (error) {
    console.log(`  ⚠️  Error: ${error.message}`)
    results.push({
      index: pin.index,
      oldLat: pin.lat,
      oldLng: pin.lng,
      newLat: null,
      newLng: null,
      lateralDistanceM: null,
      status: 'ERROR',
      instruction: pin.instruction,
      error: error.message
    })
  }
  
  console.log()
  
  // Rate limit: OSRM public API allows ~5 requests/second
  // We use 500ms delay to be safe
  if (i < manoeuvres.length - 1) {
    await sleep(500)
  }
}

console.log('='.repeat(80))
console.log('RESULTS SUMMARY')
console.log('='.repeat(80))
console.log()

// Count by status
const statusCounts = {}
results.forEach(r => {
  statusCounts[r.status] = (statusCounts[r.status] || 0) + 1
})

console.log('STATUS BREAKDOWN:')
Object.keys(statusCounts).sort().forEach(status => {
  const icon = status === 'OK' ? '✓' : status === 'CHECK' ? '⚠️' : '⚠️'
  console.log(`  ${icon} ${status}: ${statusCounts[status]} pins`)
})
console.log()

// Statistics
const validResults = results.filter(r => r.lateralDistanceM !== null)
if (validResults.length > 0) {
  const avgLateral = validResults.reduce((sum, r) => sum + r.lateralDistanceM, 0) / validResults.length
  const maxLateral = Math.max(...validResults.map(r => r.lateralDistanceM))
  const minLateral = Math.min(...validResults.map(r => r.lateralDistanceM))
  const maxPin = validResults.find(r => r.lateralDistanceM === maxLateral)
  
  console.log('STATISTICS:')
  console.log(`  Successfully snapped: ${validResults.length}/${manoeuvres.length}`)
  console.log(`  Average lateral correction: ${Math.round(avgLateral * 100) / 100}m`)
  console.log(`  Min lateral correction: ${Math.round(minLateral * 100) / 100}m`)
  console.log(`  Max lateral correction: ${maxLateral}m (Pin #${maxPin.index})`)
  console.log()
}

// Show all results in table format
console.log('='.repeat(80))
console.log('DETAILED RESULTS')
console.log('='.repeat(80))
console.log()

results.forEach(r => {
  const icon = r.status === 'OK' ? '✓' : r.status === 'CHECK' ? '⚠️' : '⚠️'
  console.log(`${icon} Pin #${r.index.toString().padStart(2)} | Lateral: ${(r.lateralDistanceM || 0).toString().padStart(6)}m | ${r.status}`)
  console.log(`     Old: [${r.oldLat.toFixed(6)}, ${r.oldLng.toFixed(6)}]`)
  if (r.newLat !== null) {
    console.log(`     New: [${r.newLat.toFixed(6)}, ${r.newLng.toFixed(6)}]`)
    console.log(`     Road: ${r.roadName}`)
  }
  console.log(`     "${r.instruction.substring(0, 50)}..."`)
  console.log()
})

// Pins requiring manual review
console.log('='.repeat(80))
console.log('RECOMMENDATIONS')
console.log('='.repeat(80))
console.log()

const okPins = results.filter(r => r.status === 'OK')
const checkPins = results.filter(r => r.status === 'CHECK')
const manualPins = results.filter(r => r.status === 'MANUAL_REVIEW')
const errorPins = results.filter(r => r.status === 'ERROR' || r.status === 'OSRM_ERROR')

if (okPins.length > 0) {
  console.log(`✓ ${okPins.length} pins are good (≤20m lateral correction):`)
  okPins.forEach(r => {
    console.log(`    Pin #${r.index}: ${r.lateralDistanceM}m`)
  })
  console.log()
}

if (checkPins.length > 0) {
  console.log(`⚠️  ${checkPins.length} pins need verification (20-50m lateral):`)
  checkPins.forEach(r => {
    console.log(`    Pin #${r.index}: ${r.lateralDistanceM}m - Check if correct road`)
  })
  console.log()
}

if (manualPins.length > 0) {
  console.log(`⚠️  ${manualPins.length} pins need MANUAL REVIEW (>50m lateral):`)
  manualPins.forEach(r => {
    console.log(`    Pin #${r.index}: ${r.lateralDistanceM}m - May be on wrong road/segment`)
  })
  console.log()
}

if (errorPins.length > 0) {
  console.log(`❌ ${errorPins.length} pins had errors:`)
  errorPins.forEach(r => {
    console.log(`    Pin #${r.index}: ${r.error || r.status}`)
  })
  console.log()
}

console.log('='.repeat(80))
console.log('NEXT STEPS')
console.log('='.repeat(80))
console.log()

if (okPins.length === manoeuvres.length) {
  console.log('✓ ALL PINS SAFE TO UPDATE')
  console.log('  All corrections are minor (≤20m)')
  console.log('  Ready to apply changes to route-1-official.json')
} else if (errorPins.length === 0 && manualPins.length === 0) {
  console.log('✓ MOSTLY SAFE TO UPDATE')
  console.log(`  ${okPins.length} pins are good`)
  console.log(`  ${checkPins.length} pins need verification`)
  console.log('  Review CHECK pins before applying')
} else {
  console.log('⚠️  MANUAL REVIEW REQUIRED')
  console.log('  Some pins have large corrections or errors')
  console.log('  Review each problematic pin before applying changes')
}
console.log()

// Save results
const outputData = {
  timestamp: new Date().toISOString(),
  totalPins: results.length,
  okPins: okPins.length,
  checkPins: checkPins.length,
  manualReviewPins: manualPins.length,
  errorPins: errorPins.length,
  avgLateralM: validResults.length > 0 
    ? Math.round((validResults.reduce((sum, r) => sum + r.lateralDistanceM, 0) / validResults.length) * 100) / 100 
    : null,
  maxLateralM: validResults.length > 0 
    ? Math.max(...validResults.map(r => r.lateralDistanceM)) 
    : null,
  results
}

fs.writeFileSync('osrm-road-snapping-results.json', JSON.stringify(outputData, null, 2))
console.log('✓ Results saved to: osrm-road-snapping-results.json')
console.log()
