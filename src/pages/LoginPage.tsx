import { FormEvent, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'

export function LoginPage() {
  const { signIn, user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
        <form onSubmit={onSubmit} className="form">
          <label>
            ელფოსტა
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            პაროლი
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? '...' : 'შესვლა'}
          </button>
        </form>
        <p className="muted">
          ანგარიში არ გაქვს? <Link to="/register">რეგისტრაცია</Link>
        </p>
      </div>
    </div>
  )
}
