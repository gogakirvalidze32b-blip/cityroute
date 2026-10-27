import { useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { calculatePrice } from '@/data/subscription-plans'
import { getOrCreateBogPaymentRequestId } from '@/lib/bog-payment-request'
import { isBogLivePaymentSite } from '@/lib/bog-payment-environment'

type PaymentButtonProps = {
  deviceSlots: 1 | 2
  onError?: (error: string) => void
  disabled?: boolean
}

export function PaymentButton({
  deviceSlots,
  onError,
  disabled,
}: PaymentButtonProps) {
  const [loading, setLoading] = useState(false)
  const requestIdRef = useRef<string | null>(null)
  const amount = calculatePrice('premium', deviceSlots)

  useEffect(() => {
    requestIdRef.current = null
  }, [deviceSlots])

  async function handlePayment() {
    setLoading(true)
    try {
      const supabase = getSupabase()

      // Get current session
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        throw new Error('შესვლა საჭიროა')
      }

      const requestId = requestIdRef.current ?? getOrCreateBogPaymentRequestId(deviceSlots)
      requestIdRef.current = requestId

      const body = {
        provider: 'bog',
        deviceSlots,
        requestId,
      }
      let data: { success?: boolean; paymentUrl?: string; amount?: number; error?: string } | null

      if (isBogLivePaymentSite()) {
        const response = await fetch('/api/payments/bog/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        data = await response.json()
        if (!response.ok) {
          throw new Error(data?.error || 'გადახდა ვერ დაიწყო')
        }
      } else {
        const { data: sandboxData, error } = await supabase.functions.invoke('payment-initialize', { body })
        if (error) throw new Error(error.message || 'გადახდა ვერ დაიწყო')
        data = sandboxData
      }

      if (data.success && data.paymentUrl) {
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
      data-provider="bog"
    >
      {loading ? (
        <>
          <span className="spinner">⏳</span> იტვირთება...
        </>
      ) : (
        <>გადახდა — {amount} ₾</>
      )}
    </button>
  )
}
