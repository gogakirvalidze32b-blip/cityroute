const STORAGE_KEY = 'cityroute_device_fp'

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `fp_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function getDeviceFingerprint(): string {
  let fp = localStorage.getItem(STORAGE_KEY)
  if (!fp) {
    fp = randomId()
    localStorage.setItem(STORAGE_KEY, fp)
  }
  return fp
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
