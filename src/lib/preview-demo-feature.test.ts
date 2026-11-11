import { describe, expect, it } from 'vitest'
import { canUsePreviewDemo } from './preview-demo-feature'

describe('Preview DEMO environment gate', () => {
  it('allows local development only on loopback hosts', () => {
    expect(
      canUsePreviewDemo({
        dev: true,
        hostname: 'localhost',
      }),
    ).toBe(true)
    expect(
      canUsePreviewDemo({
        dev: true,
        hostname: '127.0.0.1',
      }),
    ).toBe(true)
    expect(
      canUsePreviewDemo({
        dev: true,
        hostname: 'cityroute.ge',
      }),
    ).toBe(false)
  })

  it('requires an explicit feature flag and Vercel Preview hostname outside development', () => {
    expect(
      canUsePreviewDemo({
        dev: false,
        vercelEnv: 'preview',
        featureFlag: 'true',
        hostname: 'cityroute-git-branch.vercel.app',
      }),
    ).toBe(true)
    expect(
      canUsePreviewDemo({
        dev: false,
        vercelEnv: 'production',
        featureFlag: 'true',
        hostname: 'cityroute.vercel.app',
      }),
    ).toBe(false)
    expect(
      canUsePreviewDemo({
        dev: false,
        vercelEnv: 'preview',
        featureFlag: 'false',
        hostname: 'cityroute-git-branch.vercel.app',
      }),
    ).toBe(false)
    expect(
      canUsePreviewDemo({
        dev: false,
        vercelEnv: 'preview',
        featureFlag: 'true',
        hostname: 'cityroute.ge',
      }),
    ).toBe(false)
  })
})
