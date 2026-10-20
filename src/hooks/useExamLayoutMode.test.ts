import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectExamLayoutMode, useExamLayoutMode } from '@/hooks/useExamLayoutMode'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

describe('detectExamLayoutMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    [320, 568, 'mobile'],
    [360, 640, 'mobile'],
    [360, 800, 'mobile'],
    [393, 852, 'mobile'],
    [640, 360, 'mobile-landscape'],
    [800, 480, 'mobile-landscape'],
    [960, 540, 'mobile-landscape'],
    [1280, 720, 'laptop'],
    [1920, 1080, 'laptop'],
  ] as const)('classifies %i×%i viewport', (width, height, expected) => {
    setViewport(width, height)
    expect(detectExamLayoutMode()).toBe(expected)
  })

  it('uses the visible viewport when browser chrome changes the available height', () => {
    setViewport(800, 700)
    const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { width: 800, height: 480 },
    })

    expect(detectExamLayoutMode()).toBe('mobile-landscape')
    if (descriptor) Object.defineProperty(window, 'visualViewport', descriptor)
    else delete (window as Window & { visualViewport?: VisualViewport }).visualViewport
  })

  it('recalculates layout after fullscreen and visible viewport changes', () => {
    const viewport = new EventTarget() as EventTarget & { width: number; height: number }
    viewport.width = 390
    viewport.height = 844
    const viewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const mediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })

    const { result, unmount } = renderHook(() => useExamLayoutMode())
    expect(result.current).toBe('mobile')

    viewport.width = 800
    viewport.height = 480
    act(() => document.dispatchEvent(new Event('fullscreenchange')))
    expect(result.current).toBe('mobile-landscape')

    viewport.width = 640
    viewport.height = 900
    act(() => viewport.dispatchEvent(new Event('resize')))
    expect(result.current).toBe('tablet')

    unmount()
    if (viewportDescriptor) Object.defineProperty(window, 'visualViewport', viewportDescriptor)
    else delete (window as Window & { visualViewport?: VisualViewport }).visualViewport
    if (mediaDescriptor) Object.defineProperty(window, 'matchMedia', mediaDescriptor)
    else delete (window as Window & { matchMedia?: typeof window.matchMedia }).matchMedia
  })
})
