import { describe, expect, it } from 'vitest'
import { isBogLivePaymentSite } from './bog-payment-environment'

describe('BOG live payment environment routing', () => {
  it('allows Live routing only on the canonical host in Vercel Production', () => {
    expect(isBogLivePaymentSite('cityroute.ge', 'production')).toBe(true)
    expect(isBogLivePaymentSite('www.cityroute.ge', 'production')).toBe(true)
  })

  it('keeps Preview and non-canonical hosts off the Live API', () => {
    expect(isBogLivePaymentSite('cityroute.ge', 'preview')).toBe(false)
    expect(isBogLivePaymentSite('cityroute.ge', 'development')).toBe(false)
    expect(isBogLivePaymentSite('preview.example.vercel.app', 'production')).toBe(false)
    expect(isBogLivePaymentSite('cityroute.ge.evil.example', 'production')).toBe(false)
  })
})
