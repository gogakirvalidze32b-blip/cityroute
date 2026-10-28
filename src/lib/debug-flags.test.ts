import { describe, expect, it } from 'vitest'
import {
  isPreviewFeatureEnabled,
  isVercelPreview,
  shouldShowSpeedLimitDebug,
} from './debug-flags'

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

describe('Preview-only test route visibility', () => {
  it('enables the Tbilisi route only on Vercel Preview deployments', () => {
    expect(isVercelPreview('preview')).toBe(true)
    expect(isVercelPreview('production')).toBe(false)
    expect(isVercelPreview('development')).toBe(false)
    expect(isVercelPreview()).toBe(false)
  })

  it('allows the debug panel in local development or Preview, never Production', () => {
    expect(isPreviewFeatureEnabled({ dev: true })).toBe(true)
    expect(isPreviewFeatureEnabled({ dev: false, vercelEnv: 'preview' })).toBe(true)
    expect(isPreviewFeatureEnabled({ dev: false, vercelEnv: 'production' })).toBe(false)
  })

  it('allows plan demo routes in local development and Vercel Preview, never Production', () => {
    expect(isPreviewFeatureEnabled({ dev: true, vercelEnv: 'development' })).toBe(true)
    expect(isPreviewFeatureEnabled({ dev: false, vercelEnv: 'preview' })).toBe(true)
    expect(isPreviewFeatureEnabled({ dev: false, vercelEnv: 'production' })).toBe(false)
    expect(isPreviewFeatureEnabled({ dev: false })).toBe(false)
  })
})
