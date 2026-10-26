import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RoutePage } from './RoutePage'

const h = vi.hoisted(() => ({
  hasAccess: true,
  deviceBlocked: null as string | null,
  profile: {
    subscription_status: 'trial',
  },
  signOut: vi.fn(),
  hasSavedExam: false,
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => h,
}))

vi.mock('@/hooks/useRoutes', () => ({
  useRoutes: () => ({
    routes: [
      {
        id: 'route-1',
        slug: 'route-1',
        name_ka: 'მარშრუტი 1',
        license_category: 'B',
        official_label: null,
      },
    ],
  }),
}))

vi.mock('@/components/ExamDriveSession', () => ({
  ExamDriveSession: () => <div>ROUTE_SESSION</div>,
}))

vi.mock('@/lib/exam-persistence', () => ({
  hasSavedExamForSlug: () => h.hasSavedExam,
}))

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/route/route-1']}>
      <Routes>
        <Route path="/route/:slug" element={<RoutePage />} />
        <Route path="/choose-plan" element={<p>PLAN_SELECTION</p>} />
        <Route path="/login" element={<p>LOGIN</p>} />
        <Route path="/" element={<p>HOME</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Trial route actions', () => {
  beforeEach(() => {
    h.hasAccess = true
    h.deviceBlocked = null
    h.profile = { subscription_status: 'trial' }
    h.signOut.mockReset()
    h.hasSavedExam = false
  })

  it('shows package navigation and logout in route preview', () => {
    renderRoute()

    expect(screen.getByRole('link', { name: 'პაკეტები / გადახდა' }).getAttribute('href')).toBe('/choose-plan')
    fireEvent.click(screen.getByRole('button', { name: 'გასვლა' }))
    expect(h.signOut).toHaveBeenCalledOnce()
  })

  it('keeps package navigation and logout available while a trial route is active', () => {
    h.hasSavedExam = true
    renderRoute()

    expect(screen.getByRole('link', { name: 'პაკეტები / გადახდა' }).getAttribute('href')).toBe('/choose-plan')
    fireEvent.click(screen.getByRole('button', { name: 'გასვლა' }))
    expect(h.signOut).toHaveBeenCalledOnce()
  })

  it('sends blocked devices directly to the package page', () => {
    h.hasAccess = false
    h.deviceBlocked = 'device blocked'
    renderRoute()

    expect(screen.getByText('PLAN_SELECTION')).toBeTruthy()
  })
})
