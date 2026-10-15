import { describe, expect, it } from 'vitest'
import { buildEmail, escapeHtml, preview, type OutboxRow } from '../../../supabase/functions/support-notify/email'

const cfg = { siteUrl: 'https://cityroute.ge/', adminTo: 'cityroute.ge@gmail.com', supportEmail: 'support@cityroute.ge' }
const row = (o: Partial<OutboxRow> = {}): OutboxRow => ({
  outbox_id: 'o1', kind: 'admin_new_message', attempts: 1, message_id: 'm1',
  conversation_id: '22222222-2222-4222-8222-222222222222', body: 'გამარჯობა, გადახდა ვერ გავიდა',
  attachment_count: 0, user_id: '33333333-3333-4333-8333-333333333333', full_name: 'გიორგი', user_email: 'g@example.com', ...o,
})

describe('admin notification', () => {
  it('goes to the team Gmail with a link to the admin panel conversation', () => {
    const m = buildEmail(row(), cfg)!
    expect(m.to).toBe('cityroute.ge@gmail.com')
    expect(m.text).toContain('https://cityroute.ge/support-admin?c=22222222-2222-4222-8222-222222222222')
    expect(m.subject).toContain('33333333')
  })
  it("does not expose the customer's e-mail address", () => {
    const m = buildEmail(row(), cfg)!
    expect(m.html + m.text + m.subject).not.toContain('g@example.com')
  })
  it('mentions image count but never contains a storage / image URL', () => {
    const m = buildEmail(row({ attachment_count: 2 }), cfg)!
    expect(m.text).toContain('2 სურათი')
    expect(m.html + m.text).not.toMatch(/supabase\.co|storage|signed|\.(png|jpe?g|webp)/i)
  })
  it('escapes HTML in user text (no injection into the admin mailbox)', () => {
    const m = buildEmail(row({ body: '<script>alert(1)</script><img src=x onerror=1>' }), cfg)!
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('<img')
    expect(m.html).toContain('&lt;script&gt;')
  })
  it('truncates long messages', () => {
    const m = buildEmail(row({ body: 'x'.repeat(5000) }), cfg)!
    expect(m.text.length).toBeLessThan(900)
  })
})

describe('user reply notification', () => {
  it("goes to the user's own address and links to /support", () => {
    const m = buildEmail(row({ kind: 'user_reply', body: 'პასუხი' }), cfg)!
    expect(m.to).toBe('g@example.com')
    expect(m.text).toContain('https://cityroute.ge/support')
    expect(m.text).toContain('support@cityroute.ge')
  })
  it('returns null when the user has no e-mail (job is skipped, not failed)', () => {
    expect(buildEmail(row({ kind: 'user_reply', user_email: null }), cfg)).toBeNull()
    expect(buildEmail(row({ kind: 'user_reply', user_email: '  ' }), cfg)).toBeNull()
  })
})

describe('helpers', () => {
  it('escapeHtml', () => expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;'))
  it('preview collapses whitespace', () => expect(preview('a \n\n  b')).toBe('a b'))
})
