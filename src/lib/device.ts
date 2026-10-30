const STORAGE_KEY = 'cityroute_device_fp'
let cachedFingerprint: string | null = null

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `fp_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function isValidFingerprint(value: string | null): value is string {
  return value !== null && value.trim().length >= 8 && value.trim().length <= 256
}

function getSessionStorageFingerprint(): string | null {
  try {
    const fingerprint = window.sessionStorage.getItem(STORAGE_KEY)
    return isValidFingerprint(fingerprint) ? fingerprint.trim() : null
  } catch (storageError) {
    console.warn('sessionStorage is not accessible:', storageError)
    return null
  }
}

function saveSessionStorageFingerprint(fingerprint: string): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, fingerprint)
    return true
  } catch (storageError) {
    console.warn('Could not save fingerprint to sessionStorage:', storageError)
    return false
  }
}

export function getDeviceFingerprint(): string {
  if (cachedFingerprint) return cachedFingerprint

  let fp: string | null
  try {
    fp = localStorage.getItem(STORAGE_KEY)
  } catch (err) {
    console.warn('localStorage not accessible; using sessionStorage when available:', err)
    const storedFingerprint = getSessionStorageFingerprint()
    if (storedFingerprint) {
      cachedFingerprint = storedFingerprint
      return cachedFingerprint
    }

    cachedFingerprint = randomId()
    if (!saveSessionStorageFingerprint(cachedFingerprint)) {
      console.warn('Device fingerprint is temporary because browser storage is unavailable')
    }
    return cachedFingerprint
  }

  if (isValidFingerprint(fp)) {
    cachedFingerprint = fp.trim()
    return cachedFingerprint
  }

  fp = randomId()
  try {
    localStorage.setItem(STORAGE_KEY, fp)
  } catch (storageError) {
    console.warn('Could not save fingerprint to localStorage:', storageError)
    const storedFingerprint = getSessionStorageFingerprint()
    if (storedFingerprint) {
      cachedFingerprint = storedFingerprint
      return cachedFingerprint
    }
    if (!saveSessionStorageFingerprint(fp)) {
      console.warn('Device fingerprint is temporary because browser storage is unavailable')
    }
  }

  cachedFingerprint = fp
  return cachedFingerprint
}

export type DeviceBindResult =
  | { status: 'bound' | 'ok'; fingerprint?: string }
  | { status: 'blocked'; message: string }

export function parseDeviceBindResult(data: unknown): DeviceBindResult {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid bind_device response')
  }

  const status = 'status' in data ? data.status : undefined
  if (status === 'blocked') {
    const message = 'message' in data && typeof data.message === 'string'
      ? data.message
      : 'მოწყობილობა დაბლოკილია'
    return { status, message }
  }

  if (status === 'bound' || status === 'ok') {
    const fingerprint = 'fingerprint' in data && typeof data.fingerprint === 'string'
      ? data.fingerprint
      : undefined
    return { status, fingerprint }
  }

  throw new Error('Invalid bind_device response status')
}
