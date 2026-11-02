// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    user: null,
    loading: false,
    signOutWarning:
      'ანგარიშიდან გახვედით, მაგრამ ამ მოწყობილობის სესიის გაუქმება სერვერზე ვერ დადასტურდა.',
  }),
}))

describe('LoginPage logout warning', () => {
  it('displays the server deactivation warning after local logout', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'ამ მოწყობილობის სესიის გაუქმება სერვერზე ვერ დადასტურდა',
    )
  })
})
