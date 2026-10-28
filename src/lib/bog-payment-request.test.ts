import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearBogPaymentRequestIds, getOrCreateBogPaymentRequestId } from './bog-payment-request'

describe('BOG payment request idempotency', () => {
  afterEach(() => {
    clearBogPaymentRequestIds()
    vi.restoreAllMocks()
  })

  it('reuses a request ID for retries and separates packages', () => {
    const first = getOrCreateBogPaymentRequestId(1)

    expect(getOrCreateBogPaymentRequestId(1)).toBe(first)
    expect(getOrCreateBogPaymentRequestId(2)).not.toBe(first)
  })

  it('creates fresh request IDs after a payment return clears the session IDs', () => {
    const first = getOrCreateBogPaymentRequestId(1)
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('eb7629a8-d5bb-4a60-9291-b67f4ce26d0a')

    clearBogPaymentRequestIds()

    expect(getOrCreateBogPaymentRequestId(1)).toBe('eb7629a8-d5bb-4a60-9291-b67f4ce26d0a')
    expect(getOrCreateBogPaymentRequestId(1)).not.toBe(first)
  })
})
