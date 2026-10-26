import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const authState = vi.hoisted(() => ({
  signIn: vi.fn(),
  user: { id: 'user-1' },
  loading: false,
  hasAccess: false,
  needsPlanSelection: true,
  deviceBlocked: 'ეს ანგარიში სხვა მანქანაზეა მიბმული',
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authState,
}))

describe('LoginPage redirect', () => {
  it('sends an authenticated trial user to the package page instead of leaving them at login', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/choose-plan" element={<p>TRIAL_PACKAGE_PAGE</p>} />
          <Route path="/" element={<p>ROUTE_HOME</p>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('TRIAL_PACKAGE_PAGE')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'შესვლა' })).toBeNull()
  })
})
