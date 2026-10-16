import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AudioEngine: browser-autoplay / AudioContext / TTS-fallback behaviour with fake browser APIs.
 */
type Behaviour = { playRejects?: string }

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
    createDynamicsCompressor = () => new FakeNode()
    createMediaElementSource = () => {
      const n = new FakeNode()
      sources.push(n)
      return n
    }
  }

  const speak = vi.fn()
  class FakeUtterance {
    text: string
    lang = ''
    rate = 1
    pitch = 1
    volume = 1
    voice: unknown = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
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
  return { created, sources, gains, filters, resume, speak }
}

async function freshEngine() {
  vi.resetModules()
  const mod = await import('./audio')
  return new mod.AudioEngine()
}

describe('AudioEngine', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('plays the MP3 at 1.0x with pitch preserved, media volume 1, and gain 1.0', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.mp3', 'p1', 'text')).toBe('played')
    expect(f.created[0].play).toHaveBeenCalledTimes(1)
    expect(f.created[0].volume).toBe(1)
    expect(f.created[0].playbackRate).toBe(1)
    expect(f.created[0].preservesPitch).toBe(true)
    expect(f.gains).toHaveLength(1)
    expect(f.gains[0].gain.value).toBe(1)
    expect(f.filters).toHaveLength(0)
    expect(f.sources).toHaveLength(1)
  })

  it('does NOT hang when AudioContext.resume() never resolves, and does not wire to a suspended context', async () => {
    const f = installFakes({}, 'suspended-hang')
    const engine = await freshEngine()
    const status = await Promise.race([
      engine.playDetailed('/audio/a.mp3', 'p1', 'text'),
      new Promise((r) => setTimeout(() => r('HUNG'), 2000)),
    ])
    expect(status).toBe('played')
    expect(f.created[0].play).toHaveBeenCalledTimes(1)
    expect(f.created[0].volume).toBe(1)
    expect(f.created[0].playbackRate).toBe(1)
    expect(f.sources).toHaveLength(0) // suspended context stays unwired so playback is audible
  })

  it('uses one unity gain for every voice and does not open the EQ graph', async () => {
    const f = installFakes()
    const ctorSpy = vi.fn()
    const Base = (globalThis as unknown as { AudioContext: new () => object }).AudioContext
    vi.stubGlobal('AudioContext', class extends Base { constructor() { super(); ctorSpy() } })
    const engine = await freshEngine()
    for (const [url, id] of [
      ['/audio/points/route-1.wav', 'p1'],
      ['/audio/points/route-2.wav', 'p2'],
      ['/audio/points/route-3.wav', 'p3'],
      ['/audio/points/route-4.wav', 'p4'],
    ] as const) {
      expect(await engine.playDetailed(url, id, 't')).toBe('played')
    }
    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(f.gains).toHaveLength(1)
    expect(f.gains[0].gain.value).toBe(1)
    expect(f.filters).toHaveLength(0)
    expect(f.sources).toHaveLength(4)
    expect(f.created.every((audio) => audio.volume === 1 && audio.playbackRate === 1 && audio.preservesPitch)).toBe(true)
  })

  it('autoplay blocked → TTS fallback speaks the instruction text and the reason is recorded', async () => {
    const f = installFakes({ playRejects: 'NotAllowedError' })
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.mp3', 'p1', 'გთხოვთ მოუხვიოთ მარცხნივ')).toBe('tts')
    expect(f.speak).toHaveBeenCalledTimes(1)
    expect(engine.getDiagnostics().map((d) => d.reason)).toContain('autoplay-blocked')
  })

  it('missing MP3 (NotSupportedError) → TTS fallback and diagnostic', async () => {
    const f = installFakes({ playRejects: 'NotSupportedError' })
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/missing.mp3', 'p1', 'text')).toBe('tts')
    expect(f.speak).toHaveBeenCalledTimes(1)
    expect(engine.getDiagnostics()[0].reason).toBe('media-not-supported')
  })

  it('no audio_url → TTS; nothing available at all → failed with a diagnostic', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed(null, 'p1', 'text')).toBe('tts')
    expect(f.speak).toHaveBeenCalledTimes(1)

    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined })
    vi.stubGlobal('speechSynthesis', undefined)
    delete (window as unknown as Record<string, unknown>).speechSynthesis
    const e2 = await freshEngine()
    expect(await e2.playDetailed(null, 'p2', 'text')).toBe('failed')
    expect(e2.getDiagnostics().map((d) => d.reason)).toEqual(['no-audio-url', 'tts-unavailable'])
  })

  it('duplicate prevention: the same PIN cannot play twice while its voice is active', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.mp3', 'p1', 't')).toBe('played')
    expect(await engine.playDetailed('/audio/a.mp3', 'p1', 't')).toBe('duplicate')
    expect(f.created[0].play).toHaveBeenCalledTimes(1)
  })

  it('isBusy() is true while a voice plays and false after it ends', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(engine.isBusy()).toBe(false)
    await engine.playDetailed('/audio/a.mp3', 'p1', 't')
    expect(engine.isBusy()).toBe(true)
    f.created[0].onended?.()
    expect(engine.isBusy()).toBe(false)
  })

  it('after a voice ends, the next PIN instruction can play', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.mp3', 'p1', 't1')).toBe('played')
    f.created[0].onended?.()
    expect(engine.isBusy()).toBe(false)
    expect(await engine.playDetailed('/audio/b.mp3', 'p2', 't2')).toBe('played')
    expect(f.created[1].play).toHaveBeenCalledTimes(1)
  })

  it('stopAll() pauses active voices and clears busy so a later PIN can play', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.mp3', 'p1', 't')).toBe('played')
    expect(engine.isBusy()).toBe(true)
    engine.stopAll()
    expect(f.created[0].pause).toHaveBeenCalled()
    expect(f.created[0].currentTime).toBe(0)
    expect(engine.isBusy()).toBe(false)
    expect(await engine.playDetailed('/audio/b.mp3', 'p2', 't')).toBe('played')
  })

  it('after a play rejection the engine is not stuck and the next PIN can play', async () => {
    const f = installFakes({ playRejects: 'NotAllowedError' })
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.mp3', 'p1', 'fallback')).toBe('tts')
    expect(engine.isBusy()).toBe(true)
    // TTS ends → engine must accept a later media play
    const utter = f.speak.mock.calls[0]?.[0] as { onend?: (() => void) | null } | undefined
    utter?.onend?.()
    expect(engine.isBusy()).toBe(false)

    const f2 = installFakes()
    const engine2 = await freshEngine()
    expect(await engine2.playDetailed('/audio/ok.mp3', 'p2', 't')).toBe('played')
    expect(f2.created[0].play).toHaveBeenCalledTimes(1)
  })

  it('keeps VOICE_GAIN and VOICE_VOLUME at 1.0', async () => {
    const mod = await import('./audio')
    expect(mod.VOICE_GAIN).toBe(1)
    expect(mod.VOICE_VOLUME).toBe(1)
  })

  it('unlock() warms TTS and the gain context, without the EQ graph', async () => {
    const f = installFakes({}, 'suspended-hang')
    const engine = await freshEngine()
    engine.unlock()
    expect(f.resume).toHaveBeenCalledTimes(1)
    expect(f.gains).toHaveLength(1)
    expect(f.gains[0].gain.value).toBe(1)
    expect(f.filters).toHaveLength(0)
    expect(f.speak).toHaveBeenCalledTimes(1)
  })

  it('legacy play() keeps its boolean contract', async () => {
    installFakes()
    const engine = await freshEngine()
    expect(await engine.play('/audio/a.mp3', 'p1', 't')).toBe(true)
    expect(await engine.play('/audio/a.mp3', 'p1', 't')).toBe(false)
  })
})
