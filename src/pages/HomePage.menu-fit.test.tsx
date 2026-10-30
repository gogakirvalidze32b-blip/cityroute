/**
 * The automatic home menu stays compact; manual route selection remains usable on
 * short Android landscape viewports.
 * (happy-dom has no real layout engine, so we assert structure + CSS rules rather than pixels.)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HomePage } from './HomePage'
import { detectExamLayoutMode } from '@/hooks/useExamLayoutMode'

const homeState = vi.hoisted(() => ({
  profile: {
    subscription_status: 'active',
    subscription_plan: 'car_1',
    device_slots: 1,
  } as {
    subscription_status: string
    subscription_plan: string | null
    subscription_expires_at?: string
    device_slots: number
  },
  hasAccess: true,
  deviceBlocked: null as string | null,
  signOut: vi.fn(),
}))

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => homeState,
}))

vi.mock('@/hooks/useRoutes', () => ({
  useRoutes: () => ({
    source: 'local',
    routes: [
      { id: '1', slug: 'route-1', name_ka: 'მარშრუტი 1', license_category: 'B', official_label: null },
      { id: '2', slug: 'route-2', name_ka: 'მარშრუტი 2', license_category: 'B', official_label: null },
      { id: '3', slug: 'route-3', name_ka: 'მარშრუტი 3', license_category: 'B', official_label: null },
      { id: '4', slug: 'route-4', name_ka: 'მარშრუტი 4', license_category: 'B', official_label: null },
      { id: '5', slug: 'route-5', name_ka: 'C/D კატეგორია', license_category: 'C,D', official_label: null },
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

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('HomePage outer menu fit (Android landscape)', () => {
  beforeEach(() => {
    cleanup()
    homeState.profile = {
      subscription_status: 'active',
      subscription_plan: 'car_1',
      device_slots: 1,
    }
    homeState.hasAccess = true
    homeState.deviceBlocked = null
  })
  afterEach(() => {
    cleanup()
    setViewport(1024, 768)
  })

  it.each([
    [320, 568],
    [360, 640],
    [393, 851],
    [412, 915],
    [1024, 600],
    [800, 480],
    [1280, 720],
    [390, 844],
    [390, 700],
    [1440, 900],
  ])('keeps the four route choices and footer actions available for %i×%i', (width, height) => {
    setViewport(width, height)
    renderHome()

    expect(screen.getByTestId('home-route-list')).toBeTruthy()
    expect(screen.getByTestId('home-route-card-route-1')).toBeTruthy()
    expect(screen.getByTestId('home-route-card-route-2')).toBeTruthy()
    expect(screen.getByTestId('home-route-card-route-3')).toBeTruthy()
    expect(screen.getByTestId('home-route-card-route-4')).toBeTruthy()
    expect(screen.queryAllByTestId(/^home-route-card-/)).toHaveLength(4)
    expect(screen.queryByText('C/D კატეგორია')).toBeNull()
    expect(screen.queryByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'PIN-ის არჩევა ხელით' })).toBeNull()
    expect(screen.getByRole('button', { name: 'გასვლა' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'მხარდაჭერა' })).toBeTruthy()
  })

  it('keeps laptop detection for tall wide desktops', () => {
    setViewport(1440, 900)
    expect(detectExamLayoutMode()).toBe('laptop')
    renderHome()
    expect(document.querySelector('.home-page--laptop')).toBeTruthy()
  })

  it('offers active trial users a path to pay before their trial expires', () => {
    homeState.profile = {
      subscription_status: 'trial',
      subscription_plan: 'premium',
      subscription_expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      device_slots: 1,
    }
    renderHome()

    expect(screen.getByTestId('home-early-payment').getAttribute('href')).toBe(
      '/choose-plan?earlyPayment=1',
    )
  })

  it('marks typical car monitors with a non-laptop layout class', () => {
    setViewport(1024, 600)
    expect(detectExamLayoutMode()).toBe('tablet')
    renderHome()
    expect(document.querySelector('.home-page--tablet')).toBeTruthy()
    expect(document.querySelector('.home-page--laptop')).toBeNull()
  })

  it('ships vertical adaptive home CSS that fits the screenshot stack in dvh', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/max-height:\s*100dvh/)
    expect(css).toMatch(/\.home-page \.route-list[\s\S]*flex-direction:\s*column/)
    expect(css).toMatch(/\.home-page \.route-list[\s\S]*flex-wrap:\s*nowrap/)
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 620px\)/)
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 500px\)/)
    expect(css).not.toMatch(/\.home-page \.route-card[\s\S]*flex:\s*1 1 calc\(50%/)
  })
})
