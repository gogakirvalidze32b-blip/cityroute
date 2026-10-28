import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentButton } from './PaymentButton'

const state = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  onError: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}))

describe('BOG payment request retries', () => {
  beforeEach(() => {
    state.fetch.mockReset()
    state.fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Temporary failure' }), { status: 503 }),
    )
    state.onError.mockClear()
    window.sessionStorage.clear()
    vi.stubGlobal('fetch', state.fetch)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reuses the request ID across retries and changes it when the selected package changes', async () => {
    const { rerender } = render(<PaymentButton deviceSlots={1} onError={state.onError} />)

    fireEvent.click(screen.getByRole('button', { name: /გადახდა BOG-ით/ }))
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1))
    const firstId = JSON.parse(String(state.fetch.mock.calls[0]?.[1]?.body)).requestId

    fireEvent.click(screen.getByRole('button', { name: /გადახდა BOG-ით/ }))
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2))
    const retryId = JSON.parse(String(state.fetch.mock.calls[1]?.[1]?.body)).requestId
    expect(retryId).toBe(firstId)

    rerender(<PaymentButton deviceSlots={2} onError={state.onError} />)
    fireEvent.click(screen.getByRole('button', { name: /გადახდა BOG-ით/ }))
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3))
    const secondPackageId = JSON.parse(String(state.fetch.mock.calls[2]?.[1]?.body)).requestId
    expect(secondPackageId).not.toBe(firstId)
  })
})
