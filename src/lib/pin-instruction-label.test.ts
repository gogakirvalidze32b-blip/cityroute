import { describe, expect, it } from 'vitest'
import { formatPinInstructionLabel } from '@/lib/pin-instruction-label'

describe('formatPinInstructionLabel', () => {
  it('prefixes the instruction with PIN number for instructors', () => {
    expect(formatPinInstructionLabel(21, 'გთხოვთ იმოძრაოთ პირდაპირ')).toBe(
      'PIN 21 — გთხოვთ იმოძრაოთ პირდაპირ',
    )
  })

  it('does not double-prefix an already labeled instruction', () => {
    expect(formatPinInstructionLabel(7, 'PIN 7 — მალე, მარჯვნივ')).toBe('PIN 7 — მალე, მარჯვნივ')
  })

  it('still returns PIN N when instruction is empty', () => {
    expect(formatPinInstructionLabel(3, '  ')).toBe('PIN 3')
  })
})
