import { FormEvent, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppBrand } from '@/components/AppBrand'
import { useAuth } from '@/context/AuthContext'
import { SUPPORT_EMAIL } from '@/lib/support/constants'
import './login-v2.css'

export function LoginPage() {
  const { signIn, user, loading, signOutWarning } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true) // Default: checked
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

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
    <div className="login-v2">
      <LoginBackground />
      <div className="login-v2__layout">
        <section className="login-v2__brand" aria-label="CityRoute">
          <div className="login-v2__logo-row">
            <img className="login-v2__logo" src="/favicon.svg" alt="" width={84} height={84} />
            <div>
              <p className="login-v2__name">
                CITY<span>ROUTE</span>
              </p>
              <p className="login-v2__tagline">გამოცდის მარშრუტების გავლა</p>
            </div>
          </div>
          <ul className="login-v2__features">
            {FEATURES.map((f) => (
              <li key={f.label}>
                <span className="login-v2__feature-icon" aria-hidden="true">{f.icon}</span>
                {f.label}
              </li>
            ))}
          </ul>
        </section>

        <div className="login-v2__card">
          <h1>შესვლა</h1>
          <p className="login-v2__subtitle">ანგარიშზე შესასვლელად</p>
          {signOutWarning && <p className="error-text" role="status">{signOutWarning}</p>}
          <form onSubmit={onSubmit} className="login-v2__form">
            <label className="login-v2__field">
              <span className="login-v2__sr">ელფოსტა</span>
              <svg className="login-v2__field-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="ელფოსტა"
              />
            </label>
            <label className="login-v2__field">
              <span className="login-v2__sr">პაროლი</span>
              <svg className="login-v2__field-icon" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="პაროლი"
              />
              <button
                type="button"
                className="login-v2__toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'პაროლის დამალვა' : 'პაროლის ჩვენება'}
                aria-pressed={showPassword}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPassword && <path d="m4 4 16 16" />}
                </svg>
              </button>
            </label>
            <label className="login-v2__remember">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>დამახსოვრება</span>
            </label>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="login-v2__submit" disabled={submitting}>
              {submitting ? '...' : 'შესვლა →'}
            </button>
          </form>
          <p className="login-v2__links">
            <Link to="/forgot-password">დაგავიწყდა პაროლი?</Link>
          </p>
          <p className="login-v2__register">
            ანგარიში არ გაქვს? <Link to="/register">რეგისტრაცია</Link>
          </p>
          <p className="login-v2__support">
            <Link to="/support">დახმარება</Link>
            <span aria-hidden="true"> · </span>
            დაგვიკავშირდით: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </p>
        </div>
      </div>
    </div>
  )
}

const FEATURES = [
  { icon: '📍', label: 'რეალური მარშრუტები' },
  { icon: '🔊', label: 'აუდიო ნავიგაცია' },
  { icon: '🚗', label: 'საგამოცდო რეჟიმი' },
  { icon: '📊', label: 'პროგრესის მონიტორინგი' },
]

function LoginBackground() {
  return (
    <svg className="login-v2__bg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="lv2-glow" cx="40%" cy="55%" r="60%">
          <stop offset="0" stopColor="#0f3a3a" />
          <stop offset="1" stopColor="#060d14" />
        </radialGradient>
        <filter id="lv2-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
      <rect width="1200" height="800" fill="url(#lv2-glow)" />
      <g stroke="#1b3a46" strokeWidth="2" fill="none" opacity="0.7">
        <path d="M0 620 C220 560 380 640 640 560 S1000 520 1200 560" />
        <path d="M0 300 C200 340 360 260 560 320 S900 380 1200 300" />
        <path d="M180 0 C220 200 160 420 260 800" />
        <path d="M820 0 C780 220 880 480 800 800" />
      </g>
      <path
        d="M420 720 C380 560 560 540 520 420 S460 300 560 220 S640 160 660 120"
        fill="none"
        stroke="#18e0b0"
        strokeWidth="18"
        strokeLinecap="round"
        opacity="0.55"
        filter="url(#lv2-blur)"
      />
      <path
        d="M420 720 C380 560 560 540 520 420 S460 300 560 220 S640 160 660 120"
        fill="none"
        stroke="#7ff6e0"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path d="M470 560 l70 -50 -25 75 -12 -28 z" fill="#d8fffa" transform="translate(-10 -10)" />
      <circle cx="660" cy="112" r="9" fill="#2de0c0" />
    </svg>
  )
}
