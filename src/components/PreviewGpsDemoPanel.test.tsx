import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { PreviewGpsDemoPanel } from './PreviewGpsDemoPanel'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { selectableRoutes } from '@/data/selectable-routes'
import { createPreviewGpsSource } from '@/lib/preview-gps-source'
import {
  DEFAULT_DEMO_SPEED_KMH,
  DEFAULT_DEMO_TIME_SCALE,
  DEMO_SPEED_KMH_OPTIONS,
  DEMO_TIME_SCALE_OPTIONS,
} from '@/lib/preview-gps-demo-speed'

vi.mock('@/lib/audio', () => ({
  audioEngine: {
    isBusy: vi.fn(() => false),
    play: vi.fn(),
    playDetailed: vi.fn(),
    stopAll: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
})

describe('PreviewGpsDemoPanel speed controls', () => {
  it('defaults to 60 km/h cruise and 1x, exposes all demo speeds/scales, and allows live changes', () => {
    const routes = selectableRoutes(TELAVI_ROUTES_FALLBACK)
    const route = routes[0]!
    const source = createPreviewGpsSource()

    render(
      <MemoryRouter>
        <PreviewGpsDemoPanel route={route} routes={routes} controls={null} source={source} />
      </MemoryRouter>,
    )

    const speed = screen.getByLabelText('DEMO სიჩქარე') as HTMLSelectElement
    const scale = screen.getByLabelText('DEMO სწრაფი რეჟიმი') as HTMLSelectElement

    expect(speed.value).toBe(String(DEFAULT_DEMO_SPEED_KMH))
    expect(scale.value).toBe(String(DEFAULT_DEMO_TIME_SCALE))
    expect([...speed.options].map((option) => Number(option.value))).toEqual([
      ...DEMO_SPEED_KMH_OPTIONS,
    ])
    expect([...scale.options].map((option) => Number(option.value))).toEqual([
      ...DEMO_TIME_SCALE_OPTIONS,
    ])

    fireEvent.change(speed, { target: { value: '200' } })
    fireEvent.change(scale, { target: { value: '10' } })
    expect(speed.value).toBe('200')
    expect(scale.value).toBe('10')

    expect(screen.getByRole('button', { name: 'PAUSE' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'RESUME' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'PLAY' })).toBeEnabled()
  })
})
