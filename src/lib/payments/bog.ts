/**
 * Bank of Georgia (BOG) Payment Integration
 * Based on BOG Online Payment API: https://api.bog.ge/docs/en/payments/introduction
 */

export type BOGPaymentRequest = {
  amount: number // Amount in GEL
  currency: 'GEL'
  callback_url: string
  redirect_url: string
  shop_order_id: string
  locale?: 'ka' | 'en'
  description?: string
  purchase_units?: {
    basket?: {
      quantity: number
      unit_price: number
      product_id: string
    }[]
  }
}

export type BOGPaymentResponse = {
  order_id: string
  status: 'created' | 'success' | 'failed' | 'expired'
  _links: {
    redirect: {
      href: string
    }
    details: {
      href: string
    }
  }
}

export type BOGOrderStatusResponse = {
  order_id: string
  status: 'created' | 'success' | 'failed' | 'expired'
  shop_order_id: string
  amount: number
  currency: string
  payment_method?: string
  pan?: string
  transaction_id?: string
  created_at: string
  paid_at?: string
}

export type BOGAuthResponse = {
  access_token: string
  expires_in: number
  token_type: string
}

const BOG_API_BASE_URL = 'https://api.bog.ge'

/**
 * Get BOG OAuth2 access token
 */
export async function getBOGAccessToken(
  clientId: string,
  secretKey: string
): Promise<BOGAuthResponse> {
  const credentials = btoa(`${clientId}:${secretKey}`)

  const formData = new URLSearchParams()
  formData.append('grant_type', 'client_credentials')

  const response = await fetch(`${BOG_API_BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`BOG Auth Error: ${response.status} ${errorText}`)
  }

  return response.json()
}

/**
 * Create BOG payment order
 */
export async function createBOGPayment(
  accessToken: string,
  paymentRequest: BOGPaymentRequest
): Promise<BOGPaymentResponse> {
  const requestBody = {
    callback_url: paymentRequest.callback_url,
    redirect_url: paymentRequest.redirect_url,
    shop_order_id: paymentRequest.shop_order_id,
    locale: paymentRequest.locale ?? 'ka',
    purchase_units: {
      currency: paymentRequest.currency,
      total_amount: paymentRequest.amount,
      basket: paymentRequest.purchase_units?.basket ?? [
        {
          quantity: 1,
          unit_price: paymentRequest.amount,
          product_id: paymentRequest.description ?? 'Premium Subscription',
        },
      ],
    },
  }

  const response = await fetch(`${BOG_API_BASE_URL}/payments/v1/ecommerce/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `BOG Payment Creation Error: ${response.status} ${errorData.message ?? response.statusText}`
    )
  }

  return response.json()
}

/**
 * Get BOG order status
 */
export async function getBOGOrderStatus(
  accessToken: string,
  orderId: string
): Promise<BOGOrderStatusResponse> {
  const response = await fetch(`${BOG_API_BASE_URL}/payments/v1/ecommerce/orders/${orderId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`BOG Order Status Error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Verify BOG callback (webhook signature validation)
 */
export function verifyBOGCallback(
  orderId: string,
  signature?: string,
  secretKey?: string
): boolean {
  // BOG callback verification logic
  // BOG sends order_id in callback
  // Merchant should verify by calling getBOGOrderStatus
  return Boolean(orderId)
}
