const STORAGE_KEY = 'cityroute_device_fp'
const EXAM_TAB_STORAGE_KEY = 'cityroute_exam_tab_id'
const EXAM_TAB_NAME_MARKER = '|cityroute-exam-tab='
const EXAM_TAB_LOCK_PREFIX = 'cityroute-exam-tab:'
const TAB_CLAIMS_DATABASE = 'cityroute-browser-identity'
const TAB_CLAIMS_STORE = 'tabClaims'
let cachedFingerprint: string | null = null
let cachedExamTabId: string | null = null
let uniqueExamTabIdPromise: Promise<string> | null = null
let tabClaimsDatabasePromise: Promise<IDBDatabase> | null = null
const claimedIndexedDbTabIds = new Set<string>()
const heldBrowserLocks = new Set<string>()
const indexedDbOwnerId = randomId()
let tabClaimLifecycleHandlersInstalled = false

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `fp_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function getExamTabId(): string {
  if (cachedExamTabId) return cachedExamTabId
  try {
    const stored = window.sessionStorage.getItem(EXAM_TAB_STORAGE_KEY)
    if (stored && stored.trim().length >= 8 && stored.trim().length <= 256) {
      cachedExamTabId = stored.trim()
      return cachedExamTabId
    }
  } catch (error) {
    console.warn('Could not persist exam tab identity in sessionStorage:', error)
  }
  const named = readWindowNameValue(EXAM_TAB_NAME_MARKER)
  if (named && named.length >= 8 && named.length <= 256) {
    cachedExamTabId = named
    return cachedExamTabId
  }
  cachedExamTabId = randomId()
  persistExamTabId(cachedExamTabId)
  return cachedExamTabId
}

function readWindowNameValue(marker: string): string | null {
  try {
    const index = window.name.lastIndexOf(marker)
    if (index < 0) return null
    return decodeURIComponent(window.name.slice(index + marker.length))
  } catch {
    return null
  }
}

function persistExamTabId(tabId: string): void {
  cachedExamTabId = tabId
  try {
    window.sessionStorage.setItem(EXAM_TAB_STORAGE_KEY, tabId)
  } catch (error) {
    console.warn('Could not persist exam tab identity in sessionStorage:', error)
  }
  try {
    const index = window.name.lastIndexOf(EXAM_TAB_NAME_MARKER)
    const baseName = index < 0 ? window.name : window.name.slice(0, index)
    window.name = `${baseName}${EXAM_TAB_NAME_MARKER}${encodeURIComponent(tabId)}`
  } catch (error) {
    console.warn('Could not persist exam tab identity in window.name:', error)
  }
}

async function acquireHeldBrowserLock(lockName: string): Promise<boolean | null> {
  if (heldBrowserLocks.has(lockName)) return true
  if (!navigator.locks?.request) return null
  return new Promise<boolean>((resolve) => {
    let settled = false
    void navigator.locks.request(
      lockName,
      { ifAvailable: true },
      (lock) => {
        if (!lock) {
          settled = true
          resolve(false)
          return
        }
        heldBrowserLocks.add(lockName)
        settled = true
        resolve(true)
        return new Promise<void>(() => {})
      },
    ).catch((error: unknown) => {
      if (!settled) {
        console.warn('Could not claim the browser tab identity lock:', error)
        resolve(false)
      }
    })
  })
}

async function tryClaimTabLock(tabId: string): Promise<boolean | null> {
  return acquireHeldBrowserLock(`${EXAM_TAB_LOCK_PREFIX}${tabId}`)
}

function openTabClaimsDatabase(): Promise<IDBDatabase> {
  if (tabClaimsDatabasePromise) return tabClaimsDatabasePromise
  tabClaimsDatabasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      if (!window.indexedDB) throw new Error('IndexedDB is unavailable')
      request = window.indexedDB.open(TAB_CLAIMS_DATABASE, 1)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(TAB_CLAIMS_STORE)) {
        database.createObjectStore(TAB_CLAIMS_STORE, { keyPath: 'tabId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the tab identity database'))
    request.onblocked = () => reject(new Error('Tab identity database upgrade is blocked'))
  }).catch((error: unknown) => {
    tabClaimsDatabasePromise = null
    throw new Error('ამ ბრაუზერში დამოუკიდებელი exam tab-ის იდენტიფიკაცია ვერ ხერხდება.', {
      cause: error,
    })
  })
  return tabClaimsDatabasePromise
}

type TabClaimRecord = {
  tabId: string
  ownerId: string
}

async function transactTabClaim(
  tabId: string,
  operation: (store: IDBObjectStore) => void,
): Promise<void> {
  const database = await openTabClaimsDatabase()
  await new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction
    try {
      transaction = database.transaction(TAB_CLAIMS_STORE, 'readwrite')
      operation(transaction.objectStore(TAB_CLAIMS_STORE))
    } catch (error) {
      reject(error)
      return
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Tab identity transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Tab identity transaction aborted'))
  })
}

async function tryClaimIndexedDbTabId(tabId: string): Promise<boolean> {
  const database = await openTabClaimsDatabase()
  let acquired = false
  await new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction
    let request: IDBRequest<TabClaimRecord | undefined>
    try {
      transaction = database.transaction(TAB_CLAIMS_STORE, 'readwrite')
      const store = transaction.objectStore(TAB_CLAIMS_STORE)
      request = store.get(tabId) as IDBRequest<TabClaimRecord | undefined>
      request.onsuccess = () => {
        const existing = request.result
        if (!existing || existing.ownerId === indexedDbOwnerId) {
          store.put({
            tabId,
            ownerId: indexedDbOwnerId,
          } satisfies TabClaimRecord)
          acquired = true
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Tab identity claim failed'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Tab identity claim aborted'))
    } catch (error) {
      reject(error)
    }
  })
  if (acquired) {
    claimedIndexedDbTabIds.add(tabId)
  }
  return acquired
}

function releaseIndexedDbTabClaims(): void {
  for (const tabId of claimedIndexedDbTabIds) {
    void transactTabClaim(tabId, (store) => {
      const request = store.get(tabId) as IDBRequest<TabClaimRecord | undefined>
      request.onsuccess = () => {
        if (request.result?.ownerId === indexedDbOwnerId) store.delete(tabId)
      }
    }).catch((error: unknown) => {
      console.warn('Could not release the IndexedDB tab identity claim:', error)
    })
  }
  claimedIndexedDbTabIds.clear()
}

function installTabClaimLifecycleHandlers(): void {
  if (tabClaimLifecycleHandlersInstalled) return
  tabClaimLifecycleHandlersInstalled = true
  window.addEventListener('pagehide', (event) => {
    if (!(event instanceof PageTransitionEvent) || !event.persisted) {
      releaseIndexedDbTabClaims()
    }
  })
}

export function claimUniqueExamTabId(): Promise<string> {
  if (uniqueExamTabIdPromise) return uniqueExamTabIdPromise
  uniqueExamTabIdPromise = (async () => {
    let tabId = getExamTabId()
    installTabClaimLifecycleHandlers()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const lockClaim = await tryClaimTabLock(tabId)
      const claimed = lockClaim === null
        ? await tryClaimIndexedDbTabId(tabId)
        : lockClaim
      if (claimed) {
        persistExamTabId(tabId)
        return tabId
      }
      tabId = randomId()
      persistExamTabId(tabId)
    }
    throw new Error('ბრაუზერის tab-ის უნიკალური იდენტიფიკაცია ვერ მოხერხდა.')
  })().catch((error: unknown) => {
    uniqueExamTabIdPromise = null
    throw error
  })
  return uniqueExamTabIdPromise
}

export async function claimLegacyRemoteExamSession(
  sessionId: string,
  tabId: string,
): Promise<boolean> {
  const lockName = `cityroute-legacy-exam-session:${sessionId}`
  if (await acquireHeldBrowserLock(lockName) !== true) return false
  const claimKey = `cityroute-legacy-exam-claim:${encodeURIComponent(sessionId)}`
  try {
    const owner = localStorage.getItem(claimKey)
    if (owner === tabId) return true
    localStorage.setItem(claimKey, tabId)
    return localStorage.getItem(claimKey) === tabId
  } catch (error) {
    console.warn('Could not persist the legacy exam-session owner; browser lock remains active:', error)
    return true
  }
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
    console.warn('localStorage not accessible; using shared cookie storage when available:', err)
    const cookieFingerprint = readFingerprintCookie()
    if (cookieFingerprint) {
      cachedFingerprint = cookieFingerprint
      return cachedFingerprint
    }
    const storedFingerprint = getSessionStorageFingerprint()
    if (storedFingerprint) {
      saveFingerprintCookie(storedFingerprint)
      cachedFingerprint = storedFingerprint
      return cachedFingerprint
    }

    cachedFingerprint = randomId()
    if (!saveFingerprintCookie(cachedFingerprint) && !saveSessionStorageFingerprint(cachedFingerprint)) {
      throw new Error('მოწყობილობის იდენტიფიკაცია ვერ შეინახა; ბრაუზერის storage და cookie მიუწვდომელია.')
    }
    return cachedFingerprint
  }

  if (isValidFingerprint(fp)) {
    cachedFingerprint = fp.trim()
    saveFingerprintCookie(cachedFingerprint)
    return cachedFingerprint
  }

  fp = randomId()
  try {
    localStorage.setItem(STORAGE_KEY, fp)
  } catch (storageError) {
    console.warn('Could not save fingerprint to localStorage:', storageError)
    const cookieFingerprint = readFingerprintCookie()
    if (cookieFingerprint) {
      cachedFingerprint = cookieFingerprint
      return cachedFingerprint
    }
    if (saveFingerprintCookie(fp)) {
      cachedFingerprint = fp
      return cachedFingerprint
    }
    const storedFingerprint = getSessionStorageFingerprint()
    if (storedFingerprint) {
      saveFingerprintCookie(storedFingerprint)
      cachedFingerprint = storedFingerprint
      return cachedFingerprint
    }
    if (!saveSessionStorageFingerprint(fp)) {
      throw new Error('მოწყობილობის იდენტიფიკაცია ვერ შეინახა; ბრაუზერის storage და cookie მიუწვდომელია.')
    }
  }

  cachedFingerprint = fp
  return cachedFingerprint
}

function readFingerprintCookie(): string | null {
  try {
    const encodedKey = `${encodeURIComponent(STORAGE_KEY)}=`
    const entry = document.cookie
      .split('; ')
      .find((value) => value.startsWith(encodedKey))
    if (!entry) return null
    const value = decodeURIComponent(entry.slice(encodedKey.length))
    return isValidFingerprint(value) ? value.trim() : null
  } catch (error) {
    console.warn('Could not read the shared device fingerprint cookie:', error)
    return null
  }
}

function saveFingerprintCookie(fingerprint: string): boolean {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie =
      `${encodeURIComponent(STORAGE_KEY)}=${encodeURIComponent(fingerprint)}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`
    return readFingerprintCookie() === fingerprint
  } catch (error) {
    console.warn('Could not persist the shared device fingerprint cookie:', error)
    return false
  }
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
