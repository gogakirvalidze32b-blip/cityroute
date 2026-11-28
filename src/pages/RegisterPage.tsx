import { FormEvent, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { PublicSiteFooter } from '@/components/PublicSiteFooter'
import { useAuth } from '@/context/AuthContext'

export function RegisterPage() {
  const { signUp, signInWithGoogle, user, loading } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [googleSubmitting, setGoogleSubmitting] = useState(false)

  if (loading) {
    return (
      <div className="page center auth-page cr-scroll-page">
        <div className="auth-brand">
          <AppBrand centered />
        </div>
        <div className="auth-card">
          <p className="muted">იტვირთება...</p>
        </div>
        <PublicSiteFooter />
      </div>
    )
  }

  if (user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    
    try {
      const timeoutPromise = new Promise<string>((resolve) => 
        setTimeout(() => resolve('მოთხოვნა ძალიან დიდხანს გრძელდება. სცადეთ თავიდან.'), 15000)
      )
      
      const signUpPromise = signUp(email.trim(), password, fullName.trim())
      const err = await Promise.race([signUpPromise, timeoutPromise])
      
      if (err) setError(err)
      else setSuccess(true)
    } catch (err) {
      setError('შეცდომა დაფიქსირდა. გთხოვთ სცადოთ თავიდან.')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="page center auth-page cr-scroll-page">
        <div className="auth-brand">
          <AppBrand centered />
        </div>
        <div className="auth-card">
          <h1>თითქმის მზად ხარ!</h1>
          <p className="muted">
            შეამოწმე ელფოსტა (დადასტურების ბმული). შემდეგ შედი — <strong>12 საათიანი სრული საცდელი</strong> და პაკეტის არჩევა.
          </p>
          <Link to="/login" className="primary btn-link">
            შესვლა
          </Link>
        </div>
        <PublicSiteFooter />
      </div>
    )
  }

  return (
    <div className="page center auth-page cr-scroll-page">
      <div className="auth-brand">
        <AppBrand centered />
      </div>
      <div className="auth-card">
        <h1>რეგისტრაცია</h1>
        <p className="muted">12-საათიანი საცდელი წვდომა · პაკეტის მიხედვით 1 ან 2 მოწყობილობა</p>
        <form onSubmit={onSubmit} className="form">
          <label>
            სახელი
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="სახელი"
              autoComplete="name"
            />
          </label>
          <label>
            ელფოსტა
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            პაროლი
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="primary" disabled={submitting || googleSubmitting}>
            {submitting ? '...' : 'რეგისტრაცია'}
          </button>
        </form>
        <div className="auth-google-divider" role="separator">
          <span>ან</span>
        </div>
        <button
          type="button"
          className="auth-google"
          disabled={submitting || googleSubmitting}
          onClick={async () => {
            setGoogleSubmitting(true)
            setError(null)
            try {
              const err = await signInWithGoogle()
              if (err) setError(err)
            } catch {
              setError('Google-ით რეგისტრაცია ვერ მოხერხდა. სცადეთ თავიდან.')
            } finally {
              setGoogleSubmitting(false)
            }
          }}
        >
          <GoogleMark />
          {googleSubmitting ? '...' : 'Google-ით რეგისტრაცია'}
        </button>
        <p className="muted">
          უკვე გაქვს ანგარიში? <Link to="/login">შესვლა</Link>
        </p>
      </div>
      <PublicSiteFooter />
    </div>
  )
}

function GoogleMark() {
  return (
    <svg className="auth-google__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7 12.9 19.5C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l.1.1 6.3 5.3C39.2 37.3 44 32 44 24c0-1.3-.1-2.7-.4-3.9z" />
    </svg>
  )
}
