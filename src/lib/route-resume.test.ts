import { describe, expect, it } from 'vitest'
import { resolveExamResume, resolvePinProgress } from './route-resume'

const pins = Array.from({ length: 8 }, (_, index) => ({
  id: `p2-${index + 1}`,
  sort_order: index + 1,
}))
const route3Pins = [
  ...Array.from({ length: 11 }, (_, index) => ({ id: `p3-${index + 1}`, sort_order: index + 1 })),
  { id: 'p3-13', sort_order: 13 },
  { id: 'p3-14', sort_order: 14 },
]

describe('shared PIN resume resolver', () => {
  it('resumes at an incomplete PIN', () => {
    const resolution = resolvePinProgress(pins, [1, 2, 3, 4])
    expect(resolution).toMatchObject({
      status: 'resume',
      handledOrders: [1, 2, 3, 4],
      lastPassedSortOrder: 4,
      nextSortOrder: 5,
    })
  })

  it('advances past a completed PIN', () => {
    const resolution = resolveExamResume(
      { triggeredPins: ['p2-1', 'p2-2', 'p2-3', 'p2-4', 'p2-5'] },
      pins,
      'route-2',
    )
    expect(resolution).toMatchObject({
      status: 'resume',
      lastPassedSortOrder: 5,
      nextSortOrder: 6,
    })
  })

  it('preserves completed state without falling back to PIN 1', () => {
    const resolution = resolvePinProgress(pins, pins.map((pin) => pin.sort_order))
    expect(resolution).toMatchObject({
      status: 'resume',
      handledOrders: pins.map((pin) => pin.sort_order),
      lastPassedSortOrder: 8,
      nextSortOrder: null,
    })
  })

  it('rejects gaps and unknown PIN orders instead of guessing', () => {
    expect(resolvePinProgress(pins, [1, 2, 4])).toMatchObject({ status: 'error' })
    expect(resolvePinProgress(pins, [1, 9])).toMatchObject({ status: 'error' })
  })

  it('maps local route ids and Supabase ids by the same sort-order resolver', () => {
    const local = resolveExamResume(
      { triggeredPins: ['p2-1', 'p2-2', 'p2-3', 'p2-4'] },
      pins,
      'route-2',
    )
    const supabase = resolveExamResume(
      { triggeredPins: ['supabase-pin-1', 'supabase-pin-2', 'supabase-pin-3', 'supabase-pin-4'], triggeredSortOrders: [1, 2, 3, 4] },
      pins.map((pin, index) => ({ ...pin, id: `supabase-pin-${index + 1}` })),
      'route-2',
    )
    expect(local).toMatchObject({ status: 'resume', nextSortOrder: 5 })
    expect(supabase).toMatchObject({ status: 'resume', nextSortOrder: 5 })
  })

  it('resumes Route 3 at PIN 13 after removing PIN 12, including legacy saved progress', () => {
    const orders = Array.from({ length: 12 }, (_, index) => index + 1)
    const resolution = resolveExamResume(
      {
        triggeredPins: orders.map((order) => `p3-${order}`),
        triggeredSortOrders: orders,
        lastPassedSortOrder: 12,
        nextSortOrder: 13,
      },
      route3Pins,
      'route-3',
    )

    expect(resolution).toMatchObject({
      status: 'resume',
      handledOrders: Array.from({ length: 11 }, (_, index) => index + 1),
      lastPassedSortOrder: 11,
      nextSortOrder: 13,
    })
  })

  it('maps a legacy saved Route 3 next PIN 12 to the next active PIN 13', () => {
    const resolution = resolveExamResume(
      {
        triggeredPins: Array.from({ length: 11 }, (_, index) => `p3-${index + 1}`),
        triggeredSortOrders: Array.from({ length: 11 }, (_, index) => index + 1),
        lastPassedSortOrder: 11,
        nextSortOrder: 12,
      },
      route3Pins,
      'route-3',
    )

    expect(resolution).toMatchObject({
      status: 'resume',
      lastPassedSortOrder: 11,
      nextSortOrder: 13,
    })
  })
})
