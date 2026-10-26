import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  canApplyBogPaymentStatus,
  getBogOrderDetails,
  toPersistedBogPaymentStatus,
  verifyBogOrderDetails,
} from '../_shared/bog-payment.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const BOG_CLIENT_KEY = Deno.env.get('BOG_CLIENT_KEY') ?? Deno.env.get('BOG_CLIENT_ID')
const BOG_SECRET_KEY = Deno.env.get('BOG_SECRET_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    if (
      !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY ||
      !BOG_CLIENT_KEY || !BOG_SECRET_KEY
    ) {
      return jsonResponse({ error: 'Preview BOG verification is not configured' }, 503)
    }

    const authorization = req.headers.get('Authorization')
    if (!authorization) return jsonResponse({ error: 'Authentication is required' }, 401)

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401)

    const url = new URL(req.url)
    if (url.searchParams.get('provider') !== 'bog') {
      return jsonResponse({ error: 'Invalid payment provider' }, 400)
    }
    const paymentId = url.searchParams.get('paymentId')
    const merchantPaymentId = url.searchParams.get('merchantPaymentId')
    if ((!paymentId && !merchantPaymentId) || (paymentId && merchantPaymentId)) {
      return jsonResponse({ error: 'Exactly one payment identifier is required' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    let transactionQuery = admin
      .from('bog_sandbox_payment_transactions')
      .select('payment_id, merchant_payment_id, amount, currency, status')
      .eq('user_id', user.id)
    transactionQuery = paymentId
      ? transactionQuery.eq('payment_id', paymentId)
      : transactionQuery.eq('merchant_payment_id', merchantPaymentId)
    const { data: transaction, error: transactionError } = await transactionQuery.maybeSingle()

    if (transactionError) throw transactionError
    if (!transaction || !transaction.merchant_payment_id) {
      return jsonResponse({ error: 'Payment transaction was not found' }, 404)
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
    let status = transaction.status
    if (canApplyBogPaymentStatus(transaction.status, persistedStatus)) {
      const { error: updateError } = await admin.rpc('update_bog_sandbox_payment_status', {
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
          verified_at: new Date().toISOString(),
        },
      })
      if (updateError) throw updateError

      const { data: updatedTransaction, error: updatedTransactionError } = await admin
        .from('bog_sandbox_payment_transactions')
        .select('status')
        .eq('payment_id', transaction.payment_id)
        .maybeSingle()
      if (updatedTransactionError) throw updatedTransactionError
      if (!updatedTransaction) throw new Error('Payment transaction disappeared after verification')
      status = updatedTransaction.status
    }

    return jsonResponse({
      status,
      sandbox: true,
      statusIsUnknown: verified.status === 'unknown',
      bankStatus: verified.bankStatus,
      transactionId: verified.transactionId,
    }, 200)
  } catch (error) {
    console.error('BOG sandbox verification failed:', safeErrorMessage(error))
    return jsonResponse({ error: 'გადახდის შემოწმება ვერ მოხერხდა' }, 500)
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
