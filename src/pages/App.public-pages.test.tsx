// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'

const catalog = vi.hoisted(() => ({
  load: vi.fn(),
}))

vi.mock('@/lib/device-slot-packages', () => ({
  loadDeviceSlotPackages: catalog.load,
}))

vi.mock('@/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ user: null, loading: false }),
}))

const PUBLIC_PAGES = [
  ['/about', 'ჩვენ შესახებ'],
  ['/contact', 'კონტაქტი'],
  ['/pricing', 'ფასები და პაკეტები'],
  ['/terms', 'წესები და პირობები'],
  ['/cancellation-refunds', 'გაუქმება და თანხის დაბრუნება'],
  ['/privacy-policy', 'კონფიდენციალურობის პოლიტიკა'],
] as const

describe('public information routes', () => {
  beforeEach(() => {
    catalog.load.mockReset()
    catalog.load.mockResolvedValue([
      { subscription_plan: 'premium', device_slots: 1, price_amount: 137, currency: 'GEL', sort_order: 1 },
      { subscription_plan: 'premium', device_slots: 2, price_amount: 241, currency: 'GEL', sort_order: 2 },
    ])
  })

  afterEach(cleanup)

  it.each(PUBLIC_PAGES)('renders %s without an authenticated user', async (path, title) => {
    window.history.replaceState({}, '', path)
    render(<App />)

    expect(await screen.findByRole('heading', { name: title })).toBeTruthy()
  })

  it('shows live catalog prices and package access terms on the public pricing page', async () => {
    window.history.replaceState({}, '', '/pricing')
    render(<App />)

    expect(await screen.findByText('137 ₾')).toBeTruthy()
    expect(screen.getByText('241 ₾')).toBeTruthy()
    expect(screen.getAllByText('წვდომის ხანგრძლივობა: 30 დღე')).toHaveLength(2)
    expect(catalog.load).toHaveBeenCalledOnce()
  })

  it('shows a visible error instead of stale prices when the catalog cannot load', async () => {
    catalog.load.mockRejectedValue(new Error('catalog unavailable'))
    window.history.replaceState({}, '', '/pricing')
    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('მიმდინარე პაკეტების ჩატვირთვა ვერ მოხერხდა')
    expect(screen.queryByText(/99 ₾|179 ₾/)).toBeNull()
  })

  it('provides clickable support phone and email on the public contact page', async () => {
    window.history.replaceState({}, '', '/contact')
    render(<App />)

    await screen.findByRole('heading', { name: 'კონტაქტი' })
    expect(screen.getAllByRole('link', { name: '597 595 9575' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: '597 595 9575' }).every(
      (link) => link.getAttribute('href') === 'tel:5975959575',
    )).toBe(true)
    expect(screen.getAllByRole('link', { name: 'support@cityroute.ge' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'support@cityroute.ge' }).every(
      (link) => link.getAttribute('href') === 'mailto:support@cityroute.ge',
    )).toBe(true)
    expect(screen.getByText('მისამართი: ქ. თბილისი, ლილოს დასახლება')).toBeTruthy()
  })

  it('renders the nine numbered terms sections and links to live pricing and privacy details', async () => {
    window.history.replaceState({}, '', '/terms')
    render(<App />)

    for (let section = 1; section <= 9; section += 1) {
      expect(await screen.findByRole('heading', { name: new RegExp(`^${section}\\.`) })).toBeTruthy()
    }

    expect(screen.getByRole('link', { name: 'ფასებისა და პაკეტების გვერდზე' }).getAttribute('href')).toBe('/pricing')
    expect(screen.getByRole('link', { name: 'კონფიდენციალურობის პოლიტიკა' }).getAttribute('href')).toBe('/privacy-policy')
    expect(screen.getByText('მისამართი: ქ. თბილისი, ლილოს დასახლება')).toBeTruthy()
    expect(screen.getByRole('link', { name: '579 15 59 75' }).getAttribute('href')).toBe('tel:579155975')
    expect(screen.getByText(/ავტომატურ განახლებას ან განმეორებით ჩამოჭრას არ ასრულებს/)).toBeTruthy()
    expect(screen.getByText(/დაბრუნების კრიტერიუმები ან განხილვის\/დაბრუნების ვადები ამჟამად განსაზღვრული არ არის/)).toBeTruthy()
  })
})
