// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanSelectionPage } from './PlanSelectionPage'

const state = vi.hoisted(() => ({
  selectPlan: vi.fn(async () => null as string | null),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    loading: false,
    hasAccess: true,
    needsPlanSelection: true,
    profile: { subscription_plan: null, device_slots: 1 },
    selectPlan: state.selectPlan,
  }),
}))

vi.mock('@/components/PaymentButton', () => ({
  PaymentButton: ({ deviceSlots }: { deviceSlots: number }) => (
    <button type="button">Pay for {deviceSlots}</button>
  ),
}))

describe('Premium package selection', () => {
  beforeEach(() => state.selectPlan.mockClear())

  it('saves the selected device slots and preserves the 24-hour trial path', async () => {
    render(
      <MemoryRouter initialEntries={['/plans']}>
        <Routes>
          <Route path="/plans" element={<PlanSelectionPage />} />
          <Route path="/" element={<h1>Home</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /2 მანქანა/ }))
    expect(screen.getAllByText(/179/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /უფასო/ }))
    await waitFor(() => expect(state.selectPlan).toHaveBeenCalledWith('premium', 2))
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy()
  })
})
