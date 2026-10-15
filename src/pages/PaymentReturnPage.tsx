import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { getSupabase } from '@/lib/supabase'

type PaymentStatus = 'checking' | 'success' | 'failed' | 'pending'

export function PaymentReturnPage() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<PaymentStatus>('checking')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    const paymentId = searchParams.get('paymentId') || searchParams.get('order_id')
    const provider = searchParams.get('provider')

    if (!paymentId || !provider) {
      setStatus('failed')
      setMessage('გადახდის ინფორმაცია არ მოიძებნა')
      return
    }

    // Verify payment status
    verifyPayment(paymentId, provider as 'tbc' | 'bog')
  }, [searchParams])

  async function verifyPayment(paymentId: string, provider: 'tbc' | 'bog') {
    try {
      const supabase = getSupabase()

      // Call Supabase Edge Function to verify payment
      const { data, error } = await supabase.functions.invoke('payment-verify', {
        body: {},
        method: 'GET',
      })

      // Build query string manually since Supabase client doesn't support query params well
      const verifyUrl = `${(supabase.functions as unknown as { _url: string })._url}/payment-verify?paymentId=${paymentId}&provider=${provider}`
      const response = await fetch(verifyUrl)
      const result = await response.json()

      if (result.status === 'success') {
        setStatus('success')
        setMessage('გადახდა წარმატებით შესრულდა! თქვენი პრემიუმ გამოწერა გააქტიურებულია.')
      } else if (result.status === 'pending') {
        setStatus('pending')
        setMessage('გადახდა მუშავდება... გთხოვთ დაელოდოთ.')
      } else {
        setStatus('failed')
        setMessage('გადახდა ვერ შესრულდა. გთხოვთ სცადოთ თავიდან.')
      }
    } catch (error) {
      console.error('Payment verification error:', error)
      setStatus('failed')
      setMessage('გადახდის შემოწმება ვერ მოხერხდა')
    }
  }

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
