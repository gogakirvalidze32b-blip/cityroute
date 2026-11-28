// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const signIn = vi.fn()
const signInWithGoogle = vi.fn()

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ signIn, signInWithGoogle, user: null, loading: false, signOutWarning: null }),
}))

/** Read the terms ("წავიკითხე" at their end), then tick consent. */
function acceptTerms() {
  fireEvent.click(screen.getByRole('button', { name: 'წესებსა და პირობებს' }))
  fireEvent.click(screen.getByRole('button', { name: 'წავიკითხე' }))
  fireEvent.click(screen.getByTestId('login-terms-consent'))
}

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
    signInWithGoogle.mockReset()
    signInWithGoogle.mockResolvedValue(null)
  })

  it('renders empty fields and the Google button, without the footer or terms box', () => {
    renderPage()
    expect(screen.getByPlaceholderText('ელფოსტა')).toHaveValue('')
    expect(screen.getByPlaceholderText('პაროლი')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Google-ით შესვლა/i })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'support@cityroute.ge' })).toBeNull()
    expect(screen.queryByTestId('rules-terms')).toBeNull()
  })

  it('starts Google OAuth from the Google button once terms are accepted', async () => {
    renderPage()
    acceptTerms()
    fireEvent.click(screen.getByRole('button', { name: /Google-ით შესვლა/i }))
    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledTimes(1))
  })

  it('terms consent starts unchecked and blocks email and Google sign-in', () => {
    renderPage()
    const consent = screen.getByTestId('login-terms-consent')
    expect(consent).not.toBeChecked()
    const submit = screen.getByRole('button', { name: /^შესვლა/ })
    const google = screen.getByRole('button', { name: /Google-ით შესვლა/i })
    expect(submit).toBeDisabled()
    expect(google).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('ელფოსტა'), { target: { value: 'a@b.ge' } })
    fireEvent.change(screen.getByPlaceholderText('პაროლი'), { target: { value: 'pw1' } })
    fireEvent.submit(submit.closest('form')!)
    fireEvent.click(google)
    expect(signIn).not.toHaveBeenCalled()
    expect(signInWithGoogle).not.toHaveBeenCalled()
  })

  it('consent cannot be ticked before the terms are read — it opens them instead', () => {
    renderPage()
    const consent = screen.getByTestId('login-terms-consent')
    fireEvent.click(consent)
    expect(consent).not.toBeChecked()
    expect(screen.getByTestId('terms-dialog')).toBeTruthy()
    // Closing without "წავიკითხე" does not count as read.
    fireEvent.click(screen.getByRole('button', { name: 'დახურვა' }))
    expect(screen.queryByTestId('terms-dialog')).toBeNull()
    fireEvent.click(consent)
    expect(consent).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'წავიკითხე' }))
    expect(screen.queryByTestId('terms-dialog')).toBeNull()
    expect(consent).not.toBeChecked()
    fireEvent.click(consent)
    expect(consent).toBeChecked()
  })

  it('consent can be checked and unchecked; unchecking blocks again', () => {
    renderPage()
    acceptTerms()
    const consent = screen.getByTestId('login-terms-consent')
    expect(consent).toBeChecked()
    expect(screen.getByRole('button', { name: /^შესვლა/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Google-ით შესვლა/i })).toBeEnabled()
    fireEvent.click(consent)
    expect(consent).not.toBeChecked()
    expect(screen.getByRole('button', { name: /^შესვლა/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Google-ით შესვლა/i })).toBeDisabled()
  })

  it('the terms link opens the full terms without ticking consent', () => {
    renderPage()
    expect(screen.queryByText('1. ინფორმაცია CityRoute-ის შესახებ')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'წესებსა და პირობებს' }))
    expect(screen.getByTestId('terms-dialog')).toBeTruthy()
    expect(screen.getByText('9. საკონტაქტო ინფორმაცია')).toBeTruthy()
    expect(screen.getByTestId('login-terms-consent')).not.toBeChecked()
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
    acceptTerms()
    fireEvent.click(screen.getByRole('button', { name: /^შესვლა/ }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.ge', 'pw1'))
    expect(localStorage.getItem('cityroute-remember-email')).toBe('a@b.ge')
  })

  it('shows the error returned by signIn', async () => {
    signIn.mockResolvedValue('არასწორი მონაცემები')
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('ელფოსტა'), { target: { value: 'a@b.ge' } })
    fireEvent.change(screen.getByPlaceholderText('პაროლი'), { target: { value: 'x' } })
    acceptTerms()
    fireEvent.click(screen.getByRole('button', { name: /^შესვლა/ }))
    expect(await screen.findByText('არასწორი მონაცემები')).toBeTruthy()
  })
})
