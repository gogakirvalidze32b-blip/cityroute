import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentReturnPage } from './PaymentReturnPage'

const h = vi.hoisted(() => ({
  result: {
    status: 'pending' as
      | 'pending'
      | 'processing'
      | 'success'
      | 'failed'
      | 'cancelled'
      | 'refunded'
      | 'refunded_partially',
    statusIsUnknown: false,
    bankStatus: 'created',
    sandbox: false,
  },
  invoke: vi.fn(async () => ({ data: h.result, error: null })),
  fetch: vi.fn(async () => new Response(JSON.stringify(h.result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })),
  refreshProfile: vi.fn(async () => {}),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'user-access-token' } } }) },
    functions: { invoke: h.invoke },
  }),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ refreshProfile: h.refreshProfile }),
}))

function renderReturnPage(
  provider = 'bog',
  identifier = 'order_id=bog-order-1',
  returnHint = '',
) {
  return render(
    <MemoryRouter initialEntries={[`/payment/return?provider=${provider}&${identifier}${returnHint}`]}>
      <Routes>
        <Route path="/payment/return" element={<PaymentReturnPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BOG payment return', () => {
  beforeEach(() => {
    h.result = { status: 'pending', statusIsUnknown: false, bankStatus: 'created', sandbox: false }
    h.invoke.mockClear()
    h.fetch.mockClear()
    h.fetch.mockImplementation(async () => new Response(JSON.stringify(h.result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', h.fetch)
    h.refreshProfile.mockClear()
    h.invoke.mockImplementation(async () => ({ data: h.result, error: null }))
  })

  it('keeps Premium inactive while BOG reports pending', async () => {
    renderReturnPage()

    expect(await screen.findByText(/Premium გააქტიურდება ბანკის დადასტურების შემდეგ/)).toBeTruthy()
    expect(h.refreshProfile).not.toHaveBeenCalled()
  })

  it('keeps Premium inactive while BOG reports processing', async () => {
    h.result = { ...h.result, status: 'processing' }
    renderReturnPage()

    expect(await screen.findByText(/Premium გააქტიურდება ბანკის დადასტურების შემდეგ/)).toBeTruthy()
    expect(h.refreshProfile).not.toHaveBeenCalled()
  })

  it('refreshes the profile only after BOG confirms success', async () => {
    h.result = { ...h.result, status: 'success' }
    renderReturnPage()

    expect(await screen.findByText(/ბანკმა დაადასტურა/)).toBeTruthy()
    await waitFor(() => expect(h.refreshProfile).toHaveBeenCalledOnce())
    expect(h.invoke).toHaveBeenCalledWith(
      'payment-verify?paymentId=bog-order-1&provider=bog',
      { method: 'GET' },
    )
  })

  it('verifies Production BOG returns through the Production verifier and refreshes Premium', async () => {
    h.result = { ...h.result, status: 'success', sandbox: false }
    renderReturnPage('bog-production', 'merchantPaymentId=cr-live-order')

    expect(await screen.findByText(/ბანკმა დაადასტურა/)).toBeTruthy()
    await waitFor(() => expect(h.refreshProfile).toHaveBeenCalledOnce())
    expect(h.fetch).toHaveBeenCalledWith(
      '/api/payments/bog/verify?merchantPaymentId=cr-live-order&provider=bog',
      { headers: { Authorization: 'Bearer user-access-token' } },
    )
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('reports Sandbox success without refreshing or claiming Premium was activated', async () => {
    h.result = { ...h.result, status: 'success', sandbox: true }
    renderReturnPage()

    expect(await screen.findByText(/Sandbox ტესტ-გადახდა ბანკმა დაადასტურა/)).toBeTruthy()
    expect(screen.getByText(/სატესტო გადახდა Premium წვდომას არ ააქტიურებს/)).toBeTruthy()
    expect(h.refreshProfile).not.toHaveBeenCalled()
  })

  it('verifies a return using the merchant order ID assigned before the bank order exists', async () => {
    h.result = { ...h.result, status: 'pending' }
    renderReturnPage('bog', 'merchantPaymentId=cr-test-order')

    expect(await screen.findByText(/Premium გააქტიურდება ბანკის დადასტურების შემდეგ/)).toBeTruthy()
    expect(h.invoke).toHaveBeenCalledWith(
      'payment-verify?merchantPaymentId=cr-test-order&provider=bog',
      { method: 'GET' },
    )
  })

  it('does not invoke non-BOG payment verification', async () => {
    renderReturnPage('tbc')

    expect(await screen.findByText(/საქართველოს ბანკის გადახდის ინფორმაცია ვერ მოიძებნა/)).toBeTruthy()
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('shows rejected payments as failed without refreshing Premium access', async () => {
    h.result = { ...h.result, status: 'failed', bankStatus: 'rejected' }
    renderReturnPage()

    expect(await screen.findByText(/ბანკმა გადახდა უარყო/)).toBeTruthy()
    expect(h.refreshProfile).not.toHaveBeenCalled()
  })

  it('shows canceled payments distinctly without activating Premium', async () => {
    h.result = { ...h.result, status: 'cancelled', bankStatus: 'cancelled' }
    renderReturnPage()

    expect(await screen.findByRole('heading', { name: /გადახდა გაუქმდა/ })).toBeTruthy()
    expect(h.refreshProfile).not.toHaveBeenCalled()
  })

  it('shows a fail redirect as incomplete only after server verification remains pending', async () => {
    h.result = { ...h.result, status: 'pending', bankStatus: 'created' }
    renderReturnPage('bog', 'merchantPaymentId=cr-test-order', '&checkout=not-completed')

    expect(await screen.findByText(/ბანკის საბოლოო სტატუსი ჯერ არ დადასტურებულა/)).toBeTruthy()
    expect(h.invoke).toHaveBeenCalledOnce()
    expect(h.refreshProfile).not.toHaveBeenCalled()
  })

  it('shows full refunds as recorded for manual review without claiming access was revoked', async () => {
    h.result = { ...h.result, status: 'refunded', bankStatus: 'refunded' }
    renderReturnPage()

    expect(await screen.findByText(/წვდომა უცვლელია, სანამ მხარდაჭერა გადახედავს/)).toBeTruthy()
    await waitFor(() => expect(h.refreshProfile).toHaveBeenCalledOnce())
  })

  it('keeps Premium active after a partial refund', async () => {
    h.result = { ...h.result, status: 'refunded_partially', bankStatus: 'refunded_partially' }
    renderReturnPage()

    expect(await screen.findByText(/თანხის ნაწილი დაბრუნებულია/)).toBeTruthy()
    await waitFor(() => expect(h.refreshProfile).toHaveBeenCalledOnce())
  })

  it('surfaces unknown bank statuses without activating Premium', async () => {
    h.result = { ...h.result, status: 'processing', statusIsUnknown: true, bankStatus: 'new_status' }
    renderReturnPage()

    expect(await screen.findByText(/ბანკის პასუხია „new_status“/)).toBeTruthy()
    expect(h.refreshProfile).not.toHaveBeenCalled()
  })
})
