import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RegisterPage } from './RegisterPage'

const state = vi.hoisted(() => ({
  user: null,
  loading: false,
  signUp: vi.fn(async () => null),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => state,
}))

describe('Registration Trial duration', () => {
  it('shows the 12-hour trial duration before registration', () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    )

    expect(screen.getByText(/12 საათი სრული საცდელი/)).toBeTruthy()
    expect(screen.queryByText(/24 საათ/)).toBeNull()
  })
})
