import { FormEvent, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'

export function RegisterPage() {
  const { signUp, user, loading } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const err = await signUp(email.trim(), password, fullName.trim())
    if (err) setError(err)
    else setSuccess(true)
    setSubmitting(false)
  }

  if (success) {
    return (
      <div className="page center auth-page">
        <div className="auth-brand">
          <AppBrand centered />
        </div>
        <div className="auth-card">
          <h1>თითქმის მზად ხარ!</h1>
          <p className="muted">
            შეამოწმე ელფოსტა (დადასტურების ბმული). შემდეგ შედი — <strong>24 საათიანი სრული საცდელი</strong> და პაკეტის არჩევა.
          </p>
          <Link to="/login" className="primary btn-link">
            შესვლა
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
        <h1>რეგისტრაცია</h1>
        <p className="muted">24 საათი სრული საცდელი · შესვლის შემდეგ აირჩევ პაკეტს · 1 ანგარიში = 1 მანქანა</p>
        <form onSubmit={onSubmit} className="form">
          <label>
            სახელი
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="არასავალდებულო" />
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
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? '...' : 'რეგისტრაცია'}
          </button>
        </form>
        <p className="muted">
          უკვე გაქვს ანგარიში? <Link to="/login">შესვლა</Link>
        </p>
      </div>
    </div>
  )
}
