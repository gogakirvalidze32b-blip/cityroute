import { describe, expect, it, vi } from 'vitest'
import { createPreviewGpsSource } from './preview-gps-source'

describe('isolated Preview GPS source', () => {
  it('clears the current fix without removing active watchers', async () => {
    const source = createPreviewGpsSource()
    const onUpdate = vi.fn()
    const unsubscribe = source.watchPosition(onUpdate)
    const firstFix = {
      lat: 41.9,
      lng: 45.4,
      accuracy: 5,
      heading: 90,
      speed: 0,
      timestamp: 1,
    }

    source.publish(firstFix)
    source.clear()

    await expect(source.getCurrentPosition()).rejects.toThrow('DEMO GPS has no starting fix')

    const secondFix = { ...firstFix, lng: 45.5, timestamp: 2 }
    source.publish(secondFix)

    expect(onUpdate).toHaveBeenNthCalledWith(1, firstFix)
    expect(onUpdate).toHaveBeenNthCalledWith(2, secondFix)
    unsubscribe()
  })
})
