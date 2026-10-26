import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    subscription_expires_at: string
    subscription_plan: string | null
    device_slots: number
  },
  selectPackage: vi.fn(async (_deviceSlots: number) => null as string | null),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => h,
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/choose-plan']}>
      <Routes>
        <Route path="/choose-plan" element={<PlanSelectionPage />} />
        <Route path="/" element={<p>ROUTE_HOME</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Premium selection and payment offer', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://sandbox-project.supabase.co')
    h.loading = false
    h.user = { id: 'user-1' }
    h.hasAccess = true
    h.needsPlanSelection = true
    h.deviceBlocked = null
    h.profile = {
      id: 'user-1',
      subscription_status: 'trial',
      subscription_expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      subscription_plan: null,
      device_slots: 1,
    }
    h.selectPackage.mockReset()
    h.selectPackage.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('updates the single payment button to the selected package price', () => {
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
    fireEvent.click(screen.getByRole('radio', { name: /2 მანქანისთვის/ }))
    expect(screen.getByRole('button', { name: '24-საათიანი უფასო Trial' })).toBeTruthy()
    expect(screen.getByText('უფასო წვდომა 24 საათით, გადახდის გარეშე.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '24-საათიანი უფასო Trial' }))

    await waitFor(() => expect(h.selectPackage).toHaveBeenCalledWith(2))
    expect(await screen.findByText('ROUTE_HOME')).toBeTruthy()
  })

  it('shows payment after trial expiration and does not offer a second trial', () => {
    h.hasAccess = false
    h.needsPlanSelection = false
    h.profile = {
      id: 'user-1',
      subscription_status: 'expired',
      subscription_expires_at: new Date(Date.now() - 1000).toISOString(),
      subscription_plan: 'premium',
      device_slots: 2,
    }

    renderPage()
    expect(screen.getByRole('button', { name: 'გადახდა — 179 ₾' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '24-საათიანი უფასო Trial' })).toBeNull()
    expect(screen.getByText(/გადახდის დადასტურების შემდეგ/)).toBeTruthy()
  })

  it('keeps the active Trial visible when this device is blocked and routes the user to packages', () => {
    h.hasAccess = false
    h.deviceBlocked = 'ეს ანგარიში სხვა მანქანაზეა მიბმული'

    renderPage()

    expect(screen.getByText('უფასო Trial აქტიურია')).toBeTruthy()
    expect(screen.getByText(/საცდელი: .*დარჩა/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(h.deviceBlocked)
    expect(screen.getByRole('button', { name: 'გადახდა — 99 ₾' })).toBeTruthy()
  })

  it('disables Sandbox payment when Preview points at Production Supabase', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://tuylbbdhvfcobxynwtnt.supabase.co')

    renderPage()

    expect(screen.getByRole('button', { name: 'გადახდა — 99 ₾' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Production Supabase')
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
    expect(screen.queryByRole('button', { name: '24-საათიანი უფასო Trial' })).toBeNull()
  })

  it('keeps trial information visual-only in the demo', () => {
    h.user = null
    h.profile = null
    render(
      <MemoryRouter>
        <PlanSelectionPage previewMode="trial" />
      </MemoryRouter>,
    )

    expect(screen.getByText('დემო Trial · რეალური წვდომა ანგარიშის სტატუსზეა დამოკიდებული')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('ცალკე Preview Supabase')
    expect(screen.queryByRole('button', { name: '24-საათიანი უფასო Trial' })).toBeNull()
    expect(h.selectPackage).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: /^გადახდა —/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'გადახდა — 99 ₾' }).hasAttribute('disabled')).toBe(true)
  })
})
