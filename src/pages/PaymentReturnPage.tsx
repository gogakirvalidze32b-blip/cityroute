import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'
import { getSupabase } from '@/lib/supabase'

type PaymentStatus = 'checking' | 'success' | 'failed' | 'pending' | 'cancelled'

export function PaymentReturnPage() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<PaymentStatus>('checking')
  const [message, setMessage] = useState('')
  const { refreshProfile } = useAuth()

  useEffect(() => {
    const provider = searchParams.get('provider')
    const merchantPaymentId = searchParams.get('merchantPaymentId')
    let active = true

    if (provider !== 'bog-production' || !merchantPaymentId) {
      setStatus('failed')
      setMessage('საქართველოს ბანკის გადახდის ინფორმაცია ვერ მოიძებნა')
    } else {
      void (async () => {
        try {
          const supabase = getSupabase()
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) throw new Error('Authentication is required')
          const query = new URLSearchParams({ provider: 'bog', merchantPaymentId })
          const response = await fetch(`/api/payments/bog/verify?${query.toString()}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          const result: { status?: string; error?: string } = await response.json()
          if (!response.ok) throw new Error(result.error || 'Payment verification failed')
          if (!active) return

          if (result.status === 'success') {
            await refreshProfile()
            if (!active) return
            setStatus('success')
            setMessage('გადახდა ბანკმა დაადასტურა. Premium გამოწერა გააქტიურებულია.')
          } else if (result.status === 'pending' || result.status === 'processing') {
            setStatus('pending')
            setMessage('გადახდა მუშავდება. Premium გააქტიურდება მხოლოდ ბანკის დადასტურების შემდეგ.')
          } else if (result.status === 'cancelled') {
            setStatus('cancelled')
            setMessage('გადახდა გაუქმდა. Premium არ გააქტიურებულა.')
          } else {
            setStatus('failed')
            setMessage('ბანკმა გადახდა ვერ დაადასტურა. Premium არ გააქტიურებულა.')
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

        {status === 'cancelled' && (
          <>
            <div className="payment-status-icon failed">↩️</div>
            <h1>გადახდა გაუქმდა</h1>
            <p className="muted">{message}</p>
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
