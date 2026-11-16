const REQUEST_ID_PREFIX = 'cityroute.bog.payment-request.'

export function getOrCreateBogPaymentRequestId(deviceSlots: number): string {
  if (!Number.isInteger(deviceSlots) || deviceSlots < 1 || deviceSlots > 100) {
    throw new Error('Invalid BOG device package')
  }
  const key = `${REQUEST_ID_PREFIX}${deviceSlots}`
  const existing = window.sessionStorage.getItem(key)
  if (existing && isUuid(existing)) return existing

  const requestId = crypto.randomUUID()
  window.sessionStorage.setItem(key, requestId)
  return requestId
}

export function clearBogPaymentRequestId(deviceSlots: number): void {
  if (!Number.isInteger(deviceSlots) || deviceSlots < 1 || deviceSlots > 100) return
  window.sessionStorage.removeItem(`${REQUEST_ID_PREFIX}${deviceSlots}`)
}

export function clearBogPaymentRequestIds(): void {
  for (let deviceSlots = 1; deviceSlots <= 100; deviceSlots += 1) {
    window.sessionStorage.removeItem(`${REQUEST_ID_PREFIX}${deviceSlots}`)
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
