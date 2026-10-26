import { useState } from 'react'
import { getSupabase } from '@/lib/supabase'

type PaymentButtonProps = {
  deviceSlots: 1 | 2
  onError?: (error: string) => void
  disabled?: boolean
}

export function PaymentButton({ deviceSlots, onError, disabled }: PaymentButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handlePayment() {
    setLoading(true)
    try {
      const { data: { session } } = await getSupabase().auth.getSession()
      if (!session) throw new Error('შესვლა საჭიროა')

      const response = await fetch('/api/payments/bog/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'bog',
          deviceSlots,
          requestId: crypto.randomUUID(),
        }),
      })
      const data: { success?: boolean; paymentUrl?: string; error?: string } = await response.json()
      if (!response.ok || !data.success || !data.paymentUrl) {
        throw new Error(data.error || 'BOG-ით გადახდა ვერ დაიწყო')
      }
      const checkoutUrl = new URL(data.paymentUrl)
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'payment.bog.ge') {
        throw new Error('BOG-მა არასწორი გადახდის ბმული დააბრუნა')
      }
      window.location.assign(checkoutUrl.toString())
    } catch (error) {
      console.error('Payment error:', error)
      onError?.(error instanceof Error ? error.message : 'გადახდა ვერ დაიწყო')
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
      data-provider="bog"
    >
      {loading ? (
        <>
          <span className="spinner">⏳</span> იტვირთება...
        </>
      ) : (
        <>🏦 გადახდა BOG-ით</>
      )}
    </button>
  )
}
