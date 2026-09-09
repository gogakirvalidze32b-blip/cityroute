/**
 * Payment Verification Edge Function
 * Verifies payment status after user returns from bank page
 * 
 * Deploy: supabase functions deploy payment-verify
 * URL: https://<project-ref>.supabase.co/functions/v1/payment-verify
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TBC_API_KEY = Deno.env.get('TBC_API_KEY')!
const TBC_CLIENT_ID = Deno.env.get('TBC_CLIENT_ID')!
const TBC_CLIENT_SECRET = Deno.env.get('TBC_CLIENT_SECRET')!
const BOG_CLIENT_ID = Deno.env.get('BOG_CLIENT_ID')!
const BOG_SECRET_KEY = Deno.env.get('BOG_SECRET_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse query parameters
    const url = new URL(req.url)
    const paymentId = url.searchParams.get('paymentId')
    const provider = url.searchParams.get('provider')

    if (!paymentId || !provider) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (provider !== 'tbc' && provider !== 'bog') {
      return new Response(JSON.stringify({ error: 'Invalid provider' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let status = 'pending'
    let transactionId = null

    if (provider === 'tbc') {
      const result = await verifyTBCPayment(paymentId)
      status = result.status
      transactionId = result.transactionId
    } else {
      const result = await verifyBOGPayment(paymentId)
      status = result.status
      transactionId = result.transactionId
    }

    // Update payment status in database
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    const { error: updateError } = await supabase.rpc('update_payment_status', {
      p_provider: provider,
      p_payment_id: paymentId,
      p_status: status,
      p_transaction_id: transactionId,
      p_metadata: { verified_at: new Date().toISOString() },
    })

    if (updateError) {
      console.error('Failed to update payment:', updateError)
    }

    return new Response(
      JSON.stringify({
        status: status,
        transactionId: transactionId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Payment verification error:', error)
    return new Response(JSON.stringify({ error: error.message, status: 'failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function verifyTBCPayment(paymentId: string) {
  try {
    // Get access token
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
      throw new Error('Failed to get TBC access token')
    }

    const { access_token } = await tokenResponse.json()

    // Get payment status
    const paymentResponse = await fetch(`https://api.tbcbank.ge/v1/tpay/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'apikey': TBC_API_KEY,
      },
    })

    if (!paymentResponse.ok) {
      throw new Error('Failed to get payment status')
    }

    const paymentData = await paymentResponse.json()

    let status = 'pending'
    if (paymentData.status === 'Succeeded') {
      status = 'success'
    } else if (paymentData.status === 'Failed') {
      status = 'failed'
    } else if (paymentData.status === 'Cancelled') {
      status = 'cancelled'
    }

    return {
      status: status,
      transactionId: paymentData.transactionId,
    }
  } catch (error) {
    console.error('TBC verification error:', error)
    return { status: 'failed', transactionId: null }
  }
}

async function verifyBOGPayment(orderId: string) {
  try {
    // Get access token
    const credentials = btoa(`${BOG_CLIENT_ID}:${BOG_SECRET_KEY}`)
    const tokenFormData = new URLSearchParams()
    tokenFormData.append('grant_type', 'client_credentials')

    const tokenResponse = await fetch('https://api.bog.ge/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenFormData.toString(),
    })

    if (!tokenResponse.ok) {
      throw new Error('Failed to get BOG access token')
    }

    const { access_token } = await tokenResponse.json()

    // Get order status
    const orderResponse = await fetch(`https://api.bog.ge/payments/v1/ecommerce/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept': 'application/json',
      },
    })

    if (!orderResponse.ok) {
      throw new Error('Failed to get order status')
    }

    const orderData = await orderResponse.json()

    let status = 'pending'
    if (orderData.status === 'success') {
      status = 'success'
    } else if (orderData.status === 'failed') {
      status = 'failed'
    } else if (orderData.status === 'expired') {
      status = 'cancelled'
    }

    return {
      status: status,
      transactionId: orderData.transaction_id,
    }
  } catch (error) {
    console.error('BOG verification error:', error)
    return { status: 'failed', transactionId: null }
  }
}
