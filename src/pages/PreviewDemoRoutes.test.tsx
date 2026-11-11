import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '@/App'
import { createExamSession } from '@/lib/exam-session'
import { clearActiveExam, saveActiveExam } from '@/lib/exam-persistence'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'

const supabase = vi.hoisted(() => ({
  getSupabase: vi.fn(() => {
    throw new Error('Supabase must not be used by Preview Demo')
  }),
  isSupabaseConfigured: true,
}))

vi.mock('@/lib/supabase', () => supabase)
vi.mock('@/hooks/useExamLayoutMode', () => ({ useExamLayoutMode: () => 'laptop' }))
vi.mock('@/components/RoutePreviewMap', () => ({
  RoutePreviewMap: ({
    route,
    selectedPinOrder,
    onPinSelect,
    offlineMaps,
  }: {
    route: { slug: string }
    selectedPinOrder?: number | null
    onPinSelect?: (order: number) => void
    offlineMaps?: boolean
  }) => (
    <div data-testid="demo-route-map" data-offline={String(offlineMaps)} data-route={route.slug}>
      <output data-testid="selected-demo-pin">{selectedPinOrder ?? ''}</output>
      <button type="button" onClick={() => onPinSelect?.(2)}>PIN 2 map marker</button>
    </div>
  ),
}))
vi.mock('@/components/ExamLiveMap', () => ({ ExamLiveMap: () => null }))
vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(() => Promise.resolve(true)),
    playDetailed: vi.fn(() => Promise.resolve('played')),
    unlock: vi.fn(),
    isBusy: vi.fn(() => false),
    stopAll: vi.fn(),
    preloadAll: vi.fn(),
    setVolume: vi.fn(),
  },
}))
vi.mock('@/lib/gps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gps')>()
  return {
    ...actual,
    hasGpsConsent: vi.fn(() => true),
    shouldAutoStartGps: vi.fn(() => Promise.resolve(false)),
    getGpsEnvironmentIssue: vi.fn(() => null),
    requestWakeLock: vi.fn(() => Promise.resolve(() => {})),
    watchGps: vi.fn(() => () => {}),
  }
})

const externalFetch = vi.fn()
const externalWebSocket = vi.fn()

beforeEach(() => {
  window.history.replaceState({}, '', '/preview-demo')
  localStorage.clear()
  supabase.getSupabase.mockClear()
  vi.stubGlobal('fetch', externalFetch)
  vi.stubGlobal('WebSocket', externalWebSocket)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  externalFetch.mockReset()
  externalWebSocket.mockReset()
})

describe('isolated Preview Demo mode', () => {
  it('renders only four local routes and makes no external API connections', async () => {
    render(<App />)

    expect(await screen.findByTestId('demo-route-list')).toBeTruthy()
    expect(screen.getAllByTestId(/^demo-route-card-/)).toHaveLength(4)
    expect(screen.queryByTestId('demo-route-card-route-5')).toBeNull()
    expect(screen.getByText(/სინთეზური მომხმარებელი/)).toBeTruthy()

    fireEvent.click(screen.getByTestId('demo-route-card-route-2'))

    expect(await screen.findByTestId('preview-gps-demo-panel')).toBeTruthy()
    expect(screen.getByLabelText('DEMO მარშრუტი')).toHaveValue('route-2')
    expect(screen.getByRole('button', { name: 'PLAY' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'PAUSE' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'RESET DEMO' })).toBeEnabled()

    expect(await screen.findByTestId('demo-route-map')).toHaveAttribute('data-offline', 'true')
    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.queryByText('SESSION DIAGNOSTIC')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' }))
    fireEvent.click(screen.getByRole('button', { name: 'PIN 2 map marker' }))
    expect(screen.getByTestId('selected-demo-pin')).toHaveTextContent('2')

    const controls = screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' })
    const start = screen.getByRole('button', { name: /გამოცდის დაწყება/ })
    expect(controls.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await waitFor(() => {
      expect(supabase.getSupabase).not.toHaveBeenCalled()
      expect(externalFetch).not.toHaveBeenCalled()
      expect(externalWebSocket).not.toHaveBeenCalled()
    })
    expect(screen.queryByRole('button', { name: /მხარდაჭერა|გასვლა/ })).toBeNull()
    expect(screen.queryByText(/გადახდა|Premium-ის შეძენა/i)).toBeNull()
  })

  it('keeps demo route saves separate from production localStorage keys', async () => {
    localStorage.setItem('cityroute-active-exam:route-1', JSON.stringify({
      routeId: 'live-route-1',
      routeSlug: 'route-1',
      routeName: 'Production exam',
      phase: 'active',
      savedAt: Date.now(),
    }))
    window.history.replaceState({}, '', '/preview-demo/route/route-1')

    render(<App />)

    expect(await screen.findByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' })).toBeTruthy()
    expect(localStorage.getItem('cityroute-active-exam:route-1')).toContain('Production exam')
    expect(supabase.getSupabase).not.toHaveBeenCalled()
    expect(externalFetch).not.toHaveBeenCalled()
    expect(externalWebSocket).not.toHaveBeenCalled()
  })

  it('restores an active demo route from refresh and blocks browser history navigation', async () => {
    const route = TELAVI_ROUTES_FALLBACK.find((candidate) => candidate.slug === 'route-1')!
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 0,
      triggeredPins: [],
      triggeredSortOrders: [],
      savedAt: Date.now(),
    }, {}, 'preview-demo-user')
    window.history.replaceState({}, '', '/preview-demo/route/route-1')

    render(<App />)

    await waitFor(() => {
      expect(document.querySelector('.exam-session--active')).toBeTruthy()
    })
    expect(window.location.pathname).toBe('/preview-demo/route/route-1')

    window.history.pushState({}, '', '/preview-demo')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await waitFor(() => {
      expect(window.location.pathname).toBe('/preview-demo/route/route-1')
    })
    expect(screen.getByRole('alert')).toHaveTextContent('გთხოვთ, დაასრულოთ მარშრუტი და შემდეგ გამოხვიდეთ.')

    clearActiveExam(route.id, route.slug, route.name_ka, 'preview-demo-user')
  })
})
