/**
 * Outer home menu must keep every route button available on short Android landscape viewports.
 * (happy-dom has no real layout engine, so we assert structure + CSS rules rather than pixels.)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HomePage } from './HomePage'
import { detectExamLayoutMode } from '@/hooks/useExamLayoutMode'

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
  })
  afterEach(() => {
    cleanup()
    setViewport(1024, 768)
  })

  it.each([
    [1024, 600],
    [800, 480],
    [1280, 720],
  ])('renders every route button for %i×%i car landscape', (width, height) => {
    setViewport(width, height)
    renderHome()

    expect(screen.getByTestId('home-route-list')).toBeTruthy()
    expect(screen.getByTestId('home-route-card-route-1')).toBeTruthy()
    expect(screen.getByTestId('home-route-card-route-2')).toBeTruthy()
    expect(screen.getByTestId('home-route-card-route-3')).toBeTruthy()
    expect(screen.getByTestId('home-route-card-route-4')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'გასვლა' })).toBeTruthy()
  })

  it('keeps laptop detection for tall wide desktops', () => {
    setViewport(1440, 900)
    expect(detectExamLayoutMode()).toBe('laptop')
    renderHome()
    expect(document.querySelector('.home-page--laptop')).toBeTruthy()
  })

  it('marks typical car monitors with a non-laptop layout class', () => {
    setViewport(1024, 600)
    expect(detectExamLayoutMode()).toBe('tablet')
    renderHome()
    expect(document.querySelector('.home-page--tablet')).toBeTruthy()
    expect(document.querySelector('.home-page--laptop')).toBeNull()
  })

  it('ships short-landscape CSS that wraps route cards into the viewport', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 720px\)/)
    expect(css).toMatch(/\.home-page \.route-list[\s\S]*flex-wrap:\s*wrap/)
    expect(css).toMatch(/\.home-page \.route-card[\s\S]*flex:\s*1 1 calc\(50%/)
    expect(css).toMatch(/max-height:\s*100dvh/)
  })
})
