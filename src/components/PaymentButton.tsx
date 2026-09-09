import { useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import type { PaymentProvider } from '@/lib/payments/payment-service'

type PaymentButtonProps = {
  provider: PaymentProvider
  amount: number
  onPaymentInitiated?: (paymentId: string, paymentUrl: string) => void
  onError?: (error: string) => void
  disabled?: boolean
}

export function PaymentButton({
  provider,
  amount,
  onPaymentInitiated,
  onError,
  disabled,
}: PaymentButtonProps) {
  const [loading, setLoading] = useState(false)

  const providerNames = {
    tbc: 'TBC Bank',
    bog: 'Bank of Georgia',
  }

  const providerLogos = {
    tbc: '🏦 TBC',
    bog: '🏦 BOG',
  }

  async function handlePayment() {
    setLoading(true)
    try {
      const supabase = getSupabase()

      // Get current session
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        throw new Error('შესვლა საჭიროა')
      }

      // Call Supabase Edge Function to initialize payment
      const { data, error } = await supabase.functions.invoke('payment-initialize', {
        body: {
          provider,
          amount,
        },
      })

      if (error) {
        throw new Error(error.message || 'გადახდა ვერ დაიწყო')
      }

      if (data.success && data.paymentUrl) {
        onPaymentInitiated?.(data.paymentId, data.paymentUrl)
        // Redirect to payment page
        window.location.href = data.paymentUrl
      } else {
        throw new Error(data.error || 'გადახდის URL ვერ მოიძებნა')
      }
    } catch (error) {
      console.error('Payment error:', error)
      const errorMessage = error instanceof Error ? error.message : 'გადახდა ვერ დაიწყო'
      onError?.(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      className="payment-button"
      onClick={() => void handlePayment()}
      disabled={disabled || loading}
      data-provider={provider}
    >
      {loading ? (
        <>
          <span className="spinner">⏳</span> იტვირთება...
        </>
      ) : (
        <>
          {providerLogos[provider]} გადახდა {providerNames[provider]}-ით
        </>
      )}
    </button>
  )
}
