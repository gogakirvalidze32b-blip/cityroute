import { describe, expect, it } from 'vitest'
import { normalizeSupabaseProjectUrl } from './supabase'

describe('normalizeSupabaseProjectUrl', () => {
  it('removes a REST API path accidentally included in the project URL', () => {
    expect(normalizeSupabaseProjectUrl('https://project.supabase.co/rest/v1/'))
      .toBe('https://project.supabase.co')
  })

  it('resolves Auth requests at the project root after normalizing the URL', () => {
    const projectUrl = normalizeSupabaseProjectUrl('https://project.supabase.co/rest/v1/')

    expect(new URL('auth/v1/token?grant_type=password', projectUrl).href)
      .toBe('https://project.supabase.co/auth/v1/token?grant_type=password')
  })

  it('preserves a project root URL', () => {
    expect(normalizeSupabaseProjectUrl('https://project.supabase.co/'))
      .toBe('https://project.supabase.co')
  })

  it('does not rewrite unrelated URL paths', () => {
    expect(normalizeSupabaseProjectUrl('https://project.supabase.co/custom'))
      .toBe('https://project.supabase.co/custom')
  })

  it('rejects empty and invalid URLs', () => {
    expect(normalizeSupabaseProjectUrl(undefined)).toBeUndefined()
    expect(normalizeSupabaseProjectUrl('not-a-url')).toBeUndefined()
    expect(normalizeSupabaseProjectUrl('ftp://project.supabase.co')).toBeUndefined()
  })
})
