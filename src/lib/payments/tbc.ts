/**
 * TBC Bank Payment Integration
 * Based on TBC E-Commerce API: https://developers.tbcbank.ge/docs/checkout-api-overview
 */

export type TBCPaymentRequest = {
  amount: number // Amount in GEL
  currency: 'GEL' | 'USD' | 'EUR'
  returnUrl: string
  callbackUrl: string
  description?: string
  merchantPaymentId?: string
  userIpAddress?: string
  expirationMinutes?: number
  language?: 'KA' | 'EN'
}

export type TBCPaymentResponse = {
  payId: string
  status: 'Created' | 'Succeeded' | 'Failed' | 'Cancelled'
  currency: string
  amount: number
  approvalUrl?: string
  transactionId?: string
  recId?: string
  httpStatusCode: number
  developerMessage?: string
  userMessage?: string
}

export type TBCAccessTokenResponse = {
  access_token: string
  expires_in: number
  token_type: string
}

const TBC_API_BASE_URL = 'https://api.tbcbank.ge'
const TBC_API_VERSION = 'v1'

/**
 * Get TBC access token using client credentials
 */
export async function getTBCAccessToken(
  clientId: string,
  clientSecret: string,
  apiKey: string
): Promise<TBCAccessTokenResponse> {
  const formData = new URLSearchParams()
  formData.append('client_id', clientId)
  formData.append('client_secret', clientSecret)
  formData.append('grant_type', 'client_credentials')

  const response = await fetch(`${TBC_API_BASE_URL}/${TBC_API_VERSION}/tpay/access-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'apikey': apiKey,
    },
    body: formData.toString(),
  })

  if (!response.ok) {
    throw new Error(`TBC Access Token Error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Create TBC payment and get payment URL
 */
export async function createTBCPayment(
  accessToken: string,
  apiKey: string,
  paymentRequest: TBCPaymentRequest
): Promise<TBCPaymentResponse> {
  const requestBody = {
    amount: {
      currency: paymentRequest.currency,
      total: paymentRequest.amount,
    },
    returnurl: paymentRequest.returnUrl,
    callbackUrl: paymentRequest.callbackUrl,
    description: paymentRequest.description,
    merchantPaymentId: paymentRequest.merchantPaymentId,
    userIpAddress: paymentRequest.userIpAddress,
    expirationMinutes: paymentRequest.expirationMinutes ?? 12,
    language: paymentRequest.language ?? 'KA',
    preAuth: false,
    skipInfoMessage: false,
  }

  const response = await fetch(`${TBC_API_BASE_URL}/${TBC_API_VERSION}/tpay/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'apikey': apiKey,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `TBC Payment Creation Error: ${response.status} ${errorData.userMessage ?? response.statusText}`
    )
  }

  const data = await response.json()

  // Extract approval URL from links array
  const approvalLink = data.links?.find((link: { rel: string }) => link.rel === 'approval_url')

  return {
    payId: data.payId,
    status: data.status,
    currency: data.currency,
    amount: data.amount,
    approvalUrl: approvalLink?.uri,
    transactionId: data.transactionId,
    recId: data.recId,
    httpStatusCode: data.httpStatusCode,
    developerMessage: data.developerMessage,
    userMessage: data.userMessage,
  }
}

/**
 * Get TBC payment status
 */
export async function getTBCPaymentStatus(
  accessToken: string,
  apiKey: string,
  payId: string
): Promise<TBCPaymentResponse> {
  const response = await fetch(`${TBC_API_BASE_URL}/${TBC_API_VERSION}/tpay/payments/${payId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': apiKey,
    },
  })

  if (!response.ok) {
    throw new Error(`TBC Payment Status Error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  return {
    payId: data.payId,
    status: data.status,
    currency: data.currency,
    amount: data.amount,
    transactionId: data.transactionId,
    recId: data.recId,
    httpStatusCode: response.status,
    developerMessage: data.developerMessage,
    userMessage: data.userMessage,
  }
}

/**
 * Verify TBC callback signature (implement when TBC provides signature validation)
 */
export function verifyTBCCallback(paymentId: string, signature?: string): boolean {
  // TBC callback verification logic
  // Currently TBC sends paymentId in callback body
  // Merchant should verify by calling getTBCPaymentStatus
  return Boolean(paymentId)
}
