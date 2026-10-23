import { describe, expect, it } from 'vitest'
import { shouldShowSpeedLimitDebug } from './debug-flags'

describe('Speed Limit debug visibility', () => {
  it('is hidden in Vercel Production, even when the opt-out is not set', () => {
    expect(shouldShowSpeedLimitDebug({ dev: false, vercelEnv: 'production' })).toBe(false)
  })

  it('is available in Vercel Preview production builds', () => {
    expect(shouldShowSpeedLimitDebug({ dev: false, vercelEnv: 'preview' })).toBe(true)
  })

  it('is available during local development', () => {
    expect(shouldShowSpeedLimitDebug({ dev: true })).toBe(true)
  })

  it('can be explicitly disabled in any environment', () => {
    expect(
      shouldShowSpeedLimitDebug({ dev: true, vercelEnv: 'preview', override: '0' }),
    ).toBe(false)
  })

  it('stays hidden in non-Vercel production builds', () => {
    expect(shouldShowSpeedLimitDebug({ dev: false })).toBe(false)
  })
})
