import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  fetchMessages: vi.fn(),
  fetchAttachmentsFor: vi.fn(),
  sendMessage: vi.fn(),
  markRead: vi.fn(),
  subscribeToThread: vi.fn(),
  triggerEmailNotifications: vi.fn(),
  db: vi.fn(() => ({})),
  toSupportError: (e: any) => ({ userMessage: 'ERR:' + (e?.message ?? e), transient: true, code: 'network' }),
}))
vi.mock('./api', () => api)
const up = vi.hoisted(() => ({ uploadSupportImage: vi.fn() }))
vi.mock('./upload', async (orig) => ({ ...(await orig<typeof import('./upload')>()), ...up }))

import { useSupportThread } from './useSupportThread'

const row = (o: any = {}) => ({
  id: 'srv-' + (o.client_id ?? 'x'), conversation_id: 'c1', sender_id: 'u1', sender_type: 'user',
  body: 'hi', client_id: null, read_at: null, created_at: new Date().toISOString(), ...o,
})

let realtime: (r: any, e: 'INSERT' | 'UPDATE') => void

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  api.fetchMessages.mockResolvedValue({ messages: [], attachments: {}, hasMore: false })
  api.fetchAttachmentsFor.mockResolvedValue({})
  api.markRead.mockResolvedValue(undefined)
  api.subscribeToThread.mockImplementation((_id: string, cb: any) => { realtime = cb; return () => undefined })
})

const setup = (viewer: 'user' | 'admin' = 'user') =>
  renderHook(() => useSupportThread({ conversationId: 'c1', viewer, userId: viewer === 'user' ? 'u1' : null }))

describe('useSupportThread — sending', () => {
  it('shows "sending" first and "sent" only after the server confirms', async () => {
    let resolve!: (v: any) => void
    api.sendMessage.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { expect(result.current.send({ body: 'hello', images: [] })).toBeNull() })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].delivery).toBe('sending')

    const clientId = result.current.items[0].clientId!
    await act(async () => { resolve({ message: row({ client_id: clientId, body: 'hello' }), attachments: [], deduplicated: false }) })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].delivery).toBe('sent')
    expect(api.triggerEmailNotifications).toHaveBeenCalledTimes(1)
  })

  it('network failure → "failed", text kept; retry reuses the SAME client id (idempotent)', async () => {
    api.sendMessage.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => { result.current.send({ body: 'important text', images: [] }) })
    await waitFor(() => expect(result.current.items[0].delivery).toBe('failed'))
    expect(result.current.items[0].body).toBe('important text')
    const clientId = result.current.items[0].clientId!

    api.sendMessage.mockImplementationOnce(async (a: any) => ({ message: row({ client_id: a.clientId, body: a.body }), attachments: [], deduplicated: false }))
    act(() => result.current.retry(clientId))
    await waitFor(() => expect(result.current.items[0].delivery).toBe('sent'))
    expect(api.sendMessage.mock.calls[1][0].clientId).toBe(api.sendMessage.mock.calls[0][0].clientId)
    expect(result.current.items).toHaveLength(1)
  })

  it('Realtime echo before the RPC returns does not create a duplicate bubble', async () => {
    let resolve!: (v: any) => void
    api.sendMessage.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => { result.current.send({ body: 'dup?', images: [] }) })
    const clientId = result.current.items[0].clientId!
    await act(async () => { realtime(row({ client_id: clientId, body: 'dup?' }), 'INSERT') })
    await act(async () => { resolve({ message: row({ client_id: clientId, body: 'dup?' }), attachments: [], deduplicated: false }) })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].delivery).toBe('sent')
  })

  it('text-only unsent message is restored after a reload as a failed/retry bubble', async () => {
    localStorage.setItem('cityroute-support-outbox-u1', JSON.stringify([{ clientId: 'lost-1', conversationId: 'c1', body: 'typed before crash', createdAt: new Date().toISOString() }]))
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({ body: 'typed before crash', delivery: 'failed' })
  })

  it('rejects empty and over-long messages locally', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => { expect(result.current.send({ body: '   ', images: [] })).toBeTruthy() })
    act(() => { expect(result.current.send({ body: 'x'.repeat(4001), images: [] })).toBeTruthy() })
    expect(result.current.items).toHaveLength(0)
    expect(api.sendMessage).not.toHaveBeenCalled()
  })

  it('uploads images first, sends their storage paths, and never re-uploads on retry', async () => {
    up.uploadSupportImage.mockImplementation(async (p: any) => { p.onProgress?.(1); return { path: `c1/${Math.random()}.png`, mime: p.mime, size: p.file.size } })
    api.sendMessage.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'a.png', { type: 'image/png' })
    act(() => { result.current.send({ body: '', images: [{ file, mime: 'image/png' }] }) })
    await waitFor(() => expect(result.current.items[0].delivery).toBe('failed'))
    expect(up.uploadSupportImage).toHaveBeenCalledTimes(1)

    api.sendMessage.mockImplementationOnce(async (a: any) => ({ message: row({ client_id: a.clientId, body: '' }), attachments: [], deduplicated: false }))
    act(() => result.current.retry(result.current.items[0].clientId!))
    await waitFor(() => expect(result.current.items[0].delivery).toBe('sent'))
    expect(up.uploadSupportImage).toHaveBeenCalledTimes(1) // not uploaded twice
    expect(api.sendMessage.mock.calls[1][0].attachments).toHaveLength(1)
  })

  it('admin view sends with asAdmin=true; user view with asAdmin=false', async () => {
    api.sendMessage.mockImplementation(async (a: any) => ({ message: row({ client_id: a.clientId, sender_type: a.asAdmin ? 'admin' : 'user' }), attachments: [], deduplicated: false }))
    const admin = setup('admin')
    await waitFor(() => expect(admin.result.current.loading).toBe(false))
    act(() => { admin.result.current.send({ body: 'reply', images: [] }) })
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    expect(api.sendMessage.mock.calls[0][0].asAdmin).toBe(true)
    api.sendMessage.mockClear()
    const user = setup('user')
    await waitFor(() => expect(user.result.current.loading).toBe(false))
    act(() => { user.result.current.send({ body: 'q', images: [] }) })
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    expect(api.sendMessage.mock.calls[0][0].asAdmin).toBe(false)
  })
})

describe('useSupportThread — receiving', () => {
  it('an admin reply arriving over Realtime appears without reload, and is marked read', async () => {
    const { result } = setup('user')
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { realtime(row({ id: 'a1', sender_type: 'admin', sender_id: 'adm', body: 'გამარჯობა!' }), 'INSERT') })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.items[0]).toMatchObject({ senderType: 'admin', body: 'გამარჯობა!' })
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith('c1', false))
  })

  it('admin view marks USER messages read (asAdmin=true)', async () => {
    api.fetchMessages.mockResolvedValue({ messages: [row({ id: 'm1', sender_type: 'user' })], attachments: {}, hasMore: false })
    const { result } = setup('admin')
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith('c1', true))
  })

  it('loads history and pages older messages without duplicates', async () => {
    const page1 = Array.from({ length: 2 }, (_, i) => row({ id: `n${i}`, created_at: `2026-10-15T10:0${i}:00Z` }))
    const page2 = [row({ id: 'o1', created_at: '2026-10-14T10:00:00Z' })]
    api.fetchMessages.mockResolvedValueOnce({ messages: page1, attachments: {}, hasMore: true }).mockResolvedValueOnce({ messages: page2, attachments: {}, hasMore: false })
    const { result } = setup()
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.hasMore).toBe(true)
    await act(async () => { await result.current.loadOlder() })
    expect(result.current.items.map((i) => i.id)).toEqual(['o1', 'n0', 'n1'])
    expect(result.current.hasMore).toBe(false)
    expect(api.fetchMessages.mock.calls[1][1].before).toBe('2026-10-15T10:00:00Z')
  })

  it('reports a load error with a retry path', async () => {
    api.fetchMessages.mockRejectedValueOnce(new Error('boom'))
    const { result } = setup()
    await waitFor(() => expect(result.current.loadError).toMatch(/ERR:boom/))
  })
})
