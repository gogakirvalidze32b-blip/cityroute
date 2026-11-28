// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearActiveExam,
  loadActiveExam,
  saveActiveExam,
} from '@/lib/exam-persistence'
import { createExamSession } from '@/lib/exam-session'
import { getDeviceFingerprint, getExamTabId } from '@/lib/device'

function examState(routeId: string, label: string) {
  return {
    routeId,
    routeSlug: routeId,
    routeName: label,
    phase: 'active' as const,
    exam: createExamSession(routeId, label),
    userPos: [41.9, 45.4] as [number, number],
    heading: 90,
    speedKmh: 30,
    elapsedMs: 12_000,
    triggeredPins: [`${label}-pin`],
    triggeredSortOrders: [1],
    savedAt: Date.now(),
  }
}

describe('multi-device local isolation', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('keeps fingerprint and exam tab ids stable within one browser context', () => {
    const fingerprint = getDeviceFingerprint()
    expect(fingerprint.length).toBeGreaterThanOrEqual(8)
    expect(getDeviceFingerprint()).toBe(fingerprint)

    const tabId = getExamTabId()
    expect(tabId.length).toBeGreaterThanOrEqual(8)
    expect(getExamTabId()).toBe(tabId)
  })

  it('does not cross localStorage exam progress between device scopes', () => {
    const deviceA = 'user:u1:device:phone-a:tab:tab-a'
    const deviceB = 'user:u1:device:phone-b:tab:tab-b'

    saveActiveExam(examState('route-1', 'Device A exam'), {}, deviceA)
    saveActiveExam(examState('route-1', 'Device B exam'), {}, deviceB)

    expect(loadActiveExam('route-1', 'route-1', 'Device A exam', deviceA)?.routeName).toBe('Device A exam')
    expect(loadActiveExam('route-1', 'route-1', 'Device B exam', deviceB)?.routeName).toBe('Device B exam')
    expect(loadActiveExam('route-1', 'route-1', 'Device A exam', deviceB)?.routeName).not.toBe('Device A exam')

    clearActiveExam('route-1', 'route-1', 'Device A exam', deviceA)
    expect(loadActiveExam('route-1', 'route-1', 'Device A exam', deviceA)).toBeNull()
    expect(loadActiveExam('route-1', 'route-1', 'Device B exam', deviceB)?.routeName).toBe('Device B exam')
  })
})
