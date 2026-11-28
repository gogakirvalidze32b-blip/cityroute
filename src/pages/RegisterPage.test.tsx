import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RegisterPage } from './RegisterPage'

const state = vi.hoisted(() => ({
  user: null,
  loading: false,
  signUp: vi.fn(async () => null),
  signInWithGoogle: vi.fn(async () => null),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => state,
}))

afterEach(() => cleanup())

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  )
}

/** Read the terms ("წავიკითხე" at their end), then tick consent. */
function acceptTerms() {
  // (By text: happy-dom names a button nested in a <label> differently.)
  fireEvent.click(screen.getByText('წესებსა და პირობებს'))
  fireEvent.click(screen.getByRole('button', { name: 'წავიკითხე' }))
  fireEvent.click(screen.getByTestId('terms-consent'))
}

describe('Registration Trial duration', () => {
  beforeEach(() => {
    state.signUp.mockClear()
    state.signInWithGoogle.mockClear()
  })

  it('shows the 12-hour trial duration before registration', () => {
    renderPage()
    expect(screen.getByText(/12-საათიანი საცდელი წვდომა/)).toBeTruthy()
    expect(screen.queryByText(/24 საათ/)).toBeNull()
  })

  it('requires a name and offers Google registration', () => {
    renderPage()
    expect(screen.queryByPlaceholderText('არასავალდებულო')).toBeNull()
    expect(screen.getByPlaceholderText('სახელი')).toBeRequired()
    expect(screen.getByRole('button', { name: /Google-ით რეგისტრაცია/i })).toBeTruthy()
  })

  it('has no bottom footer panel', () => {
    renderPage()
    expect(document.querySelector('.public-site-footer')).toBeNull()
  })
})

describe('Registration terms consent', () => {
  beforeEach(() => {
    state.signUp.mockClear()
    state.signInWithGoogle.mockClear()
  })

  it('starts unchecked and blocks both email and Google registration', () => {
    renderPage()
    const consent = screen.getByTestId('terms-consent')
    expect(consent).not.toBeChecked()
    const submit = screen.getByRole('button', { name: 'რეგისტრაცია' })
    const google = screen.getByRole('button', { name: /Google-ით რეგისტრაცია/i })
    expect(submit).toBeDisabled()
    expect(google).toBeDisabled()
    fireEvent.submit(submit.closest('form')!)
    fireEvent.click(google)
    expect(state.signUp).not.toHaveBeenCalled()
    expect(state.signInWithGoogle).not.toHaveBeenCalled()
  })

  it('cannot be ticked before the terms are read — clicking opens them', () => {
    renderPage()
    const consent = screen.getByTestId('terms-consent')
    fireEvent.click(consent)
    expect(consent).not.toBeChecked()
    expect(screen.getByTestId('terms-dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'დახურვა' }))
    fireEvent.click(consent)
    expect(consent).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'წავიკითხე' }))
    fireEvent.click(consent)
    expect(consent).toBeChecked()
  })

  it('after consent, email and Google registration work; unticking blocks again', async () => {
    renderPage()
    acceptTerms()
    const google = screen.getByRole('button', { name: /Google-ით რეგისტრაცია/i })
    expect(google).toBeEnabled()
    fireEvent.click(google)
    await waitFor(() => expect(state.signInWithGoogle).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText('სახელი'), { target: { value: 'ნინო' } })
    fireEvent.change(screen.getByLabelText(/ელფოსტა/), { target: { value: 'n@b.ge' } })
    fireEvent.change(screen.getByLabelText(/პაროლი/), { target: { value: 'secret1' } })
    fireEvent.click(screen.getByRole('button', { name: 'რეგისტრაცია' }))
    await waitFor(() => expect(state.signUp).toHaveBeenCalledWith('n@b.ge', 'secret1', 'ნინო'))
  })

  it('unticking consent disables registration again', () => {
    renderPage()
    acceptTerms()
    fireEvent.click(screen.getByTestId('terms-consent'))
    expect(screen.getByTestId('terms-consent')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'რეგისტრაცია' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Google-ით რეგისტრაცია/i })).toBeDisabled()
  })
})
