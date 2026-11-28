// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  signIn: vi.fn(async () => null as string | null),
  signInWithGoogle: vi.fn(async (_next?: string | null) => null as string | null),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ ...auth, loading: false, signOutWarning: null }),
}))

const CONV = '11111111-2222-4333-8444-555555555555'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LoginPage post-login destination', () => {
  beforeEach(() => {
    auth.user = null
    auth.signInWithGoogle.mockClear()
    localStorage.clear()
  })

  it('returns a signed-in admin to the exact /support-admin?c=<conversation> destination', () => {
    auth.user = { id: 'admin-1' }
    renderAt(`/login?next=${encodeURIComponent(`/support-admin?c=${CONV}`)}`)
    expect(screen.getByTestId('where')).toHaveTextContent(`/support-admin?c=${CONV}`)
  })

  it('keeps the old default (/) without next, and ignores a disallowed or external next', () => {
    auth.user = { id: 'u1' }
    const { unmount } = renderAt('/login')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
    unmount()
    renderAt(`/login?next=${encodeURIComponent('//evil.example/x')}`)
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it('sends the admin-only account to /support-admin after login, and keeps an explicit admin next', () => {
    auth.user = { id: 'admin', email: 'cityroute.ge@gmail.com' } as { id: string }
    const { unmount } = renderAt('/login')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/support-admin$/)
    unmount()
    renderAt(`/login?next=${encodeURIComponent(`/support-admin?c=${CONV}`)}`)
    expect(screen.getByTestId('where')).toHaveTextContent(`/support-admin?c=${CONV}`)
  })

  it('passes the allowed destination to Google OAuth, and nothing when there is no next', async () => {
    const { unmount } = renderAt(`/login?next=${encodeURIComponent(`/support-admin?c=${CONV}`)}`)
    fireEvent.click(screen.getByRole('button', { name: /Google-ით შესვლა/i }))
    await waitFor(() => expect(auth.signInWithGoogle).toHaveBeenCalledWith(`/support-admin?c=${CONV}`))
    unmount()

    renderAt('/login')
    fireEvent.click(screen.getByRole('button', { name: /Google-ით შესვლა/i }))
    await waitFor(() => expect(auth.signInWithGoogle).toHaveBeenLastCalledWith(null))
  })
})
