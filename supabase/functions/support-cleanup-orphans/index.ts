/**
 * support-cleanup-orphans — removes uploaded support images that never became
 * part of a message (abandoned / failed sends) or whose message was deleted.
 *
 * Only callable with the SERVICE ROLE key (Authorization: Bearer <key>), e.g.
 * from a scheduled job. Ordinary user JWTs are rejected. Files younger than
 * 1 day are never touched, so an upload that is still being sent is safe.
 *
 * Deploy: supabase functions deploy support-cleanup-orphans
 * Schedule (example, Supabase SQL editor with pg_cron + pg_net) — see INSTALL.md.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: 'server_not_configured' })

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token || !safeEqual(token, SERVICE_KEY)) return json(403, { error: 'forbidden' })

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc('support_orphan_uploads', { p_older_than: '1 day', p_limit: 500 })
  if (error) {
    console.error('orphan query failed', error.message)
    return json(500, { error: 'query_failed' })
  }

  const names = ((data ?? []) as { name: string }[]).map((r) => r.name)
  if (names.length === 0) return json(200, { removed: 0 })

  const { data: removed, error: rmError } = await supabase.storage.from('support-attachments').remove(names)
  if (rmError) {
    console.error('remove failed', rmError.message)
    return json(500, { error: 'remove_failed' })
  }
  return json(200, { found: names.length, removed: removed?.length ?? 0 })
})
