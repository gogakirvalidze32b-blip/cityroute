import fs from 'fs'
import { point, lineString } from '@turf/helpers'
import distance from '@turf/distance'
import nearestPointOnLine from '@turf/nearest-point-on-line'

// Read route data
const route1 = JSON.parse(fs.readFileSync('./src/data/route-1-official.json', 'utf8'))

const fullPath = route1.full_path
const manoeuvres = route1.manoeuvres

console.log('='.repeat(80))
console.log('ROUTE 1 PIN POSITIONING DIAGNOSTIC')
console.log('='.repeat(80))
console.log()

console.log(`Full Path Points: ${fullPath.length}`)
console.log(`Manoeuvres (Pins): ${manoeuvres.length}`)
console.log()

// Create line from full_path for distance calculations
const pathLine = lineString(fullPath.map(p => [p.lng, p.lat]))

// Analyze each pin
const results = []
let problematicCount = 0

manoeuvres.forEach((pin, idx) => {
  const pinPoint = point([pin.lng, pin.lat])
  
  // Find nearest point on the route centerline
  const nearest = nearestPointOnLine(pathLine, pinPoint)
  const distanceMeters = distance(pinPoint, nearest, { units: 'meters' })
  
  const result = {
    index: pin.index,
    oldLat: pin.lat,
    oldLng: pin.lng,
    nearestLat: nearest.geometry.coordinates[1],
    nearestLng: nearest.geometry.coordinates[0],
    distanceM: Math.round(distanceMeters * 100) / 100,
    instruction: pin.instruction.substring(0, 50),
    type: pin.type,
    problematic: distanceMeters > 50
  }
  
  if (result.problematic) {
    problematicCount++
  }
  
  results.push(result)
})

console.log('PIN ANALYSIS:')
console.log('-'.repeat(80))
console.log()

// Show all pins
results.forEach(r => {
  const marker = r.problematic ? '⚠️  REVIEW' : '✓'
  console.log(`Pin #${r.index} ${marker}`)
  console.log(`  Type: ${r.type}`)
  console.log(`  Instruction: ${r.instruction}...`)
  console.log(`  Current: [${r.oldLat}, ${r.oldLng}]`)
  console.log(`  Nearest on centerline: [${r.nearestLat}, ${r.nearestLng}]`)
  console.log(`  Distance: ${r.distanceM}m`)
  console.log()
})

console.log('='.repeat(80))
console.log('SUMMARY:')
console.log('='.repeat(80))
console.log()
console.log(`Total pins: ${manoeuvres.length}`)
console.log(`Pins within 50m: ${manoeuvres.length - problematicCount}`)
console.log(`Pins >50m (NEED REVIEW): ${problematicCount}`)
console.log()

if (problematicCount > 0) {
  console.log('⚠️  PROBLEMATIC PINS (>50m from centerline):')
  console.log('-'.repeat(80))
  results.filter(r => r.problematic).forEach(r => {
    console.log(`  Pin #${r.index}: ${r.distanceM}m - ${r.instruction.substring(0, 40)}...`)
  })
  console.log()
}

// Find max distance
const maxDist = Math.max(...results.map(r => r.distanceM))
const maxPin = results.find(r => r.distanceM === maxDist)
console.log(`Max distance from centerline: ${maxDist}m (Pin #${maxPin.index})`)
console.log()

// Check for pins snapping to same location
console.log('CHECKING FOR DUPLICATE SNAP LOCATIONS:')
console.log('-'.repeat(80))
const snapLocations = new Map()
results.forEach(r => {
  const key = `${r.nearestLat.toFixed(6)},${r.nearestLng.toFixed(6)}`
  if (!snapLocations.has(key)) {
    snapLocations.set(key, [])
  }
  snapLocations.get(key).push(r.index)
})

let hasDuplicates = false
snapLocations.forEach((pins, location) => {
  if (pins.length > 1) {
    console.log(`  Multiple pins snap to [${location}]:`)
    console.log(`    Pins: ${pins.join(', ')}`)
    hasDuplicates = true
  }
})

if (!hasDuplicates) {
  console.log('  ✓ No duplicate snap locations')
}
console.log()

console.log('='.repeat(80))
console.log('RECOMMENDATION:')
console.log('='.repeat(80))
console.log()

if (problematicCount === 0) {
  console.log('✓ All pins are within 50m of the route centerline.')
  console.log('  Safe to apply automatic snapping.')
} else {
  console.log(`⚠️  ${problematicCount} pins are >50m from the full_path[] centerline.`)
  console.log()
  console.log('POSSIBLE CAUSES:')
  console.log('  1. full_path[] may not cover all road segments where pins are located')
  console.log('  2. Pins may be on parallel roads')
  console.log('  3. Pins may be at intersections where geometry is simplified')
  console.log('  4. Original pin placement may have used different geometry source')
  console.log()
  console.log('NEXT STEPS:')
  console.log('  • Manual review required for pins >50m')
  console.log('  • Verify each problematic pin against actual route path')
  console.log('  • Consider updating full_path[] if coverage is incomplete')
  console.log('  • DO NOT blindly snap pins >50m - may move to wrong road')
}
console.log()
