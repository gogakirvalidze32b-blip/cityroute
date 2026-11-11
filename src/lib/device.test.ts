import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDeviceBindResult } from './device'

function createIndexedDbMock() {
  const records = new Map<string, { tabId: string; ownerId: string; expiresAt: number }>()
  let hasStore = false
  const database = {
    objectStoreNames: {
      contains: (name: string) => name === 'tabClaims' && hasStore,
    },
    createObjectStore: () => {
      hasStore = true
    },
    transaction: () => {
      const transaction: {
        oncomplete: (() => void) | null
        onerror: (() => void) | null
        onabort: (() => void) | null
        objectStore: () => {
          get: (key: string) => { result?: unknown; onsuccess: (() => void) | null }
          put: (record: { tabId: string; ownerId: string; expiresAt: number }) => void
          delete: (key: string) => void
        }
      } = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => ({
          get: (key) => {
            const request: { result?: unknown; onsuccess: (() => void) | null } = {
              onsuccess: null,
            }
            queueMicrotask(() => {
              request.result = records.get(key)
              request.onsuccess?.()
              queueMicrotask(() => transaction.oncomplete?.())
            })
            return request
          },
          put: (record) => records.set(record.tabId, record),
          delete: (key) => records.delete(key),
        }),
      }
      return transaction
    },
  }
  const factory = {
    open: () => {
      const request: {
        result?: typeof database
        onsuccess: (() => void) | null
        onerror: (() => void) | null
        onupgradeneeded: (() => void) | null
      } = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      }
      queueMicrotask(() => {
        request.result = database
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
  return factory as unknown as IDBFactory
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('copies a readable localStorage fingerprint into the cookie for later storage loss', async () => {
    localStorage.setItem('cityroute_device_fp', 'existing-device-fingerprint')
    const { getDeviceFingerprint } = await import('./device')

    expect(getDeviceFingerprint()).toBe('existing-device-fingerprint')
    expect(document.cookie).toContain(
      'cityroute_device_fp=existing-device-fingerprint',
    )

    const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Storage unavailable')
      },
    })
    try {
      vi.resetModules()
      expect((await import('./device')).getDeviceFingerprint()).toBe(
        'existing-device-fingerprint',
      )
    } finally {
      if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor)
      document.cookie = 'cityroute_device_fp=; Max-Age=0; Path=/'
    }
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

  it('persists the shared device fingerprint in a cookie when localStorage is unavailable', async () => {
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
      expect(document.cookie).toContain(`cityroute_device_fp=${encodeURIComponent(first)}`)

      vi.resetModules()
      const reloadedModule = await import('./device')
      expect(reloadedModule.getDeviceFingerprint()).toBe(first)
    } finally {
      if (storageDescriptor) {
        Object.defineProperty(window, 'localStorage', storageDescriptor)
      }
      document.cookie = 'cityroute_device_fp=; Max-Age=0; Path=/'
    }
  })
})

describe('getExamTabId', () => {
  beforeEach(() => {
    vi.resetModules()
    sessionStorage.clear()
    window.name = ''
  })

  it('keeps the same tab identity across a reload', async () => {
    const first = (await import('./device')).getExamTabId()
    vi.resetModules()
    const reloaded = (await import('./device')).getExamTabId()

    expect(reloaded).toBe(first)
  })

  it('creates a different identity when a separate tab has separate session storage', async () => {
    const first = (await import('./device')).getExamTabId()
    sessionStorage.clear()
    window.name = ''
    vi.resetModules()
    const second = (await import('./device')).getExamTabId()

    expect(second).not.toBe(first)
  })

  it('assigns a new identity when a duplicate tab inherits a claimed sessionStorage id', async () => {
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    const heldLocks = new Set<string>()
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          name: string,
          _options: { ifAvailable: boolean },
          callback: (lock: { name: string } | null) => Promise<void> | void,
        ) => {
          if (heldLocks.has(name)) return callback(null)
          heldLocks.add(name)
          return callback({ name })
        },
      },
    })

    try {
      const firstModule = await import('./device')
      const first = await firstModule.claimUniqueExamTabId()
      const duplicatedTabId = sessionStorage.getItem('cityroute_exam_tab_id')

      vi.resetModules()
      sessionStorage.setItem('cityroute_exam_tab_id', duplicatedTabId ?? '')
      const duplicateModule = await import('./device')
      const duplicate = await duplicateModule.claimUniqueExamTabId()

      expect(duplicate).not.toBe(first)
      expect(sessionStorage.getItem('cityroute_exam_tab_id')).toBe(duplicate)
    } finally {
      if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })

  it('atomically assigns a distinct id to a duplicate tab without Web Locks', async () => {
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    })
    vi.stubGlobal('indexedDB', createIndexedDbMock())
    try {
      const firstModule = await import('./device')
      const duplicatedTabId = firstModule.getExamTabId()
      const duplicatedWindowName = window.name
      const firstPromise = firstModule.claimUniqueExamTabId()

      vi.resetModules()
      sessionStorage.setItem('cityroute_exam_tab_id', duplicatedTabId ?? '')
      window.name = duplicatedWindowName
      const duplicateModule = await import('./device')
      const duplicatePromise = duplicateModule.claimUniqueExamTabId()
      const [first, duplicate] = await Promise.all([firstPromise, duplicatePromise])

      expect(duplicate).not.toBe(first)
      expect(sessionStorage.getItem('cityroute_exam_tab_id')).toBe(duplicate)
    } finally {
      if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })

  it('restores tab identity from window.name when sessionStorage is unavailable', async () => {
    const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('Storage unavailable')
      },
    })
    const originalName = window.name
    try {
      const firstModule = await import('./device')
      const first = firstModule.getExamTabId()
      expect(window.name).toContain(`cityroute-exam-tab=${encodeURIComponent(first)}`)

      vi.resetModules()
      const reloadedModule = await import('./device')
      expect(reloadedModule.getExamTabId()).toBe(first)
    } finally {
      if (storageDescriptor) Object.defineProperty(window, 'sessionStorage', storageDescriptor)
      window.name = originalName
    }
  })

  it('lets only one active tab claim a legacy remote session', async () => {
    const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    const heldLocks = new Set<string>()
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          name: string,
          _options: { ifAvailable: boolean },
          callback: (lock: { name: string } | null) => Promise<void> | void,
        ) => {
          if (heldLocks.has(name)) return callback(null)
          heldLocks.add(name)
          return callback({ name })
        },
      },
    })
    localStorage.clear()

    try {
      const firstModule = await import('./device')
      expect(await firstModule.claimLegacyRemoteExamSession('legacy-1', 'tab-A')).toBe(true)

      vi.resetModules()
      const secondModule = await import('./device')
      expect(await secondModule.claimLegacyRemoteExamSession('legacy-1', 'tab-B')).toBe(false)
      expect(localStorage.getItem('cityroute-legacy-exam-claim:legacy-1')).toBe('tab-A')
    } finally {
      if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
      else Reflect.deleteProperty(navigator, 'locks')
      localStorage.clear()
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
