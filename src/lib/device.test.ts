import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDeviceBindResult } from './device'

describe('getDeviceFingerprint', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('preserves and reuses the saved origin-scoped fingerprint', async () => {
    localStorage.clear()
    localStorage.setItem('cityroute_device_fp', 'saved-device-fingerprint')
    const { getDeviceFingerprint } = await import('./device')

    const firstAccountFingerprint = getDeviceFingerprint()
    const secondAccountFingerprint = getDeviceFingerprint()

    expect(firstAccountFingerprint).toBe('saved-device-fingerprint')
    expect(secondAccountFingerprint).toBe(firstAccountFingerprint)
    expect(localStorage.getItem('cityroute_device_fp')).toBe('saved-device-fingerprint')
  })

  it('reuses one in-memory fingerprint when localStorage is unavailable', async () => {
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
