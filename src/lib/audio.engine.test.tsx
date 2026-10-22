import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeVoiceGain } from './audio-normalization'

/**
 * AudioEngine: original WAV only at 1.0x speed — never browser TTS.
 */
type Behaviour = { playRejects?: string; playNeverResolves?: boolean }

function installFakes(b: Behaviour = {}, ctxState: 'running' | 'suspended-hang' = 'running') {
  const created: FakeAudio[] = []
  class FakeAudio {
    src: string
    currentTime = 0
    volume = 1
    playbackRate = 1
    preservesPitch = true
    preload = ''
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    error: { code: number } | null = null
    play = vi.fn(async () => {
      if (b.playNeverResolves) return await new Promise<void>(() => {})
      if (b.playRejects) throw new DOMException('blocked', b.playRejects)
    })
    pause = vi.fn()
    load = vi.fn()
    constructor(src: string) {
      this.src = src
      created.push(this)
    }
  }

  const sources: unknown[] = []
  const gains: FakeNode[] = []
  const compressors: FakeNode[] = []
  const filters: FakeNode[] = []
  const resume = vi.fn(() => (ctxState === 'running' ? Promise.resolve() : new Promise<void>(() => {})))
  class FakeNode {
    type = ''
    frequency = { value: 0 }
    gain = { value: 0 }
    Q = { value: 0 }
    threshold = { value: 0 }
    knee = { value: 0 }
    ratio = { value: 0 }
    attack = { value: 0 }
    release = { value: 0 }
    connect(n: unknown) {
      return n
    }
  }
  class FakeAudioContext {
    state = ctxState === 'running' ? 'running' : 'suspended'
    destination = new FakeNode()
    resume = resume
    close = vi.fn()
    createGain = () => {
      const n = new FakeNode()
      gains.push(n)
      return n
    }
    createBiquadFilter = () => {
      const n = new FakeNode()
      filters.push(n)
      return n
    }
    createDynamicsCompressor = () => {
      const n = new FakeNode()
      compressors.push(n)
      return n
    }
    createMediaElementSource = () => {
      const n = new FakeNode()
      sources.push(n)
      return n
    }
  }

  const speak = vi.fn()
  class FakeUtterance {
    text: string
    constructor(t: string) {
      this.text = t
    }
  }

  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak, cancel: vi.fn(), getVoices: () => [], addEventListener: vi.fn() },
  })
  return { created, sources, gains, compressors, filters, resume, speak }
}

async function freshEngine() {
  vi.resetModules()
  const mod = await import('./audio')
  return new mod.AudioEngine()
}

describe('AudioEngine', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('preserves WAV tempo and pitch while configuring fallback gain without compression', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/points/a.wav', 'p1', 'text')).toBe('played')
    expect(f.created[0].play).toHaveBeenCalledTimes(1)
    expect(f.created[0].volume).toBe(1)
    expect(f.created[0].playbackRate).toBe(1)
    expect(f.created[0].preservesPitch).toBe(true)
    expect(f.gains).toHaveLength(1)
    expect(f.gains[0].gain.value).toBe(2)
    expect(f.compressors).toHaveLength(0)
    expect(f.filters).toHaveLength(0)
    expect(f.sources).toHaveLength(1)
    expect(f.speak).not.toHaveBeenCalled()
  })

  it('does NOT hang when AudioContext.resume() never resolves, and does not wire to a suspended context', async () => {
    const f = installFakes({}, 'suspended-hang')
    const engine = await freshEngine()
    const status = await Promise.race([
      engine.playDetailed('/audio/a.wav', 'p1', 'text'),
      new Promise((r) => setTimeout(() => r('HUNG'), 2000)),
    ])
    expect(status).toBe('played')
    expect(f.created[0].playbackRate).toBe(1)
    expect(f.sources).toHaveLength(0)
    expect(f.speak).not.toHaveBeenCalled()
  })

  it('uses one 2x gain and peak compressor for every voice without opening the EQ graph', async () => {
    const f = installFakes()
    const ctorSpy = vi.fn()
    const Base = (globalThis as unknown as { AudioContext: new () => object }).AudioContext
    vi.stubGlobal(
      'AudioContext',
      class extends Base {
        constructor() {
          super()
          ctorSpy()
        }
      },
    )
    const engine = await freshEngine()
    for (const [url, id] of [
      ['/audio/points/route-1.wav', 'p1'],
      ['/audio/points/route-2.wav', 'p2'],
      ['/audio/points/route-3.wav', 'p3'],
      ['/audio/points/route-4.wav', 'p4'],
    ] as const) {
      expect(await engine.playDetailed(url, id, 't')).toBe('played')
      f.created[f.created.length - 1]?.onended?.()
    }
    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(f.created.every((audio) => audio.playbackRate === 1)).toBe(true)
    expect(f.compressors).toHaveLength(0)
    expect(f.speak).not.toHaveBeenCalled()
  })

  it('applies the safe per-file 2x gain without overlapping or replaying audio', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    const quietUrl = '/audio/points/გთხოვთ, მოუხვიოთ მარჯვნივ.wav'
    const loudUrl = '/audio/points/300 მეტრში, წრიული მოძრაობისას გთხოვთ მოუხვიოთ მარცხნივ.wav'
    const expectedQuietGain = safeVoiceGain(quietUrl, 2)
    const expectedLoudGain = safeVoiceGain(loudUrl, 2)
    const onEnded = vi.fn()
    engine.setVolume(0.5)

    expect(await engine.playDetailed(quietUrl, 'quiet-pin', 'text', { onEnded })).toBe('played')
    expect(f.gains[0].gain.value).toBeCloseTo(expectedQuietGain)
    expect(f.created[0].volume).toBe(0.5)
    expect(await engine.playDetailed(loudUrl, 'next-pin', 'text')).toBe('busy')
    expect(f.created).toHaveLength(1)
    f.created[0].onended?.()
    expect(onEnded).toHaveBeenCalledTimes(1)

    expect(await engine.playDetailed(loudUrl, 'next-pin', 'text')).toBe('played')
    expect(f.gains[0].gain.value).toBeCloseTo(expectedLoudGain)
    expect(f.created).toHaveLength(2)
    expect(f.created.every((audio) => audio.playbackRate === 1)).toBe(true)
  })

  it('autoplay blocked → failed with diagnostic; TTS is never used', async () => {
    const f = installFakes({ playRejects: 'NotAllowedError' })
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.wav', 'p1', 'გთხოვთ მოუხვიოთ მარცხნივ')).toBe('failed')
    expect(f.speak).not.toHaveBeenCalled()
    expect(engine.getDiagnostics().map((d) => d.reason)).toContain('autoplay-blocked')
  })

  it('missing / unsupported media → failed; TTS is never used', async () => {
    const f = installFakes({ playRejects: 'NotSupportedError' })
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/missing.wav', 'p1', 'text')).toBe('failed')
    expect(f.speak).not.toHaveBeenCalled()
    expect(engine.getDiagnostics()[0].reason).toBe('media-not-supported')
  })

  it('no audio_url → failed with diagnostic; TTS is never used', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed(null, 'p1', 'text')).toBe('failed')
    expect(f.speak).not.toHaveBeenCalled()
    expect(engine.getDiagnostics().map((d) => d.reason)).toEqual(['no-audio-url'])
  })

  it('setPlaybackRate cannot change exam voice tempo away from 1.0x', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    engine.setPlaybackRate(0.8)
    expect(await engine.playDetailed('/audio/a.wav', 'p1', 't')).toBe('played')
    expect(f.created[0].playbackRate).toBe(1)
  })

  it('duplicate prevention: the same PIN cannot play twice while its voice is active', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.wav', 'p1', 't')).toBe('played')
    expect(await engine.playDetailed('/audio/a.wav', 'p1', 't')).toBe('duplicate')
    expect(f.created[0].play).toHaveBeenCalledTimes(1)
  })

  it('isBusy() is true while a voice plays and false after it ends', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(engine.isBusy()).toBe(false)
    await engine.playDetailed('/audio/a.wav', 'p1', 't')
    expect(engine.isBusy()).toBe(true)
    f.created[0].onended?.()
    expect(engine.isBusy()).toBe(false)
  })

  it('reports natural audio completion once, without treating playback start as completion', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    const onEnded = vi.fn()

    expect(await engine.playDetailed('/audio/a.wav', 'p1', 't', { onEnded })).toBe('played')
    expect(onEnded).not.toHaveBeenCalled()

    f.created[0].onended?.()
    f.created[0].onended?.()

    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('after a voice ends, the next PIN instruction can play', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.wav', 'p1', 't1')).toBe('played')
    f.created[0].onended?.()
    expect(await engine.playDetailed('/audio/b.wav', 'p2', 't2')).toBe('played')
    expect(f.created[1].play).toHaveBeenCalledTimes(1)
  })

  it('stopAll() pauses active voices and clears busy so a later PIN can play', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.wav', 'p1', 't')).toBe('played')
    engine.stopAll()
    expect(f.created[0].pause).toHaveBeenCalled()
    expect(engine.isBusy()).toBe(false)
    expect(await engine.playDetailed('/audio/b.wav', 'p2', 't')).toBe('played')
  })

  it('stopAll() resolves an in-flight start as cancelled and prevents later playback', async () => {
    const f = installFakes({ playNeverResolves: true })
    const engine = await freshEngine()
    const request = engine.playDetailed('/audio/a.wav', 'p1', 't')
    await Promise.resolve()
    await Promise.resolve()

    engine.stopAll()

    await expect(request).resolves.toBe('cancelled')
    expect(f.created[0].pause).toHaveBeenCalled()
    expect(engine.isBusy()).toBe(false)
  })

  it('reports a delayed media error once and releases the active PIN for retry', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    const onFailure = vi.fn()

    expect(
      await engine.playDetailed('/audio/a.wav', 'p1', 't', { onFailure }),
    ).toBe('played')
    const oldErrorHandler = f.created[0].onerror
    oldErrorHandler?.()

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith('media-error')
    expect(engine.isBusy()).toBe(false)
    expect(f.created[0].pause).toHaveBeenCalled()
    expect(await engine.playDetailed('/audio/a.wav', 'p1', 't')).toBe('played')
  })

  it('does not let a stale media callback clear or fail a newer playback', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    const oldFailure = vi.fn()
    await engine.playDetailed('/audio/a.wav', 'p1', 't', { onFailure: oldFailure })
    const oldErrorHandler = f.created[0].onerror
    engine.stopAll()

    const newFailure = vi.fn()
    expect(await engine.playDetailed('/audio/b.wav', 'p2', 't', { onFailure: newFailure })).toBe('played')
    oldErrorHandler?.()

    expect(oldFailure).not.toHaveBeenCalled()
    expect(newFailure).not.toHaveBeenCalled()
    expect(engine.isBusy()).toBe(true)
  })

  it('single-flights all PINs: duplicate requests do not start overlapping audio', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    const first = await engine.playDetailed('/audio/a.wav', 'p1', 't')
    expect(first).toBe('played')
    expect(await engine.playDetailed('/audio/a.wav', 'p1', 't')).toBe('duplicate')
    expect(await engine.playDetailed('/audio/b.wav', 'p2', 't')).toBe('busy')
    expect(f.created).toHaveLength(1)

    f.created[0].onended?.()
    expect(await engine.playDetailed('/audio/b.wav', 'p2', 't')).toBe('played')
    expect(f.created[1].play).toHaveBeenCalledTimes(1)
  })

  it('falls back to media playback with an explicit diagnostic when Web Audio is unavailable', async () => {
    const f = installFakes()
    vi.stubGlobal('AudioContext', undefined)
    const engine = await freshEngine()

    expect(await engine.playDetailed('/audio/a.wav', 'p1', 't')).toBe('played')
    expect(f.created[0].play).toHaveBeenCalledTimes(1)
    expect(f.created[0].volume).toBe(1)
    expect(engine.getDiagnostics().map((entry) => entry.reason)).toContain('gain-unavailable')
  })

  it('after a play rejection the engine is not stuck and the next PIN can play', async () => {
    const f = installFakes({ playRejects: 'NotAllowedError' })
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.wav', 'p1', 'fallback')).toBe('failed')
    expect(f.speak).not.toHaveBeenCalled()
    expect(engine.isBusy()).toBe(false)

    const f2 = installFakes()
    const engine2 = await freshEngine()
    expect(await engine2.playDetailed('/audio/ok.wav', 'p2', 't')).toBe('played')
    expect(f2.created[0].play).toHaveBeenCalledTimes(1)
    expect(f2.speak).not.toHaveBeenCalled()
  })

  it('keeps 2x gain while preserving media volume and playback rate', async () => {
    const mod = await import('./audio')
    expect(mod.VOICE_GAIN).toBe(2)
    expect(mod.VOICE_VOLUME).toBe(1)
    expect(mod.VOICE_PLAYBACK_RATE).toBe(1)
  })

  it('unlock() warms the gain context without TTS', async () => {
    const f = installFakes({}, 'suspended-hang')
    const engine = await freshEngine()
    engine.unlock()
    expect(f.resume).toHaveBeenCalledTimes(1)
    expect(f.gains).toHaveLength(1)
    expect(f.speak).not.toHaveBeenCalled()
  })

  it('legacy play() is true only when the original WAV played', async () => {
    installFakes()
    const engine = await freshEngine()
    expect(await engine.play('/audio/a.wav', 'p1', 't')).toBe(true)
    expect(await engine.play('/audio/a.wav', 'p1', 't')).toBe(false)
    const fFail = installFakes({ playRejects: 'NotAllowedError' })
    const e2 = await freshEngine()
    expect(await e2.play('/audio/a.wav', 'p3', 't')).toBe(false)
    expect(fFail.speak).not.toHaveBeenCalled()
  })
})
