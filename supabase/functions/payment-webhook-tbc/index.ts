/**
 * TBC Bank Payment Webhook Handler
 * Receives callbacks from TBC Bank when payment status changes
 * 
 * Deploy: supabase functions deploy payment-webhook-tbc
 * URL: https://<project-ref>.supabase.co/functions/v1/payment-webhook-tbc
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TBC_API_KEY = Deno.env.get('TBC_API_KEY')!
const TBC_CLIENT_ID = Deno.env.get('TBC_CLIENT_ID')!
const TBC_CLIENT_SECRET = Deno.env.get('TBC_CLIENT_SECRET')!

serve(async (req) => {
  try {
    // Only accept POST requests
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Parse callback payload
    const payload = await req.json()
    const paymentId = payload.PaymentId || payload.paymentId

    if (!paymentId) {
      console.error('Missing PaymentId in callback', payload)
      return new Response(JSON.stringify({ error: 'Missing PaymentId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log('TBC Callback received:', { paymentId })

    // Get access token from TBC
    const tokenFormData = new URLSearchParams()
    tokenFormData.append('client_id', TBC_CLIENT_ID)
    tokenFormData.append('client_secret', TBC_CLIENT_SECRET)
    tokenFormData.append('grant_type', 'client_credentials')

    const tokenResponse = await fetch('https://api.tbcbank.ge/v1/tpay/access-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'apikey': TBC_API_KEY,
      },
      body: tokenFormData.toString(),
    })

    if (!tokenResponse.ok) {
      throw new Error(`Failed to get TBC access token: ${tokenResponse.status}`)
    }

    const { access_token } = await tokenResponse.json()

    // Verify payment status with TBC
    const paymentResponse = await fetch(`https://api.tbcbank.ge/v1/tpay/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'apikey': TBC_API_KEY,
      },
    })

    if (!paymentResponse.ok) {
      throw new Error(`Failed to get payment status: ${paymentResponse.status}`)
    }

    const paymentData = await paymentResponse.json()
    console.log('TBC Payment status:', paymentData)

    // Map TBC status to our internal status
    let status = 'pending'
    if (paymentData.status === 'Succeeded') {
      status = 'success'
    } else if (paymentData.status === 'Failed') {
      status = 'failed'
    } else if (paymentData.status === 'Cancelled') {
      status = 'cancelled'
    }

    // Update payment transaction in Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data, error } = await supabase.rpc('update_payment_status', {
      p_provider: 'tbc',
      p_payment_id: paymentId,
      p_status: status,
      p_transaction_id: paymentData.transactionId,
      p_metadata: {
        currency: paymentData.currency,
        amount: paymentData.amount,
        recId: paymentData.recId,
        callback_received_at: new Date().toISOString(),
      },
    })

    if (error) {
      console.error('Failed to update payment status:', error)
      throw error
    }

    console.log('Payment updated successfully:', data)

    // TBC expects 200 status
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('TBC webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
