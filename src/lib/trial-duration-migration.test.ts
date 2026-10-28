import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/012_trial_duration_12_hours.sql'),
  'utf8',
)

describe('12-hour Trial migration', () => {
  it('sets the default and new-user trigger to 12 hours', () => {
    expect(migration).toMatch(/alter column subscription_expires_at\s+set default \(now\(\) \+ interval '12 hours'\)/i)
    expect(migration).toMatch(/'trial',\s+now\(\) \+ interval '12 hours',\s+null/i)
  })

  it('does not rewrite existing profile or Trial expiry rows', () => {
    expect(migration).not.toMatch(/update\s+public\.profiles/i)
    expect(migration).not.toMatch(/least\s*\(/i)
  })
})
