const REQUEST_ID_STORAGE_PREFIX = 'cityroute.bog.payment-request.'

export function getOrCreateBogPaymentRequestId(deviceSlots: 1 | 2): string {
  const key = `${REQUEST_ID_STORAGE_PREFIX}${deviceSlots}`
  const existing = window.sessionStorage.getItem(key)
  if (existing && isUuid(existing)) return existing

  const requestId = crypto.randomUUID()
  window.sessionStorage.setItem(key, requestId)
  return requestId
}

export function clearBogPaymentRequestIds(): void {
  window.sessionStorage.removeItem(`${REQUEST_ID_STORAGE_PREFIX}1`)
  window.sessionStorage.removeItem(`${REQUEST_ID_STORAGE_PREFIX}2`)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
