const STORAGE_KEY = 'cityroute_device_fp'

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `fp_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function getDeviceFingerprint(): string {
  try {
    let fp = localStorage.getItem(STORAGE_KEY)
    if (!fp) {
      fp = randomId()
      try {
        localStorage.setItem(STORAGE_KEY, fp)
      } catch (storageError) {
        // თუ localStorage არ მუშაობს (private mode და სხვა), მაინც დავაბრუნოთ fp
        console.warn('Could not save fingerprint to localStorage:', storageError)
      }
    }
    return fp
  } catch (err) {
    // თუ localStorage საერთოდ არ არის ხელმისაწვდომი
    console.warn('localStorage not accessible, generating temp fingerprint:', err)
    return randomId()
  }
}

export type DeviceBindResult =
  | { status: 'bound' | 'ok'; fingerprint: string }
  | { status: 'blocked'; message: string }

export function parseDeviceBindResult(data: unknown): DeviceBindResult {
  const obj = data as Record<string, string>
  if (obj.status === 'blocked') {
    return { status: 'blocked', message: obj.message ?? 'მოწყობილობა დაბლოკილია' }
  }
  return { status: (obj.status as 'bound' | 'ok') ?? 'ok', fingerprint: obj.fingerprint }
}
