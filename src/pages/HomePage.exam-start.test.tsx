import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from './HomePage'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: {
      subscription_status: 'active',
      subscription_plan: 'car_1',
      device_slots: 1,
    },
    hasAccess: true,
    deviceBlocked: null,
    signOut: vi.fn(),
  }),
}))

vi.mock('@/hooks/useRoutes', () => ({
  useRoutes: () => ({
    source: 'local',
    routes: [
      { id: '1', slug: 'route-1', name_ka: 'მარშრუტი 1', license_category: 'B', official_label: null },
      { id: '2', slug: 'route-2', name_ka: 'მარშრუტი 2', license_category: 'B', official_label: null },
      { id: '3', slug: 'route-3', name_ka: 'მარშრუტი 3', license_category: 'B', official_label: null },
      { id: '4', slug: 'route-4', name_ka: 'მარშრუტი 4', license_category: 'B', official_label: null },
      { id: '5', slug: 'route-5', name_ka: 'მარშრუტი 5', license_category: 'B', official_label: null },
    ],
  }),
}))

vi.mock('@/components/support/SupportLinks', () => ({
  SupportButton: () => <button type="button">მხარდაჭერა</button>,
  SupportFooterLinks: () => <div>links</div>,
}))

vi.mock('@/components/AppBrand', () => ({
  AppBrand: () => <div>CityRoute</div>,
}))

function CurrentPath() {
  const { pathname } = useLocation()
  return <output data-testid="current-path">{pathname}</output>
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <>
        <CurrentPath />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/route/:slug" element={<div data-testid="exam-route" />} />
        </Routes>
      </>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('HomePage route selection', () => {
  it('shows only the four selectable routes without PIN-mode controls', () => {
    renderHome()

    expect(screen.getByTestId('home-route-list')).toBeTruthy()
    expect(screen.queryAllByTestId(/^home-route-card-/)).toHaveLength(4)
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
      expect(screen.getByTestId(`home-route-card-${slug}`).getAttribute('href')).toBe(`/route/${slug}`)
    }
    expect(screen.queryByTestId('home-route-card-route-5')).toBeNull()
    expect(screen.queryByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'PIN-ის არჩევა ხელით' })).toBeNull()
  })

  it('opens the selected route so its exam-start screen can choose the PIN mode', () => {
    renderHome()

    fireEvent.click(screen.getByTestId('home-route-card-route-2'))

    expect(screen.getByTestId('current-path').textContent).toBe('/route/route-2')
    expect(screen.getByTestId('exam-route')).toBeTruthy()
  })
})
