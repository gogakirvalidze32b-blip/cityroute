import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from './HomePage'
import { hasSavedExamForSlug } from '@/lib/exam-persistence'

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

vi.mock('@/lib/exam-persistence', () => ({
  hasSavedExamForSlug: vi.fn(() => false),
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

afterEach(() => {
  cleanup()
  vi.mocked(hasSavedExamForSlug).mockReset()
  vi.mocked(hasSavedExamForSlug).mockReturnValue(false)
})

describe('HomePage exam start', () => {
  it('starts route 1 by default and keeps the route list hidden', () => {
    renderHome()

    expect(screen.queryByTestId('home-route-list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'გამოცდის დაწყება' }))

    expect(screen.getByTestId('current-path').textContent).toBe('/route/route-1')
  })

  it('resumes the saved route after a fresh automatic-mode mount', () => {
    vi.mocked(hasSavedExamForSlug).mockImplementation((slug) => slug === 'route-3')
    renderHome()

    fireEvent.click(screen.getByRole('button', { name: 'გამოცდის დაწყება' }))

    expect(screen.getByTestId('current-path').textContent).toBe('/route/route-3')
  })

  it('switches modes in place and requires a manual route before starting', () => {
    renderHome()

    fireEvent.click(screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' }))

    expect(screen.getByTestId('current-path').textContent).toBe('/')
    expect(screen.getByTestId('home-route-list')).toBeTruthy()
    expect(screen.queryByTestId('home-route-card-route-5')).toBeNull()
    expect(screen.getByRole('button', { name: 'გამოცდის დაწყება' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByTestId('home-route-card-route-2'))
    expect(screen.getByRole('button', { name: 'გამოცდის დაწყება' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'გამოცდის დაწყება' }))

    expect(screen.getByTestId('current-path').textContent).toBe('/route/route-2')
  })

  it('starts the manually chosen route so its existing saved PIN progress can resume', () => {
    vi.mocked(hasSavedExamForSlug).mockImplementation((slug) => slug === 'route-2')
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' }))
    fireEvent.click(screen.getByTestId('home-route-card-route-2'))
    fireEvent.click(screen.getByRole('button', { name: 'გამოცდის დაწყება' }))

    expect(screen.getByTestId('current-path').textContent).toBe('/route/route-2')
    expect(hasSavedExamForSlug).toHaveBeenCalledWith('route-2', 'მარშრუტი 2')
  })
})
