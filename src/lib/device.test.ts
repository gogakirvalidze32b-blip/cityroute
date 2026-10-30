import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDeviceBindResult } from './device'

describe('getDeviceFingerprint', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('restores the same origin-scoped fingerprint after a module reload', async () => {
    const firstModule = await import('./device')
    const firstFingerprint = firstModule.getDeviceFingerprint()

    vi.resetModules()
    const reloadedModule = await import('./device')
    const reloadedFingerprint = reloadedModule.getDeviceFingerprint()

    expect(reloadedFingerprint).toBe(firstFingerprint)
    expect(localStorage.getItem('cityroute_device_fp')).toBe(firstFingerprint)
  })

  it('replaces a stored fingerprint outside the server-accepted length range', async () => {
    localStorage.clear()
    localStorage.setItem('cityroute_device_fp', 'bad')
    const { getDeviceFingerprint } = await import('./device')

    const fingerprint = getDeviceFingerprint()

    expect(fingerprint.trim().length).toBeGreaterThanOrEqual(8)
    expect(fingerprint.trim().length).toBeLessThanOrEqual(256)
    expect(localStorage.getItem('cityroute_device_fp')).toBe(fingerprint)
  })

  it('persists the fingerprint in sessionStorage when localStorage is unavailable', async () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Storage unavailable')
      },
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const { getDeviceFingerprint } = await import('./device')
      const first = getDeviceFingerprint()
      const second = getDeviceFingerprint()

      expect(second).toBe(first)
      expect(sessionStorage.getItem('cityroute_device_fp')).toBe(first)

      vi.resetModules()
      const reloadedModule = await import('./device')
      expect(reloadedModule.getDeviceFingerprint()).toBe(first)
    } finally {
      if (storageDescriptor) {
        Object.defineProperty(window, 'localStorage', storageDescriptor)
      }
    }
  })
})

describe('parseDeviceBindResult', () => {
  it('accepts a successful first-device response', () => {
    expect(parseDeviceBindResult({
      status: 'bound',
      fingerprint: 'device-fingerprint',
      registered_devices: 1,
      max_devices: 1,
    })).toEqual({ status: 'bound', fingerprint: 'device-fingerprint' })
  })

  it('preserves a server-provided device limit message', () => {
    expect(parseDeviceBindResult({
      status: 'blocked',
      message: 'დაშვებულია მხოლოდ ერთი მოწყობილობა',
    })).toEqual({
      status: 'blocked',
      message: 'დაშვებულია მხოლოდ ერთი მოწყობილობა',
    })
  })

  it('rejects unknown response shapes instead of treating them as success', () => {
    expect(() => parseDeviceBindResult(null)).toThrow('Invalid bind_device response')
    expect(() => parseDeviceBindResult({ status: 'unexpected' })).toThrow(
      'Invalid bind_device response status',
    )
  })
})
