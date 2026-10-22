import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VOICE_GAIN, VOICE_PITCH, VOICE_PLAYBACK_RATE, VOICE_VOLUME } from '@/lib/audio'
import {
  safeVoiceGain,
  VOICE_LEVELS_BY_FILE,
  VOICE_PEAK_CEILING_DBFS,
} from '@/lib/audio-normalization'

function wavFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...wavFiles(path))
    else if (name.toLowerCase().endsWith('.wav')) out.push(path)
  }
  return out
}

function wavLevels(file: string): { activeRmsDbfs: number; peakDbfs: number } {
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
  let activeSquares = 0
  let activeCount = 0
  if (bits === 16) {
    const count = Math.floor(dataLength / 2)
    const samples = new Int16Array(count)
    for (let i = 0; i < count; i++) {
      samples[i] = bytes.readInt16LE(dataOffset + i * 2)
      peak = Math.max(peak, Math.abs(samples[i]!))
    }
    const sampleRate = bytes.readUInt32LE(24)
    const windowSize = Math.round(sampleRate * 0.02)
    const gate = 10 ** (-50 / 20) * 32768
    for (let start = 0; start < samples.length; start += windowSize) {
      const end = Math.min(samples.length, start + windowSize)
      let squares = 0
      for (let i = start; i < end; i++) squares += samples[i]! * samples[i]!
      const length = end - start
      if (length > 0 && Math.sqrt(squares / length) > gate) {
        activeSquares += squares
        activeCount += length
      }
    }
    const toDbfs = (linear: number) => (linear > 0 ? 20 * Math.log10(linear / 32768) : -Infinity)
    return {
      activeRmsDbfs: toDbfs(Math.sqrt(activeSquares / activeCount)),
      peakDbfs: toDbfs(peak),
    }
  }
  throw new Error(`unsupported wav depth ${bits}: ${file}`)
}

describe('voice gain headroom', () => {
  it('keeps media volume at 1, fallback gain at 2, pitch and speed unchanged', () => {
    expect(VOICE_VOLUME).toBe(1)
    expect(VOICE_GAIN).toBe(2)
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

  it('boosts every bundled voice WAV by 2x without clipping or changing source files', () => {
    const files = wavFiles(join(process.cwd(), 'public', 'audio'))
    expect(files.length).toBeGreaterThan(0)
    const profiles = files.map((file) => {
      const levels = wavLevels(file)
      const filename = file.split(/[\\/]/).pop()!
      const profile = VOICE_LEVELS_BY_FILE[filename]
      expect(profile, `missing normalization profile for ${filename}`).toBeDefined()
      expect(profile!.activeRmsDbfs).toBeCloseTo(levels.activeRmsDbfs, 1)
      expect(profile!.peakDbfs).toBeCloseTo(levels.peakDbfs, 1)
      const gain = safeVoiceGain(`/audio/${filename}`, VOICE_GAIN)
      expect(gain).toBe(2)
      const amplifiedPeakDbfs =
        levels.peakDbfs + 20 * Math.log10(gain)
      expect(amplifiedPeakDbfs).toBeLessThanOrEqual(VOICE_PEAK_CEILING_DBFS + 0.05)
      return levels.activeRmsDbfs + 20 * Math.log10(gain)
    })
    expect(Object.keys(VOICE_LEVELS_BY_FILE)).toHaveLength(files.length)
    expect(Math.max(...profiles) - Math.min(...profiles)).toBeLessThan(4.5)
  })
})
