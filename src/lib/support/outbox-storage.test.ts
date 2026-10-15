import { beforeEach, describe, expect, it } from 'vitest'
import { addToOutbox, loadDraft, loadOutbox, removeFromOutbox, saveDraft } from './outbox-storage'

beforeEach(() => localStorage.clear())

describe('outbox', () => {
  it('stores, de-duplicates and removes entries per user', () => {
    const e = { clientId: 'a', conversationId: 'c', body: 'hi', createdAt: '2026-10-15T10:00:00Z' }
    addToOutbox('u1', e)
    addToOutbox('u1', e)
    expect(loadOutbox('u1')).toHaveLength(1)
    expect(loadOutbox('u2')).toHaveLength(0)
    removeFromOutbox('u1', 'a')
    expect(loadOutbox('u1')).toHaveLength(0)
  })
  it('survives corrupt storage content', () => {
    localStorage.setItem('cityroute-support-outbox-u1', '{not json')
    expect(loadOutbox('u1')).toEqual([])
    localStorage.setItem('cityroute-support-outbox-u1', JSON.stringify([{ nope: 1 }, 5]))
    expect(loadOutbox('u1')).toEqual([])
  })
  it('keeps and clears the draft', () => {
    saveDraft('u1', 'draft text')
    expect(loadDraft('u1')).toBe('draft text')
    saveDraft('u1', '')
    expect(loadDraft('u1')).toBe('')
  })
})
