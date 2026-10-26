import { useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { calculatePrice } from '@/data/subscription-plans'
import { getOrCreateBogPaymentRequestId } from '@/lib/bog-payment-request'
import { getBogSandboxPaymentBlockReason } from '@/lib/bog-sandbox'

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
      const blockReason = getBogSandboxPaymentBlockReason()
      if (blockReason) throw new Error(blockReason)

      const supabase = getSupabase()

      // Get current session
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        throw new Error('შესვლა საჭიროა')
      }

      const requestId = requestIdRef.current ?? getOrCreateBogPaymentRequestId(deviceSlots)
      requestIdRef.current = requestId

      // Call Supabase Edge Function to initialize payment
      const { data, error } = await supabase.functions.invoke('payment-initialize', {
        body: {
          provider: 'bog',
          deviceSlots,
          requestId,
        },
      })

      if (error) {
        throw new Error(error.message || 'გადახდა ვერ დაიწყო')
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
