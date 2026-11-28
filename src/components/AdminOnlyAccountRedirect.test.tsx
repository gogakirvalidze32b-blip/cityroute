import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminOnlyAccountRedirect } from './AdminOnlyAccountRedirect'
import { ProtectedRoute } from './ProtectedRoute'

const auth = vi.hoisted(() => ({ value: { user: null as null | { id: string; email?: string }, loading: false } }))
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth.value }))

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<h1>Login</h1>} />
        <Route path="/support-admin" element={<h1>Support Admin</h1>} />
        <Route path="/support" element={<AdminOnlyAccountRedirect><h1>Instructor support chat</h1></AdminOnlyAccountRedirect>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<h1>Instructor home</h1>} />
          <Route path="/choose-plan" element={<h1>Plan selection</h1>} />
          <Route path="/driving-school" element={<h1>Driving school registration</h1>} />
          <Route path="/route/:slug" element={<h1>Exam route</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const INSTRUCTOR_ROUTES = ['/', '/choose-plan', '/driving-school', '/route/route-1', '/support']

describe('admin-only account routing', () => {
  beforeEach(() => {
    auth.value = { user: null, loading: false }
  })

  it('sends cityroute.ge@gmail.com from every instructor route to /support-admin', () => {
    auth.value = { user: { id: 'a', email: 'cityroute.ge@gmail.com' }, loading: false }
    for (const path of INSTRUCTOR_ROUTES) {
      const { unmount } = renderApp(path)
      expect(screen.getByRole('heading', { name: 'Support Admin' }), path).toBeInTheDocument()
      unmount()
    }
  })

  it('leaves every other signed-in account on its instructor routes exactly as before', () => {
    auth.value = { user: { id: 'u', email: 'instructor@example.com' }, loading: false }
    const expected: Record<string, string> = {
      '/': 'Instructor home',
      '/choose-plan': 'Plan selection',
      '/driving-school': 'Driving school registration',
      '/route/route-1': 'Exam route',
      '/support': 'Instructor support chat',
    }
    for (const path of INSTRUCTOR_ROUTES) {
      const { unmount } = renderApp(path)
      expect(screen.getByRole('heading', { name: expected[path] }), path).toBeInTheDocument()
      unmount()
    }
  })

  it('still sends signed-out visitors to login from protected routes', () => {
    renderApp('/choose-plan')
    expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument()
  })
})
