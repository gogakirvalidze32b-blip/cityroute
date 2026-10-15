import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioEngine, VOICE_GAIN, VOICE_PLAYBACK_RATE, VOICE_PITCH, VOICE_VOLUME } from '@/lib/audio'

class FakeAudio {
  src = ''
  currentTime = 0
  volume = 1
  playbackRate = 1
  preservesPitch = true
  webkitPreservesPitch = true
  preload = 'none'
  readyState = 0
  paused = true
  ended = false
  private listeners = new Map<string, Set<() => void>>()

  static plays: string[] = []
  static failNext = false

  load() {
    this.readyState = 1
  }

  play() {
    if (FakeAudio.failNext) {
      FakeAudio.failNext = false
      return Promise.reject(new Error('NotAllowedError'))
    }
    FakeAudio.plays.push(this.src)
    this.paused = false
    this.ended = false
    return Promise.resolve()
  }

  pause() {
    this.paused = true
  }

  addEventListener(type: string, fn: () => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(fn)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn)
  }

  dispatch(type: string) {
    if (type === 'ended') this.ended = true
    for (const fn of this.listeners.get(type) ?? []) fn()
  }
}

describe('audio queue', () => {
  const OriginalAudio = globalThis.Audio

  afterEach(() => {
    globalThis.Audio = OriginalAudio
    FakeAudio.plays = []
    FakeAudio.failNext = false
    vi.restoreAllMocks()
  })

  function engine() {
    globalThis.Audio = FakeAudio as unknown as typeof Audio
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: undefined,
    })
    return new AudioEngine()
  }

  it('plays every voice clip at 1.0x and keeps the original pitch', async () => {
    expect(VOICE_PLAYBACK_RATE).toBe(1)
    expect(VOICE_PITCH).toBe('mid')
    expect(VOICE_VOLUME).toBe(1)
    expect(VOICE_GAIN).toBe(1.3)

    const playback = engine()
    const instances: FakeAudio[] = []
    globalThis.Audio = class extends FakeAudio {
      constructor() {
        super()
        instances.push(this)
      }
    } as unknown as typeof Audio

    await playback.play('/a.wav', 'pin-1', 'ა')
    expect(instances).toHaveLength(1)
    expect(instances[0].playbackRate).toBe(1)
    expect(instances[0].preservesPitch).toBe(true)
    expect(instances[0].webkitPreservesPitch).toBe(true)
    expect(instances[0].volume).toBe(1)
    expect(FakeAudio.plays).toEqual(['/a.wav'])
  })

  it('plays the next clip only after the previous one ends', async () => {
    const playback = engine()
    const instances: FakeAudio[] = []
    globalThis.Audio = class extends FakeAudio {
      constructor() {
        super()
        instances.push(this)
      }
    } as unknown as typeof Audio

    const first = playback.play('/a.wav', 'pin-1', 'a')
    const second = playback.play('/b.wav', 'pin-2', 'b')
    await Promise.resolve()
    await first
    expect(FakeAudio.plays).toEqual(['/a.wav'])

    instances[0].dispatch('ended')
    await second
    expect(FakeAudio.plays).toEqual(['/a.wav', '/b.wav'])
  })

  it('does not count a missing recording as played when speech cannot start', async () => {
    const playback = engine()
    await expect(playback.play(null, 'pin-missing', 'გთხოვთ, მოუხვიოთ მარჯვნივ')).resolves.toBe(false)
  })

  it('returns false when playback fails and allows one later retry', async () => {
    const playback = engine()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    FakeAudio.failNext = true
    await expect(playback.play('/a.wav', 'pin-1', 'მარცხნივ')).resolves.toBe(false)
    expect(error).toHaveBeenCalled()
    expect(FakeAudio.plays).toEqual([])

    await expect(playback.play('/a.wav', 'pin-1', 'მარცხნივ')).resolves.toBe(true)
    expect(FakeAudio.plays).toEqual(['/a.wav'])
  })

  it('does not start the same pin twice while it is queued', async () => {
    const playback = engine()
    const first = playback.play('/a.wav', 'pin-1', 'a')
    await expect(playback.play('/a.wav', 'pin-1', 'a')).resolves.toBe(false)
    await first
    expect(FakeAudio.plays).toEqual(['/a.wav'])
  })

  it('drops queued clips on stop and still plays a later one', async () => {
    const playback = engine()
    const instances: FakeAudio[] = []
    globalThis.Audio = class extends FakeAudio {
      constructor() {
        super()
        instances.push(this)
      }
    } as unknown as typeof Audio

    const first = playback.play('/a.wav', 'pin-1', 'a')
    const second = playback.play('/b.wav', 'pin-2', 'b')
    await first
    playback.stopAll()
    await expect(second).resolves.toBe(false)

    const third = playback.play('/c.wav', 'pin-3', 'c')
    await third
    expect(FakeAudio.plays).toContain('/c.wav')
    expect(FakeAudio.plays).not.toContain('/b.wav')
  })
})
