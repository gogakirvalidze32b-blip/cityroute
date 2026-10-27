import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanSelectionPage } from './PlanSelectionPage'

const h = vi.hoisted(() => ({
  loading: false,
  user: { id: 'user-1' } as { id: string } | null,
  hasAccess: true,
  needsPlanSelection: true,
  deviceBlocked: null as string | null,
  profile: null as null | {
    id: string
    subscription_status: 'trial' | 'expired'
    trial_started_at: string
    subscription_expires_at: string
    subscription_plan: string | null
    device_slots: number
  },
  selectPackage: vi.fn(async (_deviceSlots: number) => null as string | null),
  signOut: vi.fn(async () => {}),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => h,
}))

function renderPage(initialEntry = '/choose-plan') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/choose-plan" element={<PlanSelectionPage />} />
        <Route path="/" element={<p>ROUTE_HOME</p>} />
        <Route path="/login" element={<p>ROUTE_LOGIN</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Premium selection and payment offer', () => {
  beforeEach(() => {
    h.loading = false
    h.user = { id: 'user-1' }
    h.hasAccess = true
    h.needsPlanSelection = true
    h.deviceBlocked = null
    h.profile = {
      id: 'user-1',
      subscription_status: 'trial',
      trial_started_at: new Date(Date.now() - 1000).toISOString(),
      subscription_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      subscription_plan: null,
      device_slots: 1,
    }
    h.selectPackage.mockReset()
    h.selectPackage.mockResolvedValue(null)
    h.signOut.mockReset()
  })

  it('updates the single payment button to the selected package price', () => {
    h.hasAccess = false
    h.profile = {
      id: 'user-1',
      subscription_status: 'expired',
      trial_started_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      subscription_expires_at: new Date(Date.now() - 1000).toISOString(),
      subscription_plan: null,
      device_slots: 1,
    }
    renderPage()
    expect(screen.getByRole('heading', { name: 'CityRoute Premium' })).toBeTruthy()
    expect(screen.getByText('მოამზადე მოსწავლე მართვის პრაქტიკული გამოცდისთვის')).toBeTruthy()
    expect(screen.getByText(/CityRoute ინსტრუქტორებს ეხმარება/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'გადახდა — 99 ₾' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /1 მანქანა/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByText('99 ₾', { exact: true }).length).toBeGreaterThan(0)
    expect(screen.getByText('საგამოცდო მარშრუტები — ქალაქი თელავი')).toBeTruthy()
    expect(screen.getByText('ხმოვანი მითითებები გზაზე')).toBeTruthy()
    expect(screen.getByText('მოსწავლის მომზადება რეალურ მარშრუტებზე')).toBeTruthy()
    expect(screen.getByText('მოსახერხებელი GPS ნავიგაცია')).toBeTruthy()
    expect(screen.queryByText(/საქართველოს ბანკი/)).toBeNull()
    expect(screen.queryByText(/TBC/i)).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: /2 მანქანისთვის/ }))
    expect(screen.getByRole('button', { name: 'გადახდა — 179 ₾' })).toBeTruthy()
    expect(screen.getByText('198 ₾')).toBeTruthy()
    expect(screen.getByText('დაზოგავ 19 ₾-ს')).toBeTruthy()
    expect(screen.queryByText(/თვეში.*დაზოგავ|დაზოგავ.*თვეში/)).toBeNull()
    expect(screen.getByRole('radio', { name: /2 მანქანისთვის/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByText('179 ₾', { exact: true }).length).toBeGreaterThan(0)
  })

  it('saves the selected package and continues on the existing trial without signing in again', async () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'გადახდა — 99 ₾' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /2 მანქანისთვის/ }))
    expect(screen.getByRole('button', { name: '12-საათიანი უფასო Trial' })).toBeTruthy()
    expect(screen.getByText('უფასო წვდომა 12 საათით, გადახდის გარეშე.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '12-საათიანი უფასო Trial' }))

    await waitFor(() => expect(h.selectPackage).toHaveBeenCalledWith(2))
    expect(await screen.findByText('ROUTE_HOME')).toBeTruthy()
  })

  it('keeps early payment available for a trial user with an existing package', () => {
    h.hasAccess = true
    h.needsPlanSelection = false
    h.profile = {
      id: 'user-1',
      subscription_status: 'trial',
      trial_started_at: new Date(Date.now() - 1000).toISOString(),
      subscription_expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      subscription_plan: 'premium',
      device_slots: 1,
    }

    renderPage('/choose-plan?earlyPayment=1')
    expect(screen.getByRole('button', { name: 'გადახდა — 99 ₾' })).toBeTruthy()
    expect(screen.getByText(/Trial აქტიურია — გადახდა სურვილისამებრ/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '12-საათიანი უფასო Trial' })).toBeNull()
  })

  it('lets an active trial user return to routes from plan selection', () => {
    h.hasAccess = true
    h.needsPlanSelection = false
    h.profile = {
      id: 'user-1',
      subscription_status: 'trial',
      trial_started_at: new Date(Date.now() - 1000).toISOString(),
      subscription_expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      subscription_plan: 'premium',
      device_slots: 1,
    }

    renderPage('/choose-plan?earlyPayment=1')

    const backToRoutes = screen.getByRole('link', { name: 'მარშრუტებზე დაბრუნება' })
    expect(backToRoutes.getAttribute('href')).toBe('/')
    fireEvent.click(backToRoutes)
    expect(screen.getByText('ROUTE_HOME')).toBeTruthy()
  })

  it('signs out from the bottom of the plan selection page', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'გამოსვლა' }))

    await waitFor(() => expect(h.signOut).toHaveBeenCalledOnce())
    expect(await screen.findByText('ROUTE_LOGIN')).toBeTruthy()
  })

  it('explains a blocked device when the trial still has time and does not send the user to payment', () => {
    h.hasAccess = false
    h.deviceBlocked = 'ეს ანგარიში სხვა მანქანაზეა მიბმული'
    renderPage()

    expect(screen.getByText('უფასო Trial აქტიურია')).toBeTruthy()
    expect(screen.getByText(/Trial-ს ჯერ კიდევ დარჩენილი დრო აქვს, მაგრამ ეს მოწყობილობა დაბლოკილია/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '12-საათიანი უფასო Trial' })).toBeNull()
    expect(screen.getByRole('button', { name: 'გადახდა — 99 ₾' })).toBeTruthy()
  })

  it('shows payment after trial expiration and does not offer a second trial', () => {
    h.hasAccess = false
    h.needsPlanSelection = false
    h.profile = {
      id: 'user-1',
      subscription_status: 'expired',
      trial_started_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      subscription_expires_at: new Date(Date.now() - 1000).toISOString(),
      subscription_plan: 'premium',
      device_slots: 2,
    }

    renderPage()
    expect(screen.getByRole('button', { name: 'გადახდა — 179 ₾' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '12-საათიანი უფასო Trial' })).toBeNull()
    expect(screen.getByText(/გადახდის დადასტურების შემდეგ/)).toBeTruthy()
  })

  it('returns to payment after 12 hours even if the stored expiry is still 24 hours', () => {
    h.hasAccess = false
    h.needsPlanSelection = false
    h.profile = {
      id: 'user-1',
      subscription_status: 'trial',
      trial_started_at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
      subscription_expires_at: new Date(Date.now() + 11 * 60 * 60 * 1000).toISOString(),
      subscription_plan: 'premium',
      device_slots: 1,
    }

    renderPage()
    expect(screen.getByRole('button', { name: 'გადახდა — 99 ₾' })).toBeTruthy()
    expect(screen.queryByText('უფასო Trial აქტიურია')).toBeNull()
  })

  it('renders selectable packages and one disabled payment button in the visual preview', () => {
    h.user = null
    h.profile = null
    render(
      <MemoryRouter>
        <PlanSelectionPage previewMode="expired" />
      </MemoryRouter>,
    )

    expect(screen.queryByText('PREVIEW · გადახდა გამორთულია')).toBeNull()
    expect(screen.getByRole('radio', { name: /1 მანქანა/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /2 მანქანისთვის/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'გადახდა — 99 ₾' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: /2 მანქანისთვის/ }))
    expect(screen.getByRole('button', { name: 'გადახდა — 179 ₾' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('198 ₾')).toBeTruthy()
    expect(screen.getByText('დაზოგავ 19 ₾-ს')).toBeTruthy()
    expect(screen.queryByText(/თვეში.*დაზოგავ|დაზოგავ.*თვეში/)).toBeNull()
    expect(screen.getAllByRole('button', { name: /^გადახდა —/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '12-საათიანი უფასო Trial' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'გამოსვლა' })).toBeNull()
  })

  it('keeps trial information visual-only in the demo', () => {
    h.user = null
    h.profile = null
    render(
      <MemoryRouter>
        <PlanSelectionPage previewMode="trial" />
      </MemoryRouter>,
    )

    expect(screen.getByText('ადგილობრივი დემო · 12 სთ სატესტო წვდომა')).toBeTruthy()
    expect(screen.getByText('12', { selector: '.subscription-status__icon' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '12-საათიანი უფასო Trial' })).toBeNull()
    expect(h.selectPackage).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^გადახდა —/ })).toBeNull()
  })

  it('shows the blocked-device explanation in the local 12-hour preview', () => {
    h.user = null
    h.profile = null
    render(
      <MemoryRouter>
        <PlanSelectionPage previewMode="blocked-trial" />
      </MemoryRouter>,
    )

    expect(screen.getByText('ადგილობრივი დემო · 12 სთ სატესტო წვდომა')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('ეს მოწყობილობა დაბლოკილია')
    expect(screen.queryByRole('button', { name: /^გადახდა —/ })).toBeNull()
  })
})
