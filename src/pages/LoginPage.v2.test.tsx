// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const signIn = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ signIn, user: null, loading: false, signOutWarning: null }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
}

describe('LoginPage v2', () => {
  beforeEach(() => {
    localStorage.clear()
    signIn.mockReset()
    signIn.mockResolvedValue(null)
  })

  it('renders empty fields, no Google button, and support contact', () => {
    renderPage()
    expect(screen.getByPlaceholderText('ელფოსტა')).toHaveValue('')
    expect(screen.getByPlaceholderText('პაროლი')).toHaveValue('')
    expect(screen.queryByText(/Google/i)).toBeNull()
    expect(screen.getByRole('link', { name: 'support@cityroute.ge' })).toHaveAttribute(
      'href',
      'mailto:support@cityroute.ge',
    )
  })

  it('toggles password visibility without changing the value', () => {
    renderPage()
    const input = screen.getByPlaceholderText('პაროლი')
    fireEvent.change(input, { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'პაროლის ჩვენება' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('secret')
    fireEvent.click(screen.getByRole('button', { name: 'პაროლის დამალვა' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('submits trimmed email and password to signIn and stores remember-me', async () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('ელფოსტა'), { target: { value: ' a@b.ge ' } })
    fireEvent.change(screen.getByPlaceholderText('პაროლი'), { target: { value: 'pw1' } })
    fireEvent.click(screen.getByRole('button', { name: /^შესვლა/ }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.ge', 'pw1'))
    expect(localStorage.getItem('cityroute-remember-email')).toBe('a@b.ge')
  })

  it('shows the error returned by signIn', async () => {
    signIn.mockResolvedValue('არასწორი მონაცემები')
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('ელფოსტა'), { target: { value: 'a@b.ge' } })
    fireEvent.change(screen.getByPlaceholderText('პაროლი'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /^შესვლა/ }))
    expect(await screen.findByText('არასწორი მონაცემები')).toBeTruthy()
  })
})
