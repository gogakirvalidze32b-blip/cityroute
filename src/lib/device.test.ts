import { describe, expect, it } from 'vitest'
import { parseDeviceBindResult } from './device'

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
