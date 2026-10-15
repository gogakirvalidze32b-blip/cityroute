/**
 * support-notify — flushes the support e-mail outbox.
 *
 * What it does
 *   Claims due rows from public.support_email_outbox (service_role RPC),
 *   sends each through Resend, and records the result. A failure NEVER
 *   touches the chat message itself; the row is simply retried with
 *   back-off (1, 4, 9, 16 minutes, max 5 attempts).
 *
 * Who may call it
 *   Supabase verifies the caller's JWT before this code runs (default
 *   verify_jwt = true). The browser calls it after every sent message
 *   (fire-and-forget); a scheduled job may call it with the service key to
 *   retry stragglers. The function ignores the request body entirely, so a
 *   caller cannot influence WHAT is sent or TO WHOM — recipients come only
 *   from the database.
 *
 * Secrets (supabase secrets set ...) — never put these in the frontend:
 *   RESEND_API_KEY        required to actually send mail
 *   SUPPORT_FROM_EMAIL    e.g. "CityRoute Support <support@cityroute.ge>"
 *                         (the domain must be verified in Resend)
 *   SUPPORT_NOTIFY_TO     default: cityroute.ge@gmail.com
 *   SUPPORT_REPLY_TO      default: support@cityroute.ge
 *   SITE_URL              default: https://cityroute.ge
 *   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.)
 *
 * If RESEND_API_KEY is missing the function answers 503 WITHOUT claiming
 * any job, so queued notifications wait safely until it is configured.
 *
 * Deploy: supabase functions deploy support-notify
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildEmail, type OutboxRow } from './email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM = Deno.env.get('SUPPORT_FROM_EMAIL') ?? 'CityRoute Support <support@cityroute.ge>'
  const REPLY_TO = Deno.env.get('SUPPORT_REPLY_TO') ?? 'support@cityroute.ge'

  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: 'server_not_configured' })
  if (!RESEND_API_KEY) return json(503, { error: 'email_provider_not_configured', sent: 0 })

  const cfg = {
    siteUrl: Deno.env.get('SITE_URL') ?? 'https://cityroute.ge',
    adminTo: Deno.env.get('SUPPORT_NOTIFY_TO') ?? 'cityroute.ge@gmail.com',
    supportEmail: REPLY_TO,
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc('support_claim_email_outbox', { p_limit: 10 })
  if (error) {
    console.error('claim failed', error.message)
    return json(500, { error: 'claim_failed' })
  }

  const rows = (data ?? []) as OutboxRow[]
  let sent = 0
  let failed = 0
  let skipped = 0

  for (const row of rows) {
    try {
      const mail = buildEmail(row, cfg)
      if (!mail) {
        await supabase.rpc('support_complete_email_outbox', {
          p_outbox_id: row.outbox_id, p_ok: true, p_error: 'no_recipient', p_skipped: true,
        })
        skipped++
        continue
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          // A retry of the same job can never produce a second e-mail.
          'Idempotency-Key': `support-${row.outbox_id}`,
        },
        body: JSON.stringify({
          from: FROM,
          to: [mail.to],
          reply_to: REPLY_TO,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        }),
      })

      if (res.ok) {
        await supabase.rpc('support_complete_email_outbox', { p_outbox_id: row.outbox_id, p_ok: true })
        sent++
      } else {
        // Log the provider status only — never the key, never the body of the user's message.
        const detail = (await res.text().catch(() => '')).slice(0, 200)
        await supabase.rpc('support_complete_email_outbox', {
          p_outbox_id: row.outbox_id, p_ok: false, p_error: `resend ${res.status}: ${detail}`,
        })
        failed++
      }
    } catch (e) {
      try {
        await supabase.rpc('support_complete_email_outbox', {
          p_outbox_id: row.outbox_id, p_ok: false, p_error: String((e as Error)?.message ?? e).slice(0, 200),
        })
      } catch {
        /* the row stays 'sending' and is re-claimed after 5 minutes */
      }
      failed++
    }
  }

  return json(200, { claimed: rows.length, sent, failed, skipped })
})
