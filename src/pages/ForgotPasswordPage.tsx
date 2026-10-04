import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(false)

    if (!isSupabaseConfigured) {
      setError('Supabase არ არის კონფიგურირებული')
      setSubmitting(false)
      return
    }

    try {
      const supabase = getSupabase()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (resetError) {
        console.error('Password reset error:', resetError)
        
        // Don't reveal if email exists or not (security best practice)
        // Always show success message
        setSuccess(true)
        return
      }

      setSuccess(true)
    } catch (err) {
      console.error('Unexpected error:', err)
      setError('დაფიქსირდა შეცდომა. სცადეთ თავიდან.')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="page center auth-page">
        <div className="auth-brand">
          <AppBrand centered />
        </div>
        <div className="auth-card">
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📧</div>
            <h2>შეამოწმეთ ელფოსტა</h2>
            <p className="muted" style={{ marginTop: '1rem' }}>
              თუ ანგარიში არსებობს მისამართზე <strong>{email}</strong>, 
              მიიღებთ პაროლის აღდგენის ინსტრუქციას.
            </p>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '1rem', color: '#64748b' }}>
              არ მიგიღიათ? შეამოწმეთ spam საქაღალდე ან სცადეთ თავიდან რამდენიმე წუთში.
            </p>
          </div>
          <Link to="/login" style={{ 
            display: 'block', 
            textAlign: 'center', 
            marginTop: '1.5rem',
            color: '#1976d2',
            textDecoration: 'none'
          }}>
            ← შესვლაზე დაბრუნება
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page center auth-page">
      <div className="auth-brand">
        <AppBrand centered />
      </div>
      <div className="auth-card">
        <h1>პაროლის აღდგენა</h1>
        <p className="muted">შეიყვანეთ თქვენი ელფოსტა</p>
        <form onSubmit={onSubmit} className="form">
          <label>
            ელფოსტა
            <input 
              type="email" 
              required 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              autoComplete="email"
              placeholder="your@email.com"
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'იგზავნება...' : 'გაგზავნა'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
          <Link to="/login">← შესვლაზე დაბრუნება</Link>
        </p>
      </div>
    </div>
  )
}
