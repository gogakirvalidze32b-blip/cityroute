import { describe, expect, it } from 'vitest'
import { buildEmail } from '../../supabase/functions/support-notify/email'
import { loginPathWithNext, safeNextPath } from './auth-redirect'

const CONV = '11111111-2222-4333-8444-555555555555'

describe('post-login destination (support e-mail → /support-admin?c=)', () => {
  it('accepts the support admin page with a conversation id and the schools tab only', () => {
    expect(safeNextPath('/support-admin')).toBe('/support-admin')
    expect(safeNextPath(`/support-admin?c=${CONV}`)).toBe(`/support-admin?c=${CONV}`)
    expect(safeNextPath(`/support-admin?c=${CONV}&tab=schools`)).toBe(`/support-admin?c=${CONV}&tab=schools`)
    expect(safeNextPath('/support-admin?c=not-a-uuid&evil=1')).toBe('/support-admin')
    expect(safeNextPath('/support-admin?tab=other')).toBe('/support-admin')
  })

  it('rejects anything else, including open redirects', () => {
    for (const raw of [
      null,
      undefined,
      '',
      '/',
      '/choose-plan',
      '/support-admin/../choose-plan',
      '//evil.example/support-admin',
      'https://evil.example/support-admin',
      '/\\evil.example',
      'javascript:alert(1)',
      '/support-adminx',
    ]) {
      expect(safeNextPath(raw), String(raw)).toBeNull()
    }
  })

  it('builds a login URL that preserves the full allowed destination', () => {
    expect(loginPathWithNext(`/support-admin?c=${CONV}`)).toBe(`/login?next=${encodeURIComponent(`/support-admin?c=${CONV}`)}`)
    expect(loginPathWithNext('/support-admin')).toBe('/login?next=%2Fsupport-admin')
    expect(loginPathWithNext('//evil.example')).toBe('/login')
  })

  it('the support-notify e-mail links to the conversation id (Support Chat tab), not the user id', () => {
    const mail = buildEmail(
      {
        outbox_id: 'o1',
        kind: 'admin_new_message',
        attempts: 0,
        message_id: 'm1',
        conversation_id: CONV,
        body: 'secret text',
        attachment_count: 0,
        user_id: 'c36a33c0-0000-4000-8000-000000000000',
        full_name: 'გოგა',
        user_email: 'user@example.com',
      },
      { siteUrl: 'https://preview.example/', adminTo: 'admin@example.com', supportEmail: 'support@example.com' },
    )
    expect(mail?.html).toContain(`href="https://preview.example/support-admin?c=${CONV}"`)
    expect(mail?.html).not.toContain('tab=')
    expect(mail?.html).not.toContain('c=c36a33c0')
    // The e-mail link path is exactly what the login redirect accepts.
    const linkPath = new URL(`https://preview.example/support-admin?c=${CONV}`)
    expect(safeNextPath(`${linkPath.pathname}${linkPath.search}`)).toBe(`/support-admin?c=${CONV}`)
  })
})
