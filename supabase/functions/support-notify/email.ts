/**
 * Pure e-mail composition for support notifications.
 * No Deno / network / Supabase imports on purpose: it is unit-tested with
 * Vitest (src/lib/support/email.test.ts imports this file).
 *
 * Privacy rules enforced here:
 *   - the message body is never included (no passwords, no chat text);
 *   - no links to uploaded images and no image contents;
 *   - the admin e-mail shows the customer's name + a short id, not their
 *     e-mail address;
 *   - both letters only say that a new chat message exists and link to it.
 */

export type OutboxKind = 'admin_new_message' | 'user_reply'

export interface OutboxRow {
  outbox_id: string
  kind: OutboxKind
  attempts: number
  message_id: string
  conversation_id: string
  body: string
  attachment_count: number
  user_id: string
  full_name: string | null
  user_email: string | null
}

export interface EmailConfig {
  /** Public site URL without trailing slash, e.g. https://cityroute.ge */
  siteUrl: string
  /** Where "new customer message" alerts go (the team's Gmail). */
  adminTo: string
  /** Official support address, used as Reply-To / signature. */
  supportEmail: string
}

export interface BuiltEmail {
  to: string
  subject: string
  html: string
  text: string
}

export const PREVIEW_MAX = 300

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function preview(body: string, max = PREVIEW_MAX): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function normalizeSite(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Returns null when there is nobody to send to (e.g. user without e-mail). */
export function buildEmail(row: OutboxRow, cfg: EmailConfig): BuiltEmail | null {
  const site = normalizeSite(cfg.siteUrl)
  const notice = 'ჩატში ახალი შეტყობინებაა.'

  if (row.kind === 'admin_new_message') {
    const who = `${row.full_name?.trim() || 'მომხმარებელი'} (ID ${row.user_id.slice(0, 8)})`
    const link = `${site}/support-admin?c=${encodeURIComponent(row.conversation_id)}`
    return {
      to: cfg.adminTo,
      subject: 'CityRoute: ჩატში ახალი შეტყობინებაა',
      text: [notice, `ავტორი: ${who}`, '', `მხარდაჭერის ჩატი: ${link}`].join('\n'),
      html:
        `<p>${escapeHtml(notice)}</p>` +
        `<p><strong>ავტორი:</strong> ${escapeHtml(who)}</p>` +
        `<p><a href="${escapeHtml(link)}">მხარდაჭერის ჩატის გახსნა</a></p>`,
    }
  }

  const to = row.user_email?.trim()
  if (!to) return null
  const link = `${site}/support`
  const greeting = row.full_name?.trim() ? `გამარჯობა, ${row.full_name.trim()}.` : 'გამარჯობა.'
  return {
    to,
    subject: 'CityRoute: ჩატში ახალი შეტყობინებაა',
    text: [
      greeting,
      notice,
      '',
      `მხარდაჭერის ჩატი: ${link}`,
      '',
      `ეს შეტყობინება ავტომატურია. ოფიციალური ელფოსტა: ${cfg.supportEmail}`,
    ].join('\n'),
    html:
      `<p>${escapeHtml(greeting)}</p>` +
      `<p>${escapeHtml(notice)}</p>` +
      `<p><a href="${escapeHtml(link)}">მხარდაჭერის ჩატის გახსნა</a></p>` +
      `<p style="color:#64748b;font-size:12px">ეს შეტყობინება ავტომატურია. ოფიციალური ელფოსტა: ${escapeHtml(cfg.supportEmail)}</p>`,
  }
}
