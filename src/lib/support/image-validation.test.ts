import { describe, expect, it } from 'vitest'
import { sniffImageType, validateImageFile, validateSelection } from './image-validation'

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]

function file(bytes: number[], name: string, type: string, pad = 0): File {
  return new File([new Uint8Array([...bytes, ...new Array(pad).fill(0)])], name, { type })
}

describe('sniffImageType (magic bytes)', () => {
  it('recognises jpeg, png, webp', () => {
    expect(sniffImageType(new Uint8Array(JPEG))).toBe('image/jpeg')
    expect(sniffImageType(new Uint8Array(PNG))).toBe('image/png')
    expect(sniffImageType(new Uint8Array(WEBP))).toBe('image/webp')
  })
  it('rejects gif, text, empty', () => {
    expect(sniffImageType(new Uint8Array(GIF))).toBeNull()
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImageType(new Uint8Array([]))).toBeNull()
  })
})

describe('validateImageFile', () => {
  it('accepts a real jpeg and returns the REAL type', async () => {
    const r = await validateImageFile(file(JPEG, 'a.jpg', 'image/jpeg', 100))
    expect(r).toEqual({ ok: true, mime: 'image/jpeg' })
  })
  it('does not trust the extension: a PNG named .jpg is typed as png', async () => {
    const r = await validateImageFile(file(PNG, 'photo.jpg', 'image/png', 100))
    expect(r).toEqual({ ok: true, mime: 'image/png' })
  })
  it('rejects a text/exe file renamed to .png even if the browser says image/png', async () => {
    const r = await validateImageFile(new File(['MZ not an image'], 'evil.png', { type: 'image/png' }))
    expect(r.ok).toBe(false)
  })
  it('rejects a JPEG whose reported type is something else', async () => {
    const r = await validateImageFile(file(JPEG, 'a.jpg', 'application/pdf', 100))
    expect(r.ok).toBe(false)
  })
  it.each(['image/gif', 'image/svg+xml', 'image/heic'])('rejects reported type %s', async (t) => {
    expect((await validateImageFile(file(JPEG, 'a.x', t, 10))).ok).toBe(false)
  })
  it('rejects files over 5 MB and empty files', async () => {
    const big = file(JPEG, 'big.jpg', 'image/jpeg', 5 * 1024 * 1024)
    expect((await validateImageFile(big)).ok).toBe(false)
    expect((await validateImageFile(new File([], 'e.jpg', { type: 'image/jpeg' }))).ok).toBe(false)
  })
  it('accepts exactly 5 MB', async () => {
    const f = file(JPEG, 'ok.jpg', 'image/jpeg', 5 * 1024 * 1024 - JPEG.length)
    expect(f.size).toBe(5 * 1024 * 1024)
    expect((await validateImageFile(f)).ok).toBe(true)
  })
})

describe('validateSelection', () => {
  it('limits to 5 images per message and reports the overflow', async () => {
    const files = Array.from({ length: 7 }, (_, i) => file(PNG, `p${i}.png`, 'image/png', 10))
    const r = await validateSelection(0, files)
    expect(r.accepted).toHaveLength(5)
    expect(r.errors.length).toBe(1)
  })
  it('counts already-selected images', async () => {
    const r = await validateSelection(4, [file(PNG, 'a.png', 'image/png', 10), file(PNG, 'b.png', 'image/png', 10)])
    expect(r.accepted).toHaveLength(1)
    expect(r.errors).toHaveLength(1)
  })
  it('keeps valid files and reports invalid ones', async () => {
    const r = await validateSelection(0, [file(PNG, 'a.png', 'image/png', 10), file(GIF, 'g.gif', 'image/gif', 10)])
    expect(r.accepted).toHaveLength(1)
    expect(r.errors).toHaveLength(1)
  })
})
