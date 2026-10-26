import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HomePage } from './HomePage'

const authState = vi.hoisted(() => ({
  profile: null as {
    subscription_status: string
    subscription_plan: string
    device_slots: number
  } | null,
  hasAccess: true,
  deviceBlocked: null as string | null,
  signOut: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authState,
}))

vi.mock('@/hooks/useRoutes', () => ({
  useRoutes: () => ({
    source: 'local',
    routes: [],
  }),
}))

vi.mock('@/components/support/SupportLinks', () => ({
  SupportButton: () => <button type="button">მხარდაჭერა</button>,
  SupportFooterLinks: () => <p data-testid="support-footer-links">დახმარება</p>,
}))

vi.mock('@/components/AppBrand', () => ({
  AppBrand: () => <div>CityRoute</div>,
}))

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('HomePage trial actions', () => {
  beforeEach(() => {
    cleanup()
    authState.profile = {
      subscription_status: 'trial',
      subscription_plan: 'car_1',
      device_slots: 1,
    }
    authState.hasAccess = true
    authState.deviceBlocked = null
    authState.signOut.mockReset()
  })

  it('shows the plan-selection link for a trial user', () => {
    renderHomePage()

    expect(screen.getByRole('link', { name: 'გადახდაზე გადასვლა' }).getAttribute('href')).toBe('/choose-plan')
  })

  it('places the sign-out button at the end of the home footer', () => {
    renderHomePage()

    const footer = document.querySelector('.home-footer')
    const signOutButton = screen.getByRole('button', { name: 'გასვლა' })

    expect(footer?.lastElementChild).toBe(signOutButton)
  })

  it('calls the existing signOut action when the user selects sign out', () => {
    renderHomePage()

    fireEvent.click(screen.getByRole('button', { name: 'გასვლა' }))

    expect(authState.signOut).toHaveBeenCalledOnce()
  })
})
