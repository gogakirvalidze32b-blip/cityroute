/**
 * Pure e-mail composition for support notifications.
 * No Deno / network / Supabase imports on purpose: it is unit-tested with
 * Vitest (src/lib/support/email.test.ts imports this file).
 *
 * Privacy rules enforced here:
 *   - no links to uploaded images (they live in a private bucket) — only a
 *     count such as "2 images attached";
 *   - the admin e-mail shows the customer's name + a short id, not their
 *     e-mail address or anything else from the profile;
 *   - the message preview is truncated.
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

function imagesLine(n: number): string {
  if (n <= 0) return ''
  return n === 1 ? '📎 დართულია 1 სურათი' : `📎 დართულია ${n} სურათი`
}

/** Returns null when there is nobody to send to (e.g. user without e-mail). */
export function buildEmail(row: OutboxRow, cfg: EmailConfig): BuiltEmail | null {
  const site = normalizeSite(cfg.siteUrl)
  const text = preview(row.body)
  const imgs = imagesLine(row.attachment_count)

  if (row.kind === 'admin_new_message') {
    const who = `${row.full_name?.trim() || 'მომხმარებელი'} (ID ${row.user_id.slice(0, 8)})`
    const link = `${site}/support-admin?c=${encodeURIComponent(row.conversation_id)}`
    const lines = [`ახალი შეტყობინება მხარდაჭერის ჩატში.`, `ავტორი: ${who}`, '', text || '(ტექსტის გარეშე)']
    if (imgs) lines.push('', imgs)
    lines.push('', `პანელში გახსნა: ${link}`)
    return {
      to: cfg.adminTo,
      subject: `CityRoute Support: ახალი შეტყობინება — ${who}`,
      text: lines.join('\n'),
      html:
        `<p>ახალი შეტყობინება მხარდაჭერის ჩატში.</p>` +
        `<p><strong>ავტორი:</strong> ${escapeHtml(who)}</p>` +
        `<blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #0f766e;background:#f1f5f9;white-space:pre-wrap">${escapeHtml(text || '(ტექსტის გარეშე)')}</blockquote>` +
        (imgs ? `<p>${escapeHtml(imgs)}</p>` : '') +
        `<p><a href="${escapeHtml(link)}">პანელში გახსნა</a></p>`,
    }
  }

  // user_reply
  const to = row.user_email?.trim()
  if (!to) return null
  const link = `${site}/support`
  const greeting = row.full_name?.trim() ? `გამარჯობა, ${row.full_name.trim()}.` : 'გამარჯობა.'
  return {
    to,
    subject: 'CityRoute: მხარდაჭერამ გიპასუხათ',
    text: [
      greeting,
      'CityRoute-ის მხარდაჭერამ პასუხი გამოგიგზავნათ:',
      '',
      text,
      '',
      `სრული მიმოწერა და პასუხის გაგზავნა: ${link}`,
      '',
      `ეს შეტყობინება ავტომატურია. ოფიციალური ელფოსტა: ${cfg.supportEmail}`,
    ].join('\n'),
    html:
      `<p>${escapeHtml(greeting)}</p>` +
      `<p>CityRoute-ის მხარდაჭერამ პასუხი გამოგიგზავნათ:</p>` +
      `<blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #0f766e;background:#f1f5f9;white-space:pre-wrap">${escapeHtml(text)}</blockquote>` +
      `<p><a href="${escapeHtml(link)}">სრული მიმოწერა და პასუხის გაგზავნა</a></p>` +
      `<p style="color:#64748b;font-size:12px">ეს შეტყობინება ავტომატურია. ოფიციალური ელფოსტა: ${escapeHtml(cfg.supportEmail)}</p>`,
  }
}
