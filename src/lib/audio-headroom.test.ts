import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VOICE_GAIN, VOICE_PITCH, VOICE_PLAYBACK_RATE, VOICE_VOLUME } from '@/lib/audio'

function wavFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...wavFiles(path))
    else if (name.toLowerCase().endsWith('.wav')) out.push(path)
  }
  return out
}

function peakSample(file: string): number {
  const bytes = readFileSync(file)
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`not a wav: ${file}`)
  let offset = 12
  let dataOffset = -1
  let dataLength = 0
  let bits = 16
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    if (id === 'fmt ') bits = bytes.readUInt16LE(offset + 22)
    if (id === 'data') {
      dataOffset = offset + 8
      dataLength = size
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (dataOffset < 0) throw new Error(`no samples: ${file}`)
  let peak = 0
  if (bits === 16) {
    const count = Math.floor(dataLength / 2)
    for (let i = 0; i < count; i++) peak = Math.max(peak, Math.abs(bytes.readInt16LE(dataOffset + i * 2)))
    return peak / 32768
  }
  throw new Error(`unsupported wav depth ${bits}: ${file}`)
}

describe('voice gain headroom', () => {
  it('keeps media volume at 1, gain at 1.0, pitch and speed unchanged', () => {
    expect(VOICE_VOLUME).toBe(1)
    expect(VOICE_GAIN).toBe(1)
    expect(VOICE_PITCH).toBe('normal')
    expect(VOICE_PLAYBACK_RATE).toBe(1)
  })

  it('HTML media volume rejects values above 1 (so volume=1.3 is not usable)', () => {
    const audio = new Audio()
    expect(() => {
      audio.volume = 1.3
    }).toThrow()
    audio.volume = 1
    expect(audio.volume).toBe(1)
  })

  it('every bundled voice WAV stays at or below full scale at current gain', () => {
    const files = wavFiles(join(process.cwd(), 'public', 'audio'))
    expect(files.length).toBeGreaterThan(0)
    const clipped = files
      .map((file) => ({ file, peak: peakSample(file) }))
      .filter((item) => item.peak * VOICE_GAIN > 1)
    expect(clipped).toEqual([])
  })
})
