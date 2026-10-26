// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'

const state = vi.hoisted(() => ({
  signOut: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      subscription_status: 'trial',
      subscription_plan: 'premium',
      device_slots: 1,
    },
    hasAccess: true,
    deviceBlocked: null,
    signOut: state.signOut,
  }),
}))

vi.mock('@/hooks/useRoutes', () => ({
  useRoutes: () => ({
    source: 'local',
    routes: [
      { id: '1', slug: 'route-1', name_ka: 'Route 1', license_category: 'B', official_label: null },
    ],
  }),
}))

vi.mock('@/hooks/useExamLayoutMode', () => ({
  useExamLayoutMode: () => 'laptop',
}))

vi.mock('@/components/support/SupportLinks', () => ({
  SupportButton: () => <button type="button">Support</button>,
  SupportFooterLinks: () => <div>Support links</div>,
}))

vi.mock('@/components/AppBrand', () => ({
  AppBrand: () => <div>CityRoute</div>,
}))

describe('Trial route menu actions', () => {
  beforeEach(() => state.signOut.mockClear())

  it('links to plan selection and keeps logout at the bottom of the footer', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/choose-plan" element={<h1>Choose plan</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    const paymentLink = screen.getByRole('link', { name: 'გადახდაზე გადასვლა' })
    expect(paymentLink.getAttribute('href')).toBe('/choose-plan')

    const footer = document.querySelector('.home-footer')
    expect(footer?.lastElementChild).toBe(screen.getByRole('button', { name: 'გასვლა' }))

    fireEvent.click(screen.getByRole('button', { name: 'გასვლა' }))
    expect(state.signOut).toHaveBeenCalledOnce()

    fireEvent.click(paymentLink)
    expect(screen.getByRole('heading', { name: 'Choose plan' })).toBeTruthy()
  })
})
