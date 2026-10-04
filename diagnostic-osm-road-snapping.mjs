import fs from 'fs'
import https from 'https'
import { point, lineString } from '@turf/helpers'
import distance from '@turf/distance'
import nearestPointOnLine from '@turf/nearest-point-on-line'

// Read route data
const route1 = JSON.parse(fs.readFileSync('./src/data/route-1-official.json', 'utf8'))
const manoeuvres = route1.manoeuvres

console.log('='.repeat(80))
console.log('ROUTE 1 PIN OSM ROAD SNAPPING DIAGNOSTIC')
console.log('='.repeat(80))
console.log()
console.log('GOAL: Snap each pin to actual OSM road centerline')
console.log('      Query OpenStreetMap Overpass API for real road geometry')
console.log('      NO full_path[] or route-polylines.ts used')
console.log()
console.log(`Total Pins: ${manoeuvres.length}`)
console.log()

// Helper: Query OSM Overpass API for roads near a coordinate
async function queryOSMRoads(lat, lng, radius = 50) {
  const query = `[out:json][timeout:25];way["highway"](around:${radius},${lat},${lng});out geom;`
  
  const url = 'https://overpass-api.de/api/interpreter'
  
  return new Promise((resolve, reject) => {
    const postData = query
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }
    
    const req = https.request(url, options, (res) => {
      let data = ''
      
      res.on('data', (chunk) => {
        data += chunk
      })
      
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    })
    
    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

// Helper: Convert OSM way to line and find nearest point
function snapToOSMRoad(pinLat, pinLng, osmWays) {
  const pinPoint = point([pinLng, pinLat])
  
  let bestSnap = null
  let bestDistance = Infinity
  let bestWay = null
  
  for (const way of osmWays) {
    if (!way.geometry || way.geometry.length < 2) continue
    
    try {
      // Create line from OSM way geometry
      const coords = way.geometry.map(node => [node.lon, node.lat])
      const wayLine = lineString(coords)
      
      // Find nearest point on this way
      const nearest = nearestPointOnLine(wayLine, pinPoint)
      const dist = distance(pinPoint, nearest, { units: 'meters' })
      
      if (dist < bestDistance) {
        bestDistance = dist
        bestSnap = nearest
        bestWay = way
      }
    } catch (e) {
      // Skip invalid geometry
      continue
    }
  }
  
  return { snap: bestSnap, distance: bestDistance, way: bestWay }
}

// Helper: Rate limit - wait between requests
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

console.log('QUERYING OSM FOR EACH PIN...')
console.log('(This may take 1-2 minutes due to API rate limiting)')
console.log('-'.repeat(80))
console.log()

const results = []

// Process each pin
for (let i = 0; i < manoeuvres.length; i++) {
  const pin = manoeuvres[i]
  
  console.log(`Processing Pin #${pin.index} [${pin.lat}, ${pin.lng}]...`)
  
  try {
    // Query OSM for roads near this pin
    const osmData = await queryOSMRoads(pin.lat, pin.lng, 100)
    
    if (!osmData.elements || osmData.elements.length === 0) {
      console.log(`  ⚠️  No OSM roads found within 100m`)
      results.push({
        index: pin.index,
        oldLat: pin.lat,
        oldLng: pin.lng,
        newLat: null,
        newLng: null,
        lateralDistanceM: null,
        osmRoadName: null,
        osmRoadType: null,
        status: 'NO_OSM_ROAD',
        instruction: pin.instruction
      })
      continue
    }
    
    // Find best snap to OSM roads
    const { snap, distance: lateralDist, way } = snapToOSMRoad(
      pin.lat,
      pin.lng,
      osmData.elements
    )
    
    if (!snap) {
      console.log(`  ⚠️  Could not snap to any OSM road`)
      results.push({
        index: pin.index,
        oldLat: pin.lat,
        oldLng: pin.lng,
        newLat: null,
        newLng: null,
        lateralDistanceM: null,
        osmRoadName: null,
        osmRoadType: null,
        status: 'SNAP_FAILED',
        instruction: pin.instruction
      })
      continue
    }
    
    const newLat = snap.geometry.coordinates[1]
    const newLng = snap.geometry.coordinates[0]
    const roadName = way.tags?.name || way.tags?.ref || 'unnamed'
    const roadType = way.tags?.highway || 'unknown'
    
    console.log(`  ✓ Snapped to: ${roadName} (${roadType})`)
    console.log(`    Distance: ${Math.round(lateralDist * 100) / 100}m`)
    console.log(`    New: [${newLat.toFixed(6)}, ${newLng.toFixed(6)}]`)
    
    results.push({
      index: pin.index,
      oldLat: pin.lat,
      oldLng: pin.lng,
      newLat,
      newLng,
      lateralDistanceM: Math.round(lateralDist * 100) / 100,
      osmRoadName: roadName,
      osmRoadType: roadType,
      osmWayId: way.id,
      status: lateralDist > 50 ? 'MANUAL_REVIEW' : 'OK',
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
      osmRoadName: null,
      osmRoadType: null,
      status: 'ERROR',
      instruction: pin.instruction,
      error: error.message
    })
  }
  
  // Rate limit: wait 2 seconds between requests to respect Overpass API limits
  if (i < manoeuvres.length - 1) {
    await sleep(2000)
  }
  
  console.log()
}

console.log('='.repeat(80))
console.log('RESULTS SUMMARY:')
console.log('='.repeat(80))
console.log()

// Count by status
const statusCounts = {}
results.forEach(r => {
  statusCounts[r.status] = (statusCounts[r.status] || 0) + 1
})

console.log('STATUS BREAKDOWN:')
Object.keys(statusCounts).forEach(status => {
  console.log(`  ${status}: ${statusCounts[status]}`)
})
console.log()

// Show all results
console.log('DETAILED RESULTS:')
console.log('-'.repeat(80))
console.log()

results.forEach(r => {
  const marker = r.status === 'OK' ? '✓' : '⚠️'
  console.log(`Pin #${r.index} ${marker} - ${r.instruction.substring(0, 40)}...`)
  console.log(`  Old: [${r.oldLat.toFixed(6)}, ${r.oldLng.toFixed(6)}]`)
  
  if (r.newLat !== null) {
    console.log(`  New: [${r.newLat.toFixed(6)}, ${r.newLng.toFixed(6)}]`)
    console.log(`  OSM Road: ${r.osmRoadName} (${r.osmRoadType})`)
    console.log(`  Lateral distance: ${r.lateralDistanceM}m`)
    console.log(`  Status: ${r.status}`)
  } else {
    console.log(`  Status: ${r.status}`)
    if (r.error) console.log(`  Error: ${r.error}`)
  }
  console.log()
})

// Statistics
const validResults = results.filter(r => r.lateralDistanceM !== null)
if (validResults.length > 0) {
  const avgLateral = validResults.reduce((sum, r) => sum + r.lateralDistanceM, 0) / validResults.length
  const maxLateral = Math.max(...validResults.map(r => r.lateralDistanceM))
  const maxPin = validResults.find(r => r.lateralDistanceM === maxLateral)
  
  console.log('='.repeat(80))
  console.log('STATISTICS:')
  console.log('='.repeat(80))
  console.log()
  console.log(`Pins successfully snapped: ${validResults.length}`)
  console.log(`Average lateral correction: ${Math.round(avgLateral * 100) / 100}m`)
  console.log(`Max lateral correction: ${maxLateral}m (Pin #${maxPin.index})`)
  console.log()
}

// Check for pins on wrong roads
console.log('='.repeat(80))
console.log('MANUAL REVIEW REQUIRED:')
console.log('='.repeat(80))
console.log()

const manualReview = results.filter(r => r.status === 'MANUAL_REVIEW' || r.lateralDistanceM > 30)
if (manualReview.length > 0) {
  console.log(`${manualReview.length} pins need manual review:`)
  manualReview.forEach(r => {
    console.log(`  Pin #${r.index}: ${r.lateralDistanceM}m from ${r.osmRoadName}`)
  })
} else {
  console.log('✓ No pins require manual review')
}
console.log()

// Save results
fs.writeFileSync('osm-road-snapping-results.json', JSON.stringify({
  timestamp: new Date().toISOString(),
  totalPins: results.length,
  successfulSnaps: validResults.length,
  manualReviewNeeded: manualReview.length,
  results
}, null, 2))

console.log('✓ Results saved to: osm-road-snapping-results.json')
console.log()
