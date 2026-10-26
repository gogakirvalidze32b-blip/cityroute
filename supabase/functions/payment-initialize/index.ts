import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createBogIdempotencyKey, createBogOrder } from '../_shared/bog-payment.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const BOG_CLIENT_KEY = Deno.env.get('BOG_CLIENT_KEY') ?? Deno.env.get('BOG_CLIENT_ID')
const BOG_SECRET_KEY = Deno.env.get('BOG_SECRET_KEY')
const APP_URL = Deno.env.get('APP_URL')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    if (
      !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY ||
      !BOG_CLIENT_KEY || !BOG_SECRET_KEY || !APP_URL
    ) {
      return jsonResponse({ error: 'Preview BOG payment is not fully configured' }, 503)
    }

    const appUrl = new URL(APP_URL)
    const supabaseUrl = new URL(SUPABASE_URL)
    if (appUrl.protocol !== 'https:' || supabaseUrl.protocol !== 'https:') {
      return jsonResponse({ error: 'Preview app and Supabase URLs must use HTTPS' }, 503)
    }
    if (
      appUrl.hostname === 'cityroute.ge' ||
      appUrl.hostname === 'www.cityroute.ge' ||
      !appUrl.hostname.endsWith('.vercel.app')
    ) {
      return jsonResponse({ error: 'Sandbox payments cannot return to the Production site' }, 503)
    }
    if (req.headers.get('Origin') !== appUrl.origin) {
      return jsonResponse({ error: 'Sandbox payments are available only from the configured Preview site' }, 403)
    }

    const authorization = req.headers.get('Authorization')
    if (!authorization) return jsonResponse({ error: 'Authentication is required' }, 401)

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401)

    let body: { provider?: unknown; deviceSlots?: unknown; requestId?: unknown }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body' }, 400)
    }

    if (body.provider !== 'bog') {
      return jsonResponse({ error: 'მხოლოდ საქართველოს ბანკით გადახდაა ხელმისაწვდომი' }, 400)
    }
    if (body.deviceSlots !== 1 && body.deviceSlots !== 2) {
      return jsonResponse({ error: 'აირჩიე 1 ან 2 მანქანის პაკეტი' }, 400)
    }
    if (
      typeof body.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
    ) {
      return jsonResponse({ error: 'გადახდის მოთხოვნის იდენტიფიკატორი არასწორია' }, 400)
    }

    const deviceSlots = body.deviceSlots
    const amount = deviceSlots === 2 ? 179 : 99
    const idempotencyKey = await createBogIdempotencyKey(user.id, body.requestId)
    const merchantPaymentId = `cr-${idempotencyKey}`
    const successUrl = new URL('/payment/return', appUrl)
    successUrl.searchParams.set('provider', 'bog')
    successUrl.searchParams.set('merchantPaymentId', merchantPaymentId)
    const failUrl = new URL(successUrl)
    failUrl.searchParams.set('checkout', 'not-completed')

    const payment = await createBogOrder({
      credentials: { clientKey: BOG_CLIENT_KEY, secretKey: BOG_SECRET_KEY },
      idempotencyKey,
      merchantPaymentId,
      deviceSlots,
      amount,
      callbackUrl: new URL('/functions/v1/payment-webhook-bog', supabaseUrl).toString(),
      successUrl: successUrl.toString(),
      failUrl: failUrl.toString(),
    })

    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: transactionError } = await adminClient.rpc('create_bog_sandbox_payment_transaction', {
      p_user_id: user.id,
      p_payment_id: payment.paymentId,
      p_merchant_payment_id: merchantPaymentId,
      p_idempotency_key: idempotencyKey,
      p_amount: amount,
      p_currency: 'GEL',
      p_metadata: { provider: 'bog', device_slots: deviceSlots },
    })

    if (transactionError) {
      console.error('Failed to record BOG transaction:', transactionError.message)
      return jsonResponse({ error: 'გადახდის შეკვეთა ვერ შეინახა. ბანკის გვერდზე გადასვლა გაუქმებულია.' }, 500)
    }

    return jsonResponse({
      success: true,
      paymentId: payment.paymentId,
      paymentUrl: payment.paymentUrl,
      amount,
    }, 200)
  } catch (error) {
    console.error('BOG sandbox payment initialization failed:', safeErrorMessage(error))
    return jsonResponse({ error: 'გადახდა ვერ დაიწყო. სცადე მოგვიანებით.' }, 500)
  }
})

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
