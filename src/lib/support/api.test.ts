import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ getSupabase: vi.fn() }))

import { toSupportError } from './api'
import { UploadError } from './upload'

describe('toSupportError', () => {
  it.each([
    ['rate_limited', 'rate_limited', true],
    ['body_too_long', 'body_too_long', false],
    ['empty_message', 'empty_message', false],
    ['too_many_attachments', 'too_many_attachments', false],
    ['not_authenticated', 'not_authenticated', false],
    ['forbidden', 'forbidden', false],
    ['attachment_not_owned', 'attachment', false],
    ['attachment_missing', 'attachment', false],
  ])('maps DB token %s', (token, code, transient) => {
    const e = toSupportError({ message: token })
    expect(e.code).toBe(code)
    expect(e.transient).toBe(transient)
    expect(e.userMessage).toBeTruthy()
  })
  it('treats fetch failures as transient network errors', () => {
    const e = toSupportError(new TypeError('Failed to fetch'))
    expect(e.code).toBe('network')
    expect(e.transient).toBe(true)
  })
  it('maps a missing RPC (migrations not applied) to not_configured', () => {
    expect(toSupportError({ code: 'PGRST202', message: 'Could not find the function' }).code).toBe('not_configured')
  })
  it('maps upload errors', () => {
    expect(toSupportError(new UploadError('network', 'x')).transient).toBe(true)
    expect(toSupportError(new UploadError('rejected', 'x', 403)).code).toBe('attachment')
  })
  it('never leaks raw database text to the user', () => {
    const e = toSupportError({ message: 'duplicate key value violates unique constraint "secret_idx"' })
    expect(e.userMessage).not.toMatch(/secret_idx|duplicate/)
  })
})
