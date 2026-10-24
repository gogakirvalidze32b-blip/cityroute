import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  getBogOrderDetails,
  canApplyBogPaymentStatus,
  toPersistedBogPaymentStatus,
  verifyBogCallbackSignature,
  verifyBogOrderDetails,
} from '../_shared/bog-payment.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const BOG_CLIENT_KEY = Deno.env.get('BOG_CLIENT_KEY') ?? Deno.env.get('BOG_CLIENT_ID')
const BOG_SECRET_KEY = Deno.env.get('BOG_SECRET_KEY')

serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BOG_CLIENT_KEY || !BOG_SECRET_KEY) {
      return jsonResponse({ error: 'Preview BOG callback is not configured' }, 503)
    }

    const rawBody = await req.text()
    const signature = req.headers.get('Callback-Signature')
    if (!await verifyBogCallbackSignature(rawBody, signature)) {
      return jsonResponse({ error: 'Invalid BOG callback signature' }, 401)
    }

    const callback: {
      event?: unknown
      body?: { order_id?: unknown }
    } = JSON.parse(rawBody)
    if (callback.event !== 'order_payment' || typeof callback.body?.order_id !== 'string') {
      return jsonResponse({ error: 'Invalid BOG callback body' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: transaction, error: transactionError } = await admin
      .from('payment_transactions')
      .select('payment_id, merchant_payment_id, amount, currency, status')
      .eq('provider', 'bog')
      .eq('payment_id', callback.body.order_id)
      .maybeSingle()

    if (transactionError) throw transactionError
    if (!transaction || !transaction.merchant_payment_id) {
      return jsonResponse({ error: 'BOG transaction was not found' }, 404)
    }

    const details = await getBogOrderDetails(
      { clientKey: BOG_CLIENT_KEY, secretKey: BOG_SECRET_KEY },
      transaction.payment_id,
    )
    const verified = verifyBogOrderDetails(details, {
      orderId: transaction.payment_id,
      externalOrderId: transaction.merchant_payment_id,
      amount: Number(transaction.amount),
      currency: transaction.currency,
    })
    const persistedStatus = toPersistedBogPaymentStatus(verified.status)

    if (!canApplyBogPaymentStatus(transaction.status, persistedStatus)) {
      return jsonResponse({ success: true, duplicateOrStale: true }, 200)
    }

    const { error: updateError } = await admin.rpc('update_payment_status', {
      p_provider: 'bog',
      p_payment_id: transaction.payment_id,
      p_status: persistedStatus,
      p_transaction_id: verified.transactionId,
      p_metadata: {
        bank_status: verified.bankStatus,
        bank_amount: verified.amount,
        bank_refund_amount: verified.refundAmount,
        bank_currency: verified.currency,
        bank_external_order_id: verified.externalOrderId,
        bank_status_unknown: verified.status === 'unknown',
        callback_verified_at: new Date().toISOString(),
      },
    })
    if (updateError) throw updateError

    return jsonResponse({ success: true }, 200)
  } catch (error) {
    console.error('BOG sandbox callback failed:', safeErrorMessage(error))
    return jsonResponse({ error: 'BOG callback could not be processed' }, 500)
  }
})

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
