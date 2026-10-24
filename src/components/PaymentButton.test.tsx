import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentButton } from './PaymentButton'

const h = vi.hoisted(() => ({
  invoke: vi.fn(async (_name: string, _options: { body: Record<string, unknown> }) => ({
    data: null,
    error: new Error('Temporary failure'),
  })),
  onError: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'test-user' } } } }),
    },
    functions: { invoke: h.invoke },
  }),
}))

describe('BOG payment button retries', () => {
  beforeEach(() => {
    h.invoke.mockReset()
    h.invoke.mockResolvedValue({ data: null, error: new Error('Temporary failure') })
    h.onError.mockClear()
    window.sessionStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reuses the same request ID for a retry and creates a new one when the package changes', async () => {
    const user = userEvent.setup()
    const { rerender, unmount } = render(<PaymentButton deviceSlots={1} onError={h.onError} />)

    await user.click(screen.getByRole('button', { name: /გადახდა/ }))
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1))
    const firstRequestId = h.invoke.mock.calls[0][1]?.body.requestId

    await user.click(screen.getByRole('button', { name: /გადახდა/ }))
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2))
    const retryRequestId = h.invoke.mock.calls[1][1]?.body.requestId
    expect(retryRequestId).toBe(firstRequestId)

    rerender(<PaymentButton deviceSlots={2} onError={h.onError} />)
    await user.click(screen.getByRole('button', { name: /გადახდა/ }))
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(3))
    expect(h.invoke.mock.calls[2][1]?.body.requestId).not.toBe(firstRequestId)

    unmount()
    render(<PaymentButton deviceSlots={1} onError={h.onError} />)
    await user.click(screen.getByRole('button', { name: /გადახდა/ }))
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(4))
    expect(h.invoke.mock.calls[3][1]?.body.requestId).toBe(firstRequestId)
  })
})
