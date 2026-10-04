import fs from 'fs'
import { point, lineString } from '@turf/helpers'
import distance from '@turf/distance'
import bearing from '@turf/bearing'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import along from '@turf/along'
import length from '@turf/length'

// Read route data
const route1 = JSON.parse(fs.readFileSync('./src/data/route-1-official.json', 'utf8'))

const fullPath = route1.full_path
const manoeuvres = route1.manoeuvres

console.log('='.repeat(80))
console.log('ROUTE 1 PIN LATERAL CORRECTION DIAGNOSTIC')
console.log('='.repeat(80))
console.log()
console.log('GOAL: Move pins SIDEWAYS only to road centerline')
console.log('      Preserve longitudinal position along route')
console.log()
console.log(`Full Path Points: ${fullPath.length}`)
console.log(`Manoeuvres (Pins): ${manoeuvres.length}`)
console.log()

// Create line from full_path
const pathLine = lineString(fullPath.map(p => [p.lng, p.lat]))
const totalLength = length(pathLine, { units: 'meters' })

console.log(`Total route length: ${Math.round(totalLength)}m`)
console.log()

// Analyze each pin with LATERAL CORRECTION
const results = []
let problematicCount = 0

console.log('ANALYZING EACH PIN:')
console.log('-'.repeat(80))
console.log()

manoeuvres.forEach((pin, idx) => {
  const pinPoint = point([pin.lng, pin.lat])
  
  // Step 1: Find nearest point on route to determine longitudinal position
  const nearest = nearestPointOnLine(pathLine, pinPoint)
  const distanceAlongRoute = nearest.properties.location // distance along route in km
  const distanceAlongRouteM = distanceAlongRoute * 1000 // convert to meters
  
  // Step 2: Get the point at this EXACT longitudinal position on the route
  const pointOnRoute = along(pathLine, distanceAlongRoute, { units: 'kilometers' })
  
  // Step 3: Calculate lateral (perpendicular) distance
  const lateralDistanceM = distance(pinPoint, pointOnRoute, { units: 'meters' })
  
  // Step 4: Calculate longitudinal displacement (should be ~0)
  const longitudinalDisplacement = distance(pinPoint, nearest, { units: 'meters' })
  
  // Step 5: The corrected position is simply the point on route at same longitudinal position
  const correctedLat = pointOnRoute.geometry.coordinates[1]
  const correctedLng = pointOnRoute.geometry.coordinates[0]
  
  // Step 6: Calculate actual longitudinal shift (old nearest vs new position)
  const oldNearest = nearest.geometry.coordinates
  const newPosition = pointOnRoute.geometry.coordinates
  const longitudinalShift = distance(
    point(oldNearest),
    point(newPosition),
    { units: 'meters' }
  )
  
  const result = {
    index: pin.index,
    oldLat: pin.lat,
    oldLng: pin.lng,
    newLat: correctedLat,
    newLng: correctedLng,
    lateralDistanceM: Math.round(lateralDistanceM * 100) / 100,
    longitudinalShiftM: Math.round(longitudinalShift * 100) / 100,
    distanceAlongRouteM: Math.round(distanceAlongRouteM),
    instruction: pin.instruction.substring(0, 50),
    type: pin.type,
    problematic: lateralDistanceM > 10
  }
  
  if (result.problematic) {
    problematicCount++
  }
  
  results.push(result)
  
  // Show each pin
  const marker = result.problematic ? '⚠️' : '✓'
  console.log(`Pin #${result.index} ${marker} - ${result.instruction}...`)
  console.log(`  Position along route: ${result.distanceAlongRouteM}m`)
  console.log(`  Old: [${result.oldLat.toFixed(6)}, ${result.oldLng.toFixed(6)}]`)
  console.log(`  New: [${result.newLat.toFixed(6)}, ${result.newLng.toFixed(6)}]`)
  console.log(`  Lateral shift: ${result.lateralDistanceM}m`)
  console.log(`  Longitudinal shift: ${result.longitudinalShiftM}m`)
  console.log()
})

console.log('='.repeat(80))
console.log('SUMMARY:')
console.log('='.repeat(80))
console.log()
console.log(`Total pins: ${manoeuvres.length}`)
console.log(`Pins needing ≤10m lateral correction: ${manoeuvres.length - problematicCount}`)
console.log(`Pins needing >10m lateral correction: ${problematicCount}`)
console.log()

if (problematicCount > 0) {
  console.log('⚠️  PINS REQUIRING >10m LATERAL CORRECTION:')
  console.log('-'.repeat(80))
  results.filter(r => r.problematic).forEach(r => {
    console.log(`  Pin #${r.index}: ${r.lateralDistanceM}m lateral`)
  })
  console.log()
}

// Statistics
const avgLateral = results.reduce((sum, r) => sum + r.lateralDistanceM, 0) / results.length
const maxLateral = Math.max(...results.map(r => r.lateralDistanceM))
const maxLateralPin = results.find(r => r.lateralDistanceM === maxLateral)

const avgLongitudinal = results.reduce((sum, r) => sum + r.longitudinalShiftM, 0) / results.length
const maxLongitudinal = Math.max(...results.map(r => r.longitudinalShiftM))
const maxLongitudinalPin = results.find(r => r.longitudinalShiftM === maxLongitudinal)

console.log('CORRECTION STATISTICS:')
console.log('-'.repeat(80))
console.log(`Average lateral correction: ${Math.round(avgLateral * 100) / 100}m`)
console.log(`Max lateral correction: ${maxLateral}m (Pin #${maxLateralPin.index})`)
console.log(`Average longitudinal shift: ${Math.round(avgLongitudinal * 100) / 100}m`)
console.log(`Max longitudinal shift: ${maxLongitudinal}m (Pin #${maxLongitudinalPin.index})`)
console.log()

// Check for duplicate positions after correction
console.log('CHECKING FOR DUPLICATE POSITIONS AFTER CORRECTION:')
console.log('-'.repeat(80))
const correctedPositions = new Map()
results.forEach(r => {
  const key = `${r.newLat.toFixed(6)},${r.newLng.toFixed(6)}`
  if (!correctedPositions.has(key)) {
    correctedPositions.set(key, [])
  }
  correctedPositions.get(key).push(r.index)
})

let hasDuplicates = false
correctedPositions.forEach((pins, location) => {
  if (pins.length > 1) {
    console.log(`  ⚠️  Multiple pins at same position [${location}]:`)
    console.log(`     Pins: ${pins.join(', ')}`)
    hasDuplicates = true
  }
})

if (!hasDuplicates) {
  console.log('  ✓ No duplicate positions after correction')
}
console.log()

console.log('='.repeat(80))
console.log('RECOMMENDATION:')
console.log('='.repeat(80))
console.log()

if (problematicCount === 0 && !hasDuplicates) {
  console.log('✓ ALL CORRECTIONS LOOK SAFE:')
  console.log('  • All pins need ≤10m lateral correction')
  console.log('  • No duplicate positions after correction')
  console.log('  • Longitudinal positions preserved')
  console.log()
  console.log('READY TO APPLY CORRECTIONS')
} else {
  if (problematicCount > 0) {
    console.log(`⚠️  ${problematicCount} pins need >10m lateral correction`)
    console.log('    These should be reviewed manually')
  }
  if (hasDuplicates) {
    console.log('⚠️  Some pins would end up at duplicate positions')
    console.log('    This indicates geometry gaps in full_path[]')
  }
  console.log()
  console.log('RECOMMENDATION: Manual review required before applying')
}
console.log()

// Save results to JSON for potential automated correction
const outputData = {
  timestamp: new Date().toISOString(),
  totalPins: results.length,
  safeCorrections: results.length - problematicCount,
  problematicCorrections: problematicCount,
  avgLateralM: Math.round(avgLateral * 100) / 100,
  maxLateralM: maxLateral,
  avgLongitudinalM: Math.round(avgLongitudinal * 100) / 100,
  maxLongitudinalM: maxLongitudinal,
  corrections: results
}

fs.writeFileSync('lateral-corrections.json', JSON.stringify(outputData, null, 2))
console.log('✓ Detailed results saved to: lateral-corrections.json')
console.log()
