/**
 * Bank of Georgia (BOG) Payment Webhook Handler
 * Receives callbacks from BOG when payment status changes
 * 
 * Deploy: supabase functions deploy payment-webhook-bog
 * URL: https://<project-ref>.supabase.co/functions/v1/payment-webhook-bog
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BOG_CLIENT_ID = Deno.env.get('BOG_CLIENT_ID')!
const BOG_SECRET_KEY = Deno.env.get('BOG_SECRET_KEY')!

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
    const orderId = payload.order_id

    if (!orderId) {
      console.error('Missing order_id in callback', payload)
      return new Response(JSON.stringify({ error: 'Missing order_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log('BOG Callback received:', { orderId })

    // Get OAuth2 access token from BOG
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
      throw new Error(`Failed to get BOG access token: ${tokenResponse.status}`)
    }

    const { access_token } = await tokenResponse.json()

    // Verify payment status with BOG
    const orderResponse = await fetch(`https://api.bog.ge/payments/v1/ecommerce/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept': 'application/json',
      },
    })

    if (!orderResponse.ok) {
      throw new Error(`Failed to get order status: ${orderResponse.status}`)
    }

    const orderData = await orderResponse.json()
    console.log('BOG Order status:', orderData)

    // Map BOG status to our internal status
    let status = 'pending'
    if (orderData.status === 'success') {
      status = 'success'
    } else if (orderData.status === 'failed') {
      status = 'failed'
    } else if (orderData.status === 'expired') {
      status = 'cancelled'
    }

    // Update payment transaction in Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data, error } = await supabase.rpc('update_payment_status', {
      p_provider: 'bog',
      p_payment_id: orderId,
      p_status: status,
      p_transaction_id: orderData.transaction_id,
      p_metadata: {
        shop_order_id: orderData.shop_order_id,
        amount: orderData.amount,
        currency: orderData.currency,
        payment_method: orderData.payment_method,
        pan: orderData.pan,
        paid_at: orderData.paid_at,
        callback_received_at: new Date().toISOString(),
      },
    })

    if (error) {
      console.error('Failed to update payment status:', error)
      throw error
    }

    console.log('Payment updated successfully:', data)

    // BOG expects 200 status
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('BOG webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
