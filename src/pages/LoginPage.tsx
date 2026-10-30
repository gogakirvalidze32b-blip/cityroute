import { FormEvent, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'
import { SupportFooterLinks } from '@/components/support/SupportLinks'

export function LoginPage() {
  const { signIn, user, loading, signOutWarning } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true) // Default: checked
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Load saved credentials if "remember me" was checked
  useState(() => {
    const savedEmail = localStorage.getItem('cityroute-remember-email')
    const savedPassword = localStorage.getItem('cityroute-remember-password')
    if (savedEmail) {
      setEmail(savedEmail)
      if (savedPassword) {
        setPassword(atob(savedPassword)) // Simple base64 decode
      }
    }
  })

  if (loading) {
    return (
      <div className="page center auth-page">
        <div className="auth-brand">
          <AppBrand centered />
        </div>
        <div className="auth-card">
          <p className="muted">იტვირთება...</p>
        </div>
      </div>
    )
  }

  if (user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    
    console.log('📝 LoginPage: Form submitted')
    
    try {
      // Save credentials if "remember me" is checked
      if (rememberMe) {
        localStorage.setItem('cityroute-remember-email', email.trim())
        localStorage.setItem('cityroute-remember-password', btoa(password)) // Simple base64 encode
      } else {
        localStorage.removeItem('cityroute-remember-email')
        localStorage.removeItem('cityroute-remember-password')
      }

      // დავამატოთ timeout რომ არ იჭედოს უსასრულოდ
      const timeoutPromise = new Promise<string>((resolve) => 
        setTimeout(() => resolve('მოთხოვნა ძალიან დიდხანს გრძელდება. სცადეთ თავიდან.'), 15000)
      )
      
      const signInPromise = signIn(email.trim(), password)
      const err = await Promise.race([signInPromise, timeoutPromise])
      
      console.log('📝 LoginPage: signIn result:', err || 'success')
      setError(err)
    } catch (err) {
      console.error('📝 LoginPage: Unexpected error:', err)
      setError('შეცდომა დაფიქსირდა. გთხოვთ სცადოთ თავიდან.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page center auth-page">
      <div className="auth-brand">
        <AppBrand centered />
      </div>
      <div className="auth-card">
        <h1>შესვლა</h1>
        <p className="muted">ინსტრუქტორებისთვის</p>
        {signOutWarning && <p className="error-text" role="status">{signOutWarning}</p>}
        <form onSubmit={onSubmit} className="form">
          <label>
            ელფოსტა
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            პაროლი
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="checkbox-label">
            <input 
              type="checkbox" 
              checked={rememberMe} 
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>დამახსოვრება</span>
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? '...' : 'შესვლა'}
          </button>
        </form>
        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <Link to="/forgot-password" style={{ fontSize: '0.9rem', color: '#64748b' }}>
            დაგავიწყდა პაროლი?
          </Link>
        </div>
        <p className="muted" style={{ marginTop: '1rem' }}>
          ანგარიში არ გაქვს? <Link to="/register">რეგისტრაცია</Link>
        </p>
      </div>
      <SupportFooterLinks />
    </div>
  )
}
