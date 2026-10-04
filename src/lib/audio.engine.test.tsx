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
    createBiquadFilter = () => new FakeNode()
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
  return { created, sources, resume, speak }
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

  it('plays the MP3 and routes it through the running shared context', async () => {
    const f = installFakes()
    const engine = await freshEngine()
    expect(await engine.playDetailed('/audio/a.mp3', 'p1', 'text')).toBe('played')
    expect(f.created[0].play).toHaveBeenCalledTimes(1)
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
    expect(f.sources).toHaveLength(0) // plain playback = audible, not silent
  })

  it('uses ONE AudioContext for many voice files', async () => {
    const f = installFakes()
    const ctorSpy = vi.fn()
    const Base = (globalThis as unknown as { AudioContext: new () => object }).AudioContext
    vi.stubGlobal('AudioContext', class extends Base { constructor() { super(); ctorSpy() } })
    const engine = await freshEngine()
    await engine.playDetailed('/audio/a.mp3', 'p1', 't')
    await engine.playDetailed('/audio/b.mp3', 'p2', 't')
    await engine.playDetailed('/audio/c.mp3', 'p3', 't')
    expect(ctorSpy).toHaveBeenCalledTimes(1)
    expect(f.sources).toHaveLength(3)
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

  it('unlock() starts the AudioContext synchronously inside the gesture and warms TTS', async () => {
    const f = installFakes({}, 'suspended-hang')
    const engine = await freshEngine()
    engine.unlock()
    expect(f.resume).toHaveBeenCalled()
    expect(f.speak).toHaveBeenCalledTimes(1)
  })

  it('legacy play() keeps its boolean contract', async () => {
    installFakes()
    const engine = await freshEngine()
    expect(await engine.play('/audio/a.mp3', 'p1', 't')).toBe(true)
    expect(await engine.play('/audio/a.mp3', 'p1', 't')).toBe(false)
  })
})
