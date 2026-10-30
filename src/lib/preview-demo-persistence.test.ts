import { afterEach, describe, expect, it } from 'vitest'
import { createExamSession } from '@/lib/exam-session'
import {
  clearActiveExam,
  hasSavedExamForSlug,
  loadActiveExam,
  saveActiveExam,
} from '@/lib/exam-persistence'
import {
  clearRoutePinProgress,
  loadRoutePinProgress,
  saveRoutePinProgress,
} from '@/lib/route-pin-progress'

const DEMO_SCOPE = 'preview-demo-user'

afterEach(() => localStorage.clear())

describe('preview demo local storage scope', () => {
  it('saves and clears demo exams without reading or changing the default app save', () => {
    localStorage.setItem('cityroute-active-exam:route-1', 'production-save')
    const state = {
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      phase: 'active' as const,
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 0,
      triggeredPins: [],
      savedAt: Date.now(),
    }

    saveActiveExam(state, {}, DEMO_SCOPE)

    expect(loadActiveExam(state.routeId, state.routeSlug, state.routeName, DEMO_SCOPE)).toMatchObject({
      routeSlug: 'route-1',
    })
    expect(loadActiveExam(state.routeId, state.routeSlug, state.routeName)).toBeNull()
    expect(hasSavedExamForSlug('route-1', state.routeName, DEMO_SCOPE)).toBe(true)

    clearActiveExam(state.routeId, state.routeSlug, state.routeName, DEMO_SCOPE)

    expect(loadActiveExam(state.routeId, state.routeSlug, state.routeName, DEMO_SCOPE)).toBeNull()
    expect(localStorage.getItem('cityroute-active-exam:route-1')).toBe('production-save')
  })

  it('keeps demo PIN progress independent from default route progress', () => {
    saveRoutePinProgress('route-2', [1, 2], DEMO_SCOPE)

    expect(loadRoutePinProgress('route-2', DEMO_SCOPE)).toEqual([1, 2])
    expect(loadRoutePinProgress('route-2')).toBeNull()

    clearRoutePinProgress('route-2', DEMO_SCOPE)

    expect(loadRoutePinProgress('route-2', DEMO_SCOPE)).toBeNull()
  })
})
