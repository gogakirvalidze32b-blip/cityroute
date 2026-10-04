import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { matchRoute1InstructionAudio } from './src/data/route-1-voice.ts'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const i = line.indexOf('=')
      return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')]
    })
)

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY
)

const { data, error } = await supabase
  .from('pins')
  .select('id, route_id, sort_order, instruction_ka, audio_url')
  .order('route_id')
  .order('sort_order')

if (error) { console.log('ERROR:', error); process.exit(1) }

const routeNames = {
  'ded0dfc1-7c90-4693-9a30-107ce08a2e13': 'route-1',
}

let mapped = 0
let missing = 0

for (const pin of data) {
  const routeSlug = routeNames[pin.route_id] ?? null
  const url = pin.instruction_ka
    ? matchRoute1InstructionAudio(pin.instruction_ka, routeSlug ?? undefined)
    : null

  if (url) {
    mapped++
    console.log(`✓ ${pin.sort_order}: ${url}`)
  } else {
    missing++
    console.log(`✗ ${pin.sort_order}: NO AUDIO | ${pin.instruction_ka}`)
  }
}

console.log('\n====================')
console.log(`TOTAL:   ${data.length}`)
console.log(`MAPPED:  ${mapped}`)
console.log(`MISSING: ${missing}`)
console.log('====================')


