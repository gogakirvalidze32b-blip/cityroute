import { resolveSpeedLimit, resolveSpeedZone, roadPointAt, advanceRoadProgressU } from './src/lib/speed-limit'
import { DATA } from './src/lib/speed-limit.test.ts'

// Simple verification of the confirmed speed limits
const SLUGS = ['route-1', 'route-2', 'route-3', 'route-4']

// Check R2 pin 12 = 60 km/h
// We need to find which zone corresponds to R2 pin 12
// From the test data, R2 has zones with pins

// Let's verify using the existing test infrastructure
// We'll just check a few key points

async function main() {
  console.log('Verifying speed limits on real routes...\n')
  
  // Check R2 zones and their limits
  const r2Zones = DATA['route-2']?.road ? [] : []
  console.log('R2 road length:', (DATA['route-2']?.road?.length || 0))
  
  // Check R3 zones
  console.log('R3 road length:', (DATA['route-3']?.road?.length || 0))
  
  // Test a point at R2 pin area - pin #12 should be 60 km/h
  // We'll use roadPointAt with appropriate u values
  
  // From the known data: R2 #12 = 60 km/h, R2 #17-22 = 40 km/h, R3 #21 = 50 km/h
  // Let's verify by checking resolveSpeedLimit at mid-zone positions
  
  // For R2, find zone with limit 60
  // For R3, find zone with limit 50 at pin 21
  
  // Let's just test a few mid-zone points
  const testPoints = [
    // R2 mid zones for 60 km/h
    { slug: 'route-2', u: 20, description: 'R2 near pin #12 area, expect 60' },
    { slug: 'route-2', u: 35, description: 'R2 near pins #17-22 area, expect 40' },
    { slug: 'route-3', u: 25, description: 'R3 near pin #21 area, expect 50' }
  ]
  
  for (const testPoint of testPoints) {
    const { slug, u, description } = testPoint
    const road = DATA[slug]?.road
    if (!road) {
      console.log(`FAIL: No road data for ${slug}`)
      continue
    }
    const pos = roadPointAt(road, u)
    const limit = resolveSpeedLimit(slug, pos, road, u)
    console.log(`${description}: u=${u}, pos=[${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}], limit=${limit} km/h`)
  }
  
  // Also test roadU advancement
  console.log('\n--- Testing advanceRoadProgressU ---')
  
  // Test monotonic advance in the middle of a road
  const testRoad = DATA['route-4']?.road
  if (testRoad && testRoad.length > 0) {
    const pos1 = roadPointAt(testRoad, 50)
    const u1 = advanceRoadProgressU(pos1, testRoad, null)
    console.log(`advanceRoadProgressU at u=50 with no prev: u=${u1}`)
    
    const pos2 = roadPointAt(testRoad, 52)
    const u2 = advanceRoadProgressU(pos2, testRoad, u1)
    console.log(`advanceRoadProgressU at u=52 with prev=u1: u=${u2}`)
    
    // Test beyond end of road
    const posBeyond = roadPointAt(testRoad, testRoad.length - 1 + 0.5)
    const uBeyond = advanceRoadProgressU(posBeyond, testRoad, u2)
    console.log(`advanceRoadProgressU beyond end: pos=${testRoad.length - 1 + 0.5}, prevU=u2, result=u=${uBeyond}`)
  }
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})