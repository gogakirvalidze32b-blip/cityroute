import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { resolveExamResume } from './route-resume'

describe('route resume preserves the next PIN identity', () => {
  it('resolves every fallback-route PIN to the same active ID after saving progress', () => {
    let checked = 0

    for (const route of TELAVI_ROUTES_FALLBACK.filter((item) =>
      /^route-[1-4]$/.test(item.slug),
    )) {
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      for (const selected of pins) {
        const handled = pins.filter((pin) => pin.sort_order < selected.sort_order)
        const result = resolveExamResume(
          {
            triggeredPins: handled.map((pin) => pin.id),
            triggeredSortOrders: handled.map((pin) => pin.sort_order),
            lastPassedSortOrder:
              handled.length > 0 ? handled[handled.length - 1]?.sort_order ?? null : null,
            nextSortOrder: selected.sort_order,
            nextPinId: selected.id,
          },
          pins,
          route.slug,
        )

        expect(result.status, `${route.slug} PIN ${selected.sort_order}`).toBe('resume')
        if (result.status !== 'resume') continue
        expect(result.nextSortOrder).toBe(selected.sort_order)
        expect(result.nextPinId).toBe(selected.id)
        expect(result.triggeredIds).toEqual(handled.map((pin) => pin.id))
        checked += 1
      }
    }

    expect(checked).toBe(127)
  })

  it('re-derives a current ID when saved IDs came from another route source', () => {
    const pins = [
      { id: 'remote-1', sort_order: 1 },
      { id: 'remote-2', sort_order: 2 },
      { id: 'remote-3', sort_order: 3 },
    ]
    const result = resolveExamResume(
      {
        triggeredPins: ['p1-1', 'p1-2'],
        triggeredSortOrders: [1, 2],
        lastPassedSortOrder: 2,
        nextSortOrder: 3,
        nextPinId: 'p1-3',
      },
      pins,
      'route-1',
    )

    expect(result.status).toBe('resume')
    if (result.status === 'resume') {
      expect(result.nextSortOrder).toBe(3)
      expect(result.nextPinId).toBe('remote-3')
      expect(result.triggeredIds).toEqual(['remote-1', 'remote-2'])
    }
  })

  it('rejects a saved active ID that contradicts its saved progress order', () => {
    const result = resolveExamResume(
      {
        triggeredPins: ['p1-1'],
        triggeredSortOrders: [1],
        lastPassedSortOrder: 1,
        nextSortOrder: 2,
        nextPinId: 'p1-3',
      },
      [
        { id: 'p1-1', sort_order: 1 },
        { id: 'p1-2', sort_order: 2 },
        { id: 'p1-3', sort_order: 3 },
      ],
      'route-1',
    )

    expect(result.status).toBe('error')
  })
})
