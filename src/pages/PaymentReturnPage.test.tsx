// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentReturnPage } from './PaymentReturnPage'

const state = vi.hoisted(() => ({
  result: { status: 'pending' as string },
  refreshProfile: vi.fn(async () => {}),
  fetch: vi.fn(async () => new Response(JSON.stringify(state.result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'user-token' } } }) },
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ refreshProfile: state.refreshProfile }),
}))

describe('BOG Production payment return', () => {
  beforeEach(() => {
    state.result = { status: 'pending' }
    state.fetch.mockImplementation(async () => new Response(JSON.stringify(state.result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    state.fetch.mockClear()
    state.refreshProfile.mockClear()
    vi.stubGlobal('fetch', state.fetch)
  })

  function renderPage(provider = 'bog-production') {
    return render(
      <MemoryRouter initialEntries={[`/payment/return?provider=${provider}&merchantPaymentId=cr-order-1`]}>
        <Routes>
          <Route path="/payment/return" element={<PaymentReturnPage />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('checks the server and keeps Premium inactive while the bank is pending', async () => {
    renderPage()
    expect(await screen.findByText(/Premium/)).toBeTruthy()
    expect(state.refreshProfile).not.toHaveBeenCalled()
    expect(state.fetch).toHaveBeenCalledWith(
      '/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-order-1',
      { headers: { Authorization: 'Bearer user-token' } },
    )
  })

  it('refreshes the profile only after server verification reports success', async () => {
    state.result = { status: 'success' }
    renderPage()
    expect(await screen.findByText(/Premium/)).toBeTruthy()
    await waitFor(() => expect(state.refreshProfile).toHaveBeenCalledOnce())
  })

  it('does not call the verifier for non-Production BOG return hints', async () => {
    renderPage('bog')
    expect(await screen.findByText(/საქართველოს ბანკის/)).toBeTruthy()
    expect(state.fetch).not.toHaveBeenCalled()
  })
})
