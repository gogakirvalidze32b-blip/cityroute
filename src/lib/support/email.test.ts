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
    expect(m.text).toContain('ჩატში ახალი შეტყობინებაა')
    expect(m.text).toContain('https://cityroute.ge/support-admin?c=22222222-2222-4222-8222-222222222222')
    expect(m.html).toContain('მხარდაჭერის ჩატის გახსნა')
  })
  it("does not expose the customer's e-mail address or the message text", () => {
    const secret = 'password hunter2 გადახდა ვერ გავიდა'
    const m = buildEmail(row({ body: secret, full_name: '<b>გიორგი</b>' }), cfg)!
    const all = m.html + m.text + m.subject
    expect(all).not.toContain('g@example.com')
    expect(all).not.toContain(secret)
    expect(all).not.toContain('გადახდა')
    expect(m.html).not.toContain('<b>')
    expect(m.html).toContain('&lt;b&gt;')
  })
  it('never contains a storage / image URL or the attachment contents', () => {
    const m = buildEmail(row({ attachment_count: 2, body: 'სურათის აღწერა' }), cfg)!
    expect(m.html + m.text).not.toMatch(/supabase\.co|storage|signed|\.(png|jpe?g|webp)|სურათის აღწერა/i)
  })
})

describe('user reply notification', () => {
  it("goes to the user's own address and links to /support", () => {
    const m = buildEmail(row({ kind: 'user_reply', body: 'პასუხი' }), cfg)!
    expect(m.to).toBe('g@example.com')
    expect(m.text).toContain('ჩატში ახალი შეტყობინებაა')
    expect(m.text).toContain('https://cityroute.ge/support')
    expect(m.text).not.toContain('პასუხი')
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
