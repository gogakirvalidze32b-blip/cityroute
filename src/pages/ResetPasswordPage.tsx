import { FormEvent, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    // Check if user has valid session from email link
    if (!isSupabaseConfigured) return

    const supabase = getSupabase()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setHasSession(true)
      } else {
        setError('ბმული არასწორია ან ვადაგასულია. გთხოვთ სცადოთ თავიდან.')
      }
    })
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    if (password.length < 6) {
      setError('პაროლი უნდა იყოს მინიმუმ 6 სიმბოლო')
      setSubmitting(false)
      return
    }

    if (password !== confirmPassword) {
      setError('პაროლები არ ემთხვევა')
      setSubmitting(false)
      return
    }

    if (!isSupabaseConfigured) {
      setError('Supabase არ არის კონფიგურირებული')
      setSubmitting(false)
      return
    }

    try {
      const supabase = getSupabase()
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      })

      if (updateError) {
        console.error('Password update error:', updateError)
        setError('შეცდომა მოხდა პაროლის შეცვლისას')
        return
      }

      setSuccess(true)
      
      // Redirect to home after 2 seconds
      setTimeout(() => {
        navigate('/')
      }, 2000)
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
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
            <h2>პაროლი შეიცვალა</h2>
            <p className="muted" style={{ marginTop: '1rem' }}>
              თქვენი პაროლი წარმატებით განახლდა
            </p>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem', color: '#22c55e' }}>
              გადამისამართება მთავარ გვერდზე...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!hasSession) {
    return (
      <div className="page center auth-page">
        <div className="auth-brand">
          <AppBrand centered />
        </div>
        <div className="auth-card">
          <h1>შეცდომა</h1>
          {error && <p className="error-text">{error}</p>}
          <p className="muted" style={{ marginTop: '1rem', textAlign: 'center' }}>
            <a href="/forgot-password" style={{ color: '#1976d2', textDecoration: 'none' }}>
              ← პაროლის აღდგენაზე დაბრუნება
            </a>
          </p>
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
        <h1>ახალი პაროლი</h1>
        <p className="muted">შეიყვანეთ თქვენი ახალი პაროლი</p>
        <form onSubmit={onSubmit} className="form">
          <label>
            ახალი პაროლი
            <input 
              type="password" 
              required 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              autoComplete="new-password"
              minLength={6}
              placeholder="მინიმუმ 6 სიმბოლო"
            />
          </label>
          <label>
            გაიმეორეთ პაროლი
            <input 
              type="password" 
              required 
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              autoComplete="new-password"
              minLength={6}
              placeholder="გაიმეორეთ პაროლი"
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'ინახება...' : 'პაროლის შენახვა'}
          </button>
        </form>
      </div>
    </div>
  )
}
