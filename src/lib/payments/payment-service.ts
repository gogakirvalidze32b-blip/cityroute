/**
 * Unified Payment Service for TBC and BOG banks
 */

import { createTBCPayment, getTBCAccessToken, getTBCPaymentStatus } from './tbc'
import { createBOGPayment, getBOGAccessToken, getBOGOrderStatus } from './bog'

export type PaymentProvider = 'tbc' | 'bog'

export type PaymentConfig = {
  tbc: {
    clientId: string
    clientSecret: string
    apiKey: string
  }
  bog: {
    clientId: string
    secretKey: string
  }
}

export type CreatePaymentParams = {
  provider: PaymentProvider
  amount: number
  userId: string
  userEmail: string
  returnUrl: string
  callbackUrl: string
}

export type PaymentResult = {
  success: boolean
  paymentId: string
  paymentUrl?: string
  error?: string
}

/**
 * Initialize payment with selected provider
 */
export async function initializePayment(
  config: PaymentConfig,
  params: CreatePaymentParams
): Promise<PaymentResult> {
  try {
    if (params.provider === 'tbc') {
      return await initializeTBCPayment(config.tbc, params)
    } else if (params.provider === 'bog') {
      return await initializeBOGPayment(config.bog, params)
    } else {
      return {
        success: false,
        paymentId: '',
        error: 'არასწორი გადახდის პროვაიდერი',
      }
    }
  } catch (error) {
    console.error('Payment initialization error:', error)
    return {
      success: false,
      paymentId: '',
      error: error instanceof Error ? error.message : 'გადახდის ინიციალიზაცია ვერ მოხერხდა',
    }
  }
}

/**
 * Initialize TBC payment
 */
async function initializeTBCPayment(
  tbcConfig: PaymentConfig['tbc'],
  params: CreatePaymentParams
): Promise<PaymentResult> {
  // Get access token
  const tokenResponse = await getTBCAccessToken(
    tbcConfig.clientId,
    tbcConfig.clientSecret,
    tbcConfig.apiKey
  )

  // Create payment
  const merchantPaymentId = `cityroute-${params.userId}-${Date.now()}`
  const paymentResponse = await createTBCPayment(tokenResponse.access_token, tbcConfig.apiKey, {
    amount: params.amount,
    currency: 'GEL',
    returnUrl: params.returnUrl,
    callbackUrl: params.callbackUrl,
    description: 'CityRoute პრემიუმ გამოწერა',
    merchantPaymentId,
    expirationMinutes: 30,
    language: 'KA',
  })

  if (!paymentResponse.approvalUrl) {
    return {
      success: false,
      paymentId: paymentResponse.payId,
      error: 'გადახდის URL ვერ მოიძებნა',
    }
  }

  return {
    success: true,
    paymentId: paymentResponse.payId,
    paymentUrl: paymentResponse.approvalUrl,
  }
}

/**
 * Initialize BOG payment
 */
async function initializeBOGPayment(
  bogConfig: PaymentConfig['bog'],
  params: CreatePaymentParams
): Promise<PaymentResult> {
  // Get access token
  const tokenResponse = await getBOGAccessToken(bogConfig.clientId, bogConfig.secretKey)

  // Create payment
  const shopOrderId = `cityroute-${params.userId}-${Date.now()}`
  const paymentResponse = await createBOGPayment(tokenResponse.access_token, {
    amount: params.amount,
    currency: 'GEL',
    callback_url: params.callbackUrl,
    redirect_url: params.returnUrl,
    shop_order_id: shopOrderId,
    locale: 'ka',
    description: 'CityRoute პრემიუმ გამოწერა',
  })

  if (!paymentResponse._links?.redirect?.href) {
    return {
      success: false,
      paymentId: paymentResponse.order_id,
      error: 'გადახდის URL ვერ მოიძებნა',
    }
  }

  return {
    success: true,
    paymentId: paymentResponse.order_id,
    paymentUrl: paymentResponse._links.redirect.href,
  }
}

/**
 * Verify payment status
 */
export async function verifyPaymentStatus(
  config: PaymentConfig,
  provider: PaymentProvider,
  paymentId: string
): Promise<{ status: 'success' | 'failed' | 'pending'; transactionId?: string }> {
  try {
    if (provider === 'tbc') {
      const token = await getTBCAccessToken(
        config.tbc.clientId,
        config.tbc.clientSecret,
        config.tbc.apiKey
      )
      const status = await getTBCPaymentStatus(token.access_token, config.tbc.apiKey, paymentId)

      if (status.status === 'Succeeded') {
        return { status: 'success', transactionId: status.transactionId }
      } else if (status.status === 'Failed' || status.status === 'Cancelled') {
        return { status: 'failed' }
      } else {
        return { status: 'pending' }
      }
    } else if (provider === 'bog') {
      const token = await getBOGAccessToken(config.bog.clientId, config.bog.secretKey)
      const status = await getBOGOrderStatus(token.access_token, paymentId)

      if (status.status === 'success') {
        return { status: 'success', transactionId: status.transaction_id }
      } else if (status.status === 'failed' || status.status === 'expired') {
        return { status: 'failed' }
      } else {
        return { status: 'pending' }
      }
    }

    return { status: 'failed' }
  } catch (error) {
    console.error('Payment verification error:', error)
    return { status: 'failed' }
  }
}
