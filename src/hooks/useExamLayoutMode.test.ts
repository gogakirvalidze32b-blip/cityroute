import { describe, expect, it } from 'vitest'
import { detectExamLayoutMode } from '@/hooks/useExamLayoutMode'

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

describe('detectExamLayoutMode', () => {
  it('keeps wide desktop as laptop so Android panel CSS does not apply there', () => {
    setViewport(1440, 900)
    expect(detectExamLayoutMode()).toBe('laptop')
  })

  it('treats typical Android car monitors as tablet or mobile-landscape', () => {
    setViewport(1024, 600)
    expect(detectExamLayoutMode()).toBe('tablet')
    setViewport(800, 480)
    expect(detectExamLayoutMode()).toBe('mobile-landscape')
  })
})
