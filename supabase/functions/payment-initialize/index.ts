/**
 * Payment Initialization Edge Function
 * Creates payment with TBC or BOG and returns payment URL
 * 
 * Deploy: supabase functions deploy payment-initialize
 * URL: https://<project-ref>.supabase.co/functions/v1/payment-initialize
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const TBC_API_KEY = Deno.env.get('TBC_API_KEY')!
const TBC_CLIENT_ID = Deno.env.get('TBC_CLIENT_ID')!
const TBC_CLIENT_SECRET = Deno.env.get('TBC_CLIENT_SECRET')!
const BOG_CLIENT_ID = Deno.env.get('BOG_CLIENT_ID')!
const BOG_SECRET_KEY = Deno.env.get('BOG_SECRET_KEY')!
const APP_URL = Deno.env.get('APP_URL') || 'https://cityroute.vercel.app'

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
    // Get auth token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Create Supabase client with user's token
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse request body
    const { provider, amount } = await req.json()

    if (!provider || !amount) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
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

    const merchantPaymentId = `cityroute-${user.id.substring(0, 8)}-${Date.now()}`
    const returnUrl = `${APP_URL}/payment/return?provider=${provider}`
    const callbackUrl = `${SUPABASE_URL}/functions/v1/payment-webhook-${provider}`

    let paymentResult

    if (provider === 'tbc') {
      paymentResult = await initializeTBCPayment(
        amount,
        merchantPaymentId,
        returnUrl,
        callbackUrl
      )
    } else {
      paymentResult = await initializeBOGPayment(
        amount,
        merchantPaymentId,
        returnUrl,
        callbackUrl
      )
    }

    if (!paymentResult.success) {
      return new Response(JSON.stringify({ error: paymentResult.error }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Store transaction in database
    const { error: dbError } = await supabase.rpc('create_payment_transaction', {
      p_provider: provider,
      p_payment_id: paymentResult.paymentId,
      p_merchant_payment_id: merchantPaymentId,
      p_amount: amount,
      p_currency: 'GEL',
      p_metadata: { provider, created_at: new Date().toISOString() },
    })

    if (dbError) {
      console.error('Failed to create payment transaction:', dbError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        paymentId: paymentResult.paymentId,
        paymentUrl: paymentResult.paymentUrl,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Payment initialization error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function initializeTBCPayment(
  amount: number,
  merchantPaymentId: string,
  returnUrl: string,
  callbackUrl: string
) {
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

    // Create payment
    const paymentBody = {
      amount: {
        currency: 'GEL',
        total: amount,
      },
      returnurl: returnUrl,
      callbackUrl: callbackUrl,
      description: 'CityRoute პრემიუმ გამოწერა',
      merchantPaymentId: merchantPaymentId,
      expirationMinutes: 30,
      language: 'KA',
      preAuth: false,
    }

    const paymentResponse = await fetch('https://api.tbcbank.ge/v1/tpay/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`,
        'apikey': TBC_API_KEY,
      },
      body: JSON.stringify(paymentBody),
    })

    if (!paymentResponse.ok) {
      const errorData = await paymentResponse.json()
      throw new Error(errorData.userMessage || 'Failed to create TBC payment')
    }

    const paymentData = await paymentResponse.json()
    const approvalLink = paymentData.links?.find((link: any) => link.rel === 'approval_url')

    return {
      success: true,
      paymentId: paymentData.payId,
      paymentUrl: approvalLink?.uri,
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function initializeBOGPayment(
  amount: number,
  merchantPaymentId: string,
  returnUrl: string,
  callbackUrl: string
) {
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

    // Create payment
    const paymentBody = {
      callback_url: callbackUrl,
      redirect_url: returnUrl,
      shop_order_id: merchantPaymentId,
      locale: 'ka',
      purchase_units: {
        currency: 'GEL',
        total_amount: amount,
        basket: [
          {
            quantity: 1,
            unit_price: amount,
            product_id: 'CityRoute პრემიუმ გამოწერა',
          },
        ],
      },
    }

    const paymentResponse = await fetch('https://api.bog.ge/payments/v1/ecommerce/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(paymentBody),
    })

    if (!paymentResponse.ok) {
      const errorData = await paymentResponse.json()
      throw new Error(errorData.message || 'Failed to create BOG payment')
    }

    const paymentData = await paymentResponse.json()

    return {
      success: true,
      paymentId: paymentData.order_id,
      paymentUrl: paymentData._links?.redirect?.href,
    }
  } catch (error) {
    return { success: false, error: error.message }
  }
}
