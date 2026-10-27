import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'
import { clearBogPaymentRequestIds } from '@/lib/bog-payment-request'
import { getSupabase } from '@/lib/supabase'

type PaymentStatus =
  | 'checking'
  | 'success'
  | 'failed'
  | 'pending'
  | 'cancelled'
  | 'refunded'
  | 'refunded_partially'
  | 'unknown'

export function PaymentReturnPage() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<PaymentStatus>('checking')
  const [message, setMessage] = useState<string>('')
  const { refreshProfile } = useAuth()

  useEffect(() => {
    clearBogPaymentRequestIds()
    const paymentId = searchParams.get('paymentId') || searchParams.get('order_id')
    const merchantPaymentId = searchParams.get('merchantPaymentId')
    const paymentLookup = merchantPaymentId
      ? { merchantPaymentId }
      : paymentId
        ? { paymentId }
        : null
    const provider = searchParams.get('provider')
    const isProductionPayment = provider === 'bog-production'
    const returnedWithoutCompletion = searchParams.get('checkout') === 'not-completed'
    let active = true

    if (!paymentLookup || (provider !== 'bog' && !isProductionPayment)) {
      setStatus('failed')
      setMessage('საქართველოს ბანკის გადახდის ინფორმაცია ვერ მოიძებნა')
    } else {
      void (async () => {
        try {
          const supabase = getSupabase()
          const query = new URLSearchParams({ ...paymentLookup, provider: 'bog' })
          let data: {
            status?: string
            statusIsUnknown?: boolean
            bankStatus?: string
            sandbox?: boolean
            error?: string
          } | null
          if (isProductionPayment) {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session) throw new Error('Authentication is required')
            const response = await fetch(`/api/payments/bog/verify?${query.toString()}`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            })
            data = await response.json()
            if (!response.ok) throw new Error(data?.error || 'Payment verification failed')
          } else {
            const { data: sandboxData, error } = await supabase.functions.invoke(
              `payment-verify?${query.toString()}`,
              { method: 'GET' },
            )
            if (error) throw error
            data = sandboxData
          }
          if (!active) return

          if (data?.statusIsUnknown) {
            setStatus('unknown')
            setMessage(`ბანკის პასუხია „${String(data.bankStatus)}“. Premium არ გააქტიურებულა; მოგვიანებით გადაამოწმე.`)
          } else if (data?.status === 'success') {
            if (data.sandbox !== true) {
              await refreshProfile()
              if (!active) return
            }
            setStatus('success')
            setMessage(
              data.sandbox === true
                ? 'BOG Sandbox ტესტ-გადახდა ბანკმა დაადასტურა. სატესტო გადახდა Premium წვდომას არ ააქტიურებს.'
                : 'გადახდა ბანკმა დაადასტურა. Premium გამოწერა გააქტიურებულია.',
            )
          } else if (data?.status === 'refunded_partially') {
            if (data.sandbox !== true) {
              await refreshProfile()
              if (!active) return
            }
            setStatus('refunded_partially')
            setMessage(
              data.sandbox === true
                ? 'BOG Sandbox-მა სატესტო გადახდის ნაწილობრივი დაბრუნება დაადასტურა. Premium არ გააქტიურებულა.'
                : 'თანხის ნაწილი დაბრუნებულია. Premium წვდომა შენარჩუნებულია.',
            )
          } else if (data?.status === 'refunded') {
            if (data.sandbox !== true) {
              await refreshProfile()
              if (!active) return
            }
            setStatus('refunded')
            setMessage(
              data.sandbox === true
                ? 'BOG Sandbox-მა სატესტო გადახდის დაბრუნება დაადასტურა. Premium არ გააქტიურებულა.'
                : 'ბანკმა თანხის სრული დაბრუნება დაადასტურა. Premium-ის წვდომა უცვლელია, სანამ მხარდაჭერა გადახედავს გამოწერას.',
            )
          } else if (data?.status === 'cancelled') {
            setStatus('cancelled')
            setMessage('გადახდა გაუქმდა. Premium არ გააქტიურებულა.')
          } else if (data?.status === 'pending' || data?.status === 'processing') {
            if (returnedWithoutCompletion) {
              setStatus('cancelled')
              setMessage('გადახდის გვერდი დასრულდა გადახდის გარეშე. ბანკის საბოლოო სტატუსი ჯერ არ დადასტურებულა; Premium არ გააქტიურებულა.')
            } else {
              setStatus('pending')
              setMessage(
                data.sandbox === true
                  ? 'BOG Sandbox ტესტ-გადახდა მუშავდება. Premium არ გააქტიურდება.'
                  : 'გადახდა მუშავდება... Premium გააქტიურდება ბანკის დადასტურების შემდეგ.',
              )
            }
          } else if (data?.status === 'failed') {
            setStatus('failed')
            setMessage('ბანკმა გადახდა უარყო. Premium არ გააქტიურებულა.')
          } else {
            setStatus('failed')
            setMessage('გადახდა ვერ დადასტურდა. Premium არ გააქტიურებულა.')
          }
        } catch (error) {
          console.error('Payment verification error:', error)
          if (!active) return
          setStatus('failed')
          setMessage('გადახდის შემოწმება ვერ მოხერხდა. Premium არ გააქტიურებულა.')
        }
      })()
    }

    return () => { active = false }
  }, [searchParams, refreshProfile])

  return (
    <div className="page payment-return-page">
      <header className="payment-return__header">
        <AppBrand centered />
      </header>

      <div className="payment-return__content">
        {status === 'checking' && (
          <>
            <div className="payment-status-icon checking">⏳</div>
            <h1>გადახდის შემოწმება...</h1>
            <p className="muted">გთხოვთ დაელოდოთ</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="payment-status-icon success">✅</div>
            <h1>გადახდა წარმატებული!</h1>
            <p className="success-text">{message}</p>
            <Link to="/" className="primary-button">
              მარშრუტებზე გადასვლა →
            </Link>
          </>
        )}

        {status === 'pending' && (
          <>
            <div className="payment-status-icon pending">⏱️</div>
            <h1>გადახდა მუშავდება</h1>
            <p className="muted">{message}</p>
            <Link to="/" className="secondary-button">
              მთავარ გვერდზე დაბრუნება
            </Link>
          </>
        )}

        {status === 'unknown' && (
          <>
            <div className="payment-status-icon pending">⚠️</div>
            <h1>გადახდის სტატუსი უცნობია</h1>
            <p className="muted">{message}</p>
            <Link to="/" className="secondary-button">
              მთავარ გვერდზე დაბრუნება
            </Link>
          </>
        )}

        {status === 'cancelled' && (
          <>
            <div className="payment-status-icon failed">↩️</div>
            <h1>გადახდა გაუქმდა</h1>
            <p className="error-text">{message}</p>
            <Link to="/" className="primary-button">
              თავიდან ცდა
            </Link>
          </>
        )}

        {status === 'refunded_partially' && (
          <>
            <div className="payment-status-icon success">ℹ️</div>
            <h1>ნაწილობრივი დაბრუნება</h1>
            <p className="success-text">{message}</p>
            <Link to="/" className="primary-button">
              მარშრუტებზე გადასვლა →
            </Link>
          </>
        )}

        {status === 'refunded' && (
          <>
            <div className="payment-status-icon failed">↩️</div>
            <h1>გადახდა დაბრუნებულია</h1>
            <p className="error-text">{message}</p>
            <Link to="/" className="secondary-button">
              მთავარ გვერდზე დაბრუნება
            </Link>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="payment-status-icon failed">❌</div>
            <h1>გადახდა ვერ შესრულდა</h1>
            <p className="error-text">{message}</p>
            <Link to="/" className="primary-button">
              თავიდან ცდა
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
