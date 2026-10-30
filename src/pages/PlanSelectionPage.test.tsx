// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanSelectionPage } from './PlanSelectionPage'

const state = vi.hoisted(() => ({
  selectPlan: vi.fn(async () => null as string | null),
  signOut: vi.fn(async () => {}),
  refreshProfile: vi.fn(async () => {}),
  auth: {
    user: { id: 'user-1' as string } as { id: string } | null,
    loading: false,
    hasAccess: true,
    needsPlanSelection: true,
    deviceBlocked: null as string | null,
    profile: null as null | {
      subscription_status: string
      subscription_plan: string | null
      subscription_expires_at: string
      device_slots: 1 | 2
      subscription_payment_id?: string | null
    },
  },
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    ...state.auth,
    selectPlan: state.selectPlan,
    signOut: state.signOut,
    refreshProfile: state.refreshProfile,
  }),
}))

vi.mock('@/components/PaymentButton', () => ({
  PaymentButton: ({ deviceSlots }: { deviceSlots: number }) => (
    <button type="button">Pay for {deviceSlots}</button>
  ),
}))

describe('Premium package selection', () => {
  beforeEach(() => {
    state.selectPlan.mockClear()
    state.signOut.mockClear()
    state.refreshProfile.mockClear()
    state.auth = {
      user: { id: 'user-1' },
      loading: false,
      hasAccess: true,
      needsPlanSelection: true,
      deviceBlocked: null,
      profile: null,
    }
  })

  it('preserves selected package pricing and the 12-hour trial path', async () => {
    render(
      <MemoryRouter initialEntries={['/plans']}>
        <Routes>
          <Route path="/plans" element={<PlanSelectionPage />} />
          <Route path="/" element={<h1>Home</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('radio', { name: /2 მანქანა/ }))
    expect(screen.getAllByText(/179/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Pay for 2' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /უფასო/ }))
    await waitFor(() => expect(state.selectPlan).toHaveBeenCalledWith('premium'))
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy()
  })

  it('keeps the user on plan selection when the secure plan RPC rejects the trial choice', async () => {
    state.selectPlan.mockResolvedValue('This session is no longer active; sign in again')
    render(
      <MemoryRouter initialEntries={['/plans']}>
        <Routes>
          <Route path="/plans" element={<PlanSelectionPage />} />
          <Route path="/" element={<h1>Home</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /უფასო/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This session is no longer active; sign in again',
    )
    expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull()
    expect(state.selectPlan).toHaveBeenCalledWith('premium')
  })

  it('lets an active trial open early payment, return to routes, and sign out', async () => {
    state.auth = {
      user: { id: 'user-1' },
      loading: false,
      hasAccess: true,
      needsPlanSelection: false,
      deviceBlocked: null,
      profile: {
        subscription_status: 'trial',
        subscription_plan: 'premium',
        subscription_expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        device_slots: 1,
      },
    }
    render(
      <MemoryRouter initialEntries={['/plans?earlyPayment=1']}>
        <Routes>
          <Route path="/plans" element={<PlanSelectionPage />} />
          <Route path="/" element={<h1>Home</h1>} />
          <Route path="/login" element={<h1>Login</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText(/Premium-ის შეძენა შეგიძლია Trial-ის დასრულებამდე/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /მარშრუტებზე გადასვლა/ }))
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy()
  })

  it('signs out from plan selection and returns to login', async () => {
    render(
      <MemoryRouter initialEntries={['/plans']}>
        <Routes>
          <Route path="/plans" element={<PlanSelectionPage />} />
          <Route path="/login" element={<h1>Login</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'ანგარიშიდან გასვლა' }))
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeTruthy()
    expect(state.signOut).toHaveBeenCalledOnce()
  })

  it('keeps a blocked session on the plan screen and allows a safe sign-out', async () => {
    state.auth = {
      user: { id: 'user-1' },
      loading: false,
      hasAccess: false,
      needsPlanSelection: false,
      deviceBlocked: 'session limit reached',
      profile: null,
    }
    render(
      <MemoryRouter initialEntries={['/plans']}>
        <Routes>
          <Route path="/plans" element={<PlanSelectionPage />} />
          <Route path="/login" element={<h1>Login</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('session limit reached')
    fireEvent.click(screen.getByRole('button', { name: 'ანგარიშიდან გასვლა' }))
    expect(await screen.findByRole('heading', { name: 'Login' })).toBeTruthy()
    expect(state.signOut).toHaveBeenCalledOnce()
  })

  it('shows active Premium separately from a blocked device session and offers a safe retry', async () => {
    state.auth = {
      user: { id: 'user-1' },
      loading: false,
      hasAccess: false,
      needsPlanSelection: false,
      deviceBlocked: 'session limit reached',
      profile: {
        subscription_status: 'active',
        subscription_plan: 'premium',
        subscription_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        device_slots: 1,
        subscription_payment_id: 'verified-payment-1',
      },
    }

    render(
      <MemoryRouter initialEntries={['/plans']}>
        <Routes>
          <Route path="/plans" element={<PlanSelectionPage />} />
          <Route path="/login" element={<h1>Login</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('გადახდილი Premium აქტიურია')).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveTextContent('გამოწერა აქტიურია')
    expect(screen.queryByText('საცდელი პერიოდი დასრულებულია')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'სესიის ხელახლა შემოწმება' }))
    await waitFor(() => expect(state.refreshProfile).toHaveBeenCalledOnce())
  })

  it('distinguishes an active legacy subscription from paid Premium', () => {
    state.auth = {
      user: { id: 'user-1' },
      loading: false,
      hasAccess: true,
      needsPlanSelection: false,
      deviceBlocked: null,
      profile: {
        subscription_status: 'active',
        subscription_plan: 'premium',
        subscription_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        device_slots: 1,
        subscription_payment_id: null,
      },
    }

    render(
      <MemoryRouter initialEntries={['/plans']}>
        <Routes>
          <Route path="/plans" element={<PlanSelectionPage />} />
          <Route path="/" element={<h1>Home</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('ძველი გამოწერა აქტიურია')).toBeTruthy()
    expect(screen.queryByText('გადახდილი Premium აქტიურია')).toBeNull()
  })
})
