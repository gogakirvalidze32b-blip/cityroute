import { describe, expect, it, vi } from 'vitest'
import { newUploadPath, putWithProgress, UploadError } from './upload'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

describe('newUploadPath', () => {
  it('has the shape the storage policy + RPC require', () => {
    const conv = '11111111-1111-4111-8111-111111111111'
    for (const [mime, ext] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']] as const) {
      const p = newUploadPath(conv, mime)
      expect(p).toMatch(new RegExp(`^${conv}/${UUID}\\.${ext}$`))
    }
  })
  it('is unique per call', () => {
    const a = newUploadPath('c', 'image/png')
    expect(a).not.toBe(newUploadPath('c', 'image/png'))
  })
})

function fakeXhr(outcome: 'ok' | 'fail403' | 'network' | 'timeout', progress: [number, number][] = []) {
  const x: any = {
    upload: {} as any,
    headers: {} as Record<string, string>,
    open: vi.fn(),
    setRequestHeader(k: string, v: string) { x.headers[k] = v },
    abort: vi.fn(() => x.onabort?.()),
    send() {
      queueMicrotask(() => {
        for (const [l, t] of progress) x.upload.onprogress?.({ lengthComputable: true, loaded: l, total: t })
        if (outcome === 'ok') { x.status = 200; x.onload?.() }
        else if (outcome === 'fail403') { x.status = 403; x.onload?.() }
        else if (outcome === 'network') x.onerror?.()
        else x.ontimeout?.()
      })
    },
  }
  return x as XMLHttpRequest & { headers: Record<string, string> }
}

describe('putWithProgress', () => {
  it('reports progress and resolves on 2xx, sending the auth headers', async () => {
    const xhr = fakeXhr('ok', [[50, 100], [100, 100]])
    const seen: number[] = []
    await putWithProgress('https://x/upload', new FormData(), {
      headers: { Authorization: 'Bearer t', apikey: 'k' },
      onProgress: (f) => seen.push(f),
      xhrFactory: () => xhr,
    })
    expect(seen[0]).toBe(0.5)
    expect(seen.at(-1)).toBe(1)
    expect(xhr.headers.Authorization).toBe('Bearer t')
  })
  it('rejects with kind=rejected on 403', async () => {
    await expect(putWithProgress('u', new FormData(), { headers: {}, xhrFactory: () => fakeXhr('fail403') })).rejects.toMatchObject({ kind: 'rejected', status: 403 })
  })
  it('rejects with kind=network on connection error and on timeout', async () => {
    await expect(putWithProgress('u', new FormData(), { headers: {}, xhrFactory: () => fakeXhr('network') })).rejects.toBeInstanceOf(UploadError)
    await expect(putWithProgress('u', new FormData(), { headers: {}, xhrFactory: () => fakeXhr('timeout') })).rejects.toMatchObject({ kind: 'network' })
  })
  it('honours an already-aborted signal', async () => {
    const ac = new AbortController(); ac.abort()
    await expect(putWithProgress('u', new FormData(), { headers: {}, signal: ac.signal, xhrFactory: () => fakeXhr('ok') })).rejects.toMatchObject({ kind: 'aborted' })
  })
})
