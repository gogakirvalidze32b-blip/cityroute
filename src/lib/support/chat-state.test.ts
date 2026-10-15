import { describe, expect, it } from 'vitest'
import {
  applyServerMessage,
  hasUnreadFrom,
  makePendingItem,
  markFailed,
  markReadLocally,
  markSending,
  pathsNeedingUrls,
  removeByClientId,
} from './chat-state'
import type { SupportMessageRow } from './types'

const msg = (over: Partial<SupportMessageRow> = {}): SupportMessageRow => ({
  id: 'srv-1',
  conversation_id: 'c1',
  sender_id: 'u1',
  sender_type: 'user',
  body: 'hello',
  client_id: 'cid-1',
  read_at: null,
  created_at: '2026-10-15T10:00:00Z',
  ...over,
})
const pending = (clientId = 'cid-1') =>
  makePendingItem({ clientId, senderType: 'user', body: 'hello', createdAt: '2026-10-15T09:59:59Z', attachments: [] })

describe('no duplicates', () => {
  it('RPC response + Realtime echo + polling of the same message give ONE item', () => {
    let items = [pending()]
    items = applyServerMessage(items, msg(), []) // RPC result
    items = applyServerMessage(items, msg(), []) // realtime INSERT echo
    items = applyServerMessage(items, msg(), []) // polling
    expect(items).toHaveLength(1)
    expect(items[0].delivery).toBe('sent')
    expect(items[0].id).toBe('srv-1')
  })
  it('Realtime echo arriving BEFORE the RPC response still merges into the pending bubble', () => {
    let items = [pending()]
    items = applyServerMessage(items, msg(), [])
    expect(items).toHaveLength(1)
    expect(items[0].key).toBe('cid-1') // stable key, bubble not re-mounted
  })
  it('messages from the other party are added once', () => {
    const adminMsg = msg({ id: 'srv-2', sender_type: 'admin', client_id: null, created_at: '2026-10-15T10:01:00Z' })
    let items = applyServerMessage([], adminMsg, [])
    items = applyServerMessage(items, adminMsg, [])
    expect(items).toHaveLength(1)
  })
})

describe('delivery state', () => {
  it('a message is "sending" until the server confirms it', () => {
    expect(pending().delivery).toBe('sending')
  })
  it('a late network error cannot flip a confirmed message back to failed', () => {
    let items = applyServerMessage([pending()], msg(), [])
    items = markFailed(items, 'cid-1', 'network')
    expect(items[0].delivery).toBe('sent')
  })
  it('failed → retry → sending', () => {
    let items = markFailed([pending()], 'cid-1', 'x')
    expect(items[0].delivery).toBe('failed')
    items = markSending(items, 'cid-1')
    expect(items[0].delivery).toBe('sending')
  })
  it('discard removes only unconfirmed items', () => {
    const sent = applyServerMessage([pending()], msg(), [])
    expect(removeByClientId(sent, 'cid-1')).toHaveLength(1)
    expect(removeByClientId([pending()], 'cid-1')).toHaveLength(0)
  })
  it('pending bubbles stay below confirmed ones', () => {
    const adminMsg = msg({ id: 'srv-9', sender_type: 'admin', client_id: null, created_at: '2026-10-15T10:05:00Z' })
    const items = applyServerMessage([pending('later')], adminMsg, [])
    expect(items.map((i) => i.delivery)).toEqual(['sent', 'sending'])
  })
})

describe('read receipts', () => {
  it('tracks unread messages per sender and clears them locally', () => {
    const items = applyServerMessage([], msg({ sender_type: 'admin', client_id: null }), [])
    expect(hasUnreadFrom(items, 'admin')).toBe(true)
    expect(hasUnreadFrom(items, 'user')).toBe(false)
    expect(hasUnreadFrom(markReadLocally(items, 'admin', '2026-10-15T11:00:00Z'), 'admin')).toBe(false)
  })
  it('an UPDATE event (read_at set) keeps existing attachments', () => {
    const att = { id: 'a1', message_id: 'srv-1', conversation_id: 'c1', storage_path: 'c1/x.png', mime_type: 'image/png', size_bytes: 5, created_at: '2026-10-15T10:00:00Z' }
    let items = applyServerMessage([], msg(), [att])
    items = applyServerMessage(items, msg({ read_at: '2026-10-15T10:02:00Z' }))
    expect(items[0].readAt).toBe('2026-10-15T10:02:00Z')
    expect(items[0].attachments).toHaveLength(1)
  })
})

describe('signed URL bookkeeping', () => {
  it('asks only for paths that have no URL yet', () => {
    const att = { id: 'a1', message_id: 'srv-1', conversation_id: 'c1', storage_path: 'c1/x.png', mime_type: 'image/png', size_bytes: 5, created_at: '2026-10-15T10:00:00Z' }
    const items = applyServerMessage([], msg(), [att])
    expect(pathsNeedingUrls(items, new Map())).toEqual(['c1/x.png'])
    expect(pathsNeedingUrls(items, new Map([['c1/x.png', 'https://signed']]))).toEqual([])
  })
})
