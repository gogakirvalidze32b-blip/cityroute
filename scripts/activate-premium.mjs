import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadDotEnv() {
  const path = resolve(process.cwd(), '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i === -1) continue
    const key = trimmed.slice(0, i).trim()
    const val = trimmed.slice(i + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

loadDotEnv()

const email = process.argv[2] ?? 'gogakirvalidze@gmail.com'
const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.')
  console.error('Get service role key: Supabase Dashboard → Project Settings → API → service_role')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data: users, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (listError) {
  console.error('listUsers failed:', listError.message)
  process.exit(1)
}

const user = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
if (!user) {
  console.error(`User not found: ${email}`)
  process.exit(1)
}

const expiresAt = new Date()
expiresAt.setFullYear(expiresAt.getFullYear() + 10)

const { data: profile, error: updateError } = await admin
  .from('profiles')
  .update({
    subscription_status: 'active',
    subscription_expires_at: expiresAt.toISOString(),
    device_fingerprint: null,
    device_bound_at: null,
  })
  .eq('id', user.id)
  .select('*')
  .single()

if (updateError) {
  console.error('Profile update failed:', updateError.message)
  process.exit(1)
}

console.log('Premium activated:')
console.log(JSON.stringify({ email: user.email, ...profile }, null, 2))
