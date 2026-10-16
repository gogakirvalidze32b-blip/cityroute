/**
 * ხმის სიჩქარე — შეცვალე ეს რიცხვი.
 * 1 = ნორმალური · 0.9 = ოდნავ ნელი · 0.8 = უფრო ნელი · 0.75 = ნელი · 0.7 = ძალიან ნელი · 1.1 = ჩქარი · 1.2 = უფრო ჩქარი
 */
export const VOICE_PLAYBACK_RATE = 1

/**
 * ტემბრი:
 * - normal — ორიგინალი AI ხმა
 * - mid    — თბილი/რბილი (sexy): pitch უცვლელი + ღრმა, გლუვი EQ
 * - low    — ღრმა ტემბრი (pitch follows — ბოხი შეიძლება)
 */
export type VoicePitch = 'normal' | 'mid' | 'low'
export const VOICE_PITCH: VoicePitch = 'normal'

/** @deprecated გამოიყენე VOICE_PITCH */
export const VOICE_LOW_PITCH = (['low'] as VoicePitch[]).includes(VOICE_PITCH)

/**
 * HTMLAudioElement.volume: 0 = silent · 1 = full.
 * The HTML media API only accepts 0.0–1.0; values above 1 are clamped to 1.
 * Do not set 1.3 here — it cannot produce 130% loudness.
 */
export const VOICE_VOLUME = 1

/**
 * Web Audio GainNode multiplier (timbre / pitch / speed unchanged).
 * 1.0 = file level. Use this (not HTML volume) if loudness above 100% is needed.
 */
export const VOICE_GAIN = 1

/** Shared Web Audio graph (one AudioContext for all voice files — mobile browsers cap contexts). */
type WarmGraph = {
  ctx: AudioContext
  input: AudioNode
}

/** Loudness only: one gain into the speakers. No EQ, no pitch shift. */
type LoudGraph = {
  ctx: AudioContext
  gain: GainNode
}

/** Result of a playback attempt. 'failed' = neither the MP3 nor the TTS fallback could start. */
export type PlayStatus = 'played' | 'tts' | 'duplicate' | 'failed'

export type AudioDiagnostic = {
  at: number
  pinId: string
  url: string | null
  reason:
    | 'no-audio-url'
    | 'autoplay-blocked'
    | 'media-not-supported'
    | 'media-error'
    | 'play-rejected'
    | 'audio-context-not-running'
    | 'tts-unavailable'
  detail?: string
}

/** A voice that has been "playing" longer than this is treated as stuck, not busy. */
const MAX_BUSY_MS = 12000
/** Never wait longer than this for AudioContext.resume() (it can hang without a user gesture). */
const RESUME_TIMEOUT_MS = 400

export class AudioEngine {
  private cache = new Map<string, HTMLAudioElement>()
  private speaking = new Set<string>()
  private playbackRate = VOICE_PLAYBACK_RATE
  private pitch: VoicePitch = VOICE_PITCH
  private volume = VOICE_VOLUME
  private graph: WarmGraph | null = null
  private loud: LoudGraph | null = null
  private wired = new WeakMap<HTMLAudioElement, Promise<boolean>>()
  private busySince = 0
  private diagnostics: AudioDiagnostic[] = []

  setPlaybackRate(rate: number) {
    this.playbackRate = rate
    this.cache.forEach((a) => this.applyRate(a))
  }

  setPitch(pitch: VoicePitch) {
    this.pitch = pitch
    this.cache.forEach((a) => this.applyRate(a))
  }

  /** @deprecated გამოიყენე setPitch('low' | 'normal') */
  setLowPitch(low: boolean) {
    this.setPitch(low ? 'low' : 'normal')
  }

  setVolume(volume: number) {
    this.volume = volume
    this.cache.forEach((a) => this.applyRate(a))
  }

  private applyRate(audio: HTMLAudioElement) {
    audio.volume = this.volume

    switch (this.pitch) {
      case 'low':
        audio.playbackRate = this.playbackRate
        audio.preservesPitch = false
        break
      case 'mid':
      case 'normal':
      default:
        audio.playbackRate = this.playbackRate
        audio.preservesPitch = true
        break
    }

    // @ts-expect-error — Safari/WebKit პრეფიქსი
    audio.webkitPreservesPitch = audio.preservesPitch
  }

 /** Gain-only graph. Does not filter or change playback rate. */
  private getLoudGraph(): LoudGraph | null {
    if (this.loud) return this.loud
    if (typeof AudioContext === 'undefined') return null

    let ctx: AudioContext
    try {
      ctx = new AudioContext()
    } catch (err) {
      this.report('engine', null, 'audio-context-not-running', err instanceof Error ? err.message : String(err))
      return null
    }

    const gain = ctx.createGain()
    gain.gain.value = VOICE_GAIN
    gain.connect(ctx.destination)
    this.loud = { ctx, gain }
    return this.loud
  }

  /** Builds the shared "mid" EQ graph once. Returns null if Web Audio is unavailable. */
  private getGraph(): WarmGraph | null {
    if (this.graph) return this.graph
    if (typeof AudioContext === 'undefined') return null

    let ctx: AudioContext
    try {
      ctx = new AudioContext()
    } catch (err) {
      this.report('engine', null, 'audio-context-not-running', err instanceof Error ? err.message : String(err))
      return null
    }

    const depth = ctx.createBiquadFilter()
    depth.type = 'lowshelf'
    depth.frequency.value = 200
    depth.gain.value = 3.2

    const chest = ctx.createBiquadFilter()
    chest.type = 'peaking'
    chest.frequency.value = 340
    chest.Q.value = 0.6
    chest.gain.value = 2.2

    const intimacy = ctx.createBiquadFilter()
    intimacy.type = 'peaking'
    intimacy.frequency.value = 720
    intimacy.Q.value = 0.55
    intimacy.gain.value = 1.4

    const soften = ctx.createBiquadFilter()
    soften.type = 'peaking'
    soften.frequency.value = 2600
    soften.Q.value = 0.7
    soften.gain.value = -2.8

    const darken = ctx.createBiquadFilter()
    darken.type = 'highshelf'
    darken.frequency.value = 4800
    darken.gain.value = -2.2

    const smooth = ctx.createDynamicsCompressor()
    smooth.threshold.value = -20
    smooth.knee.value = 22
    smooth.ratio.value = 2.4
    smooth.attack.value = 0.008
    smooth.release.value = 0.22

    depth
      .connect(chest)
      .connect(intimacy)
      .connect(soften)
      .connect(darken)
      .connect(smooth)
      .connect(ctx.destination)

    this.graph = { ctx, input: depth }
    return this.graph
  }

  /** resume() can stay pending forever outside a user gesture — never block playback on it. */
  private async resumeContext(ctx: AudioContext): Promise<void> {
    if (ctx.state === 'running') return
    try {
      await Promise.race([
        ctx.resume(),
        new Promise<void>((resolve) => window.setTimeout(resolve, RESUME_TIMEOUT_MS)),
      ])
    } catch {
      /* state is checked by the caller */
    }
  }

  /**
   * mid — warm timbre through the shared graph (pitch unchanged).
   * Resolves true only if the element is routed through a RUNNING context.
   * An element is never wired to a suspended context: that would make playback silent
   * while audio.play() still "succeeds". In that case we fall back to plain playback.
   */
  /**
   * 130% loudness through a GainNode. The media element stays at volume 1.
   * A suspended context is not wired: playback would succeed and stay silent.
   */
  private ensureLoudChain(audio: HTMLAudioElement): Promise<boolean> {
    if (this.pitch === 'mid') return Promise.resolve(false)

    const existing = this.wired.get(audio)
    if (existing) return existing

    const task = (async () => {
      const graph = this.getLoudGraph()
      if (!graph) return false
      await this.resumeContext(graph.ctx)
      if (graph.ctx.state !== 'running') return false
      try {
        graph.ctx.createMediaElementSource(audio).connect(graph.gain)
        return true
      } catch {
        return false
      }
    })()

    this.wired.set(audio, task)
    void task.then((ok) => {
      if (!ok && this.wired.get(audio) === task) this.wired.delete(audio)
    })
    return task
  }

  private ensureWarmChain(audio: HTMLAudioElement): Promise<boolean> {
    if (this.pitch !== 'mid') return Promise.resolve(false)

    const existing = this.wired.get(audio)
    if (existing) return existing

    const task = (async () => {
      const graph = this.getGraph()
      if (!graph) return false
      await this.resumeContext(graph.ctx)
      if (graph.ctx.state !== 'running') return false
      try {
        graph.ctx.createMediaElementSource(audio).connect(graph.input)
        return true
      } catch {
        return false
      }
    })()

    this.wired.set(audio, task)
    // A failed (not-yet-running) attempt must be retryable later, e.g. after unlock().
    void task.then((ok) => {
      if (!ok && this.wired.get(audio) === task) this.wired.delete(audio)
    })
    return task
  }

  /**
   * Call synchronously from a user gesture (tap on "start", first touch/click).
   * Starts the AudioContext inside the gesture, wires already-preloaded voices to it
   * and unlocks speech synthesis, so later PIN voices can play from GPS callbacks.
   */
  unlock(): void {
    if (typeof window === 'undefined') return
    try {
      if (this.pitch === 'mid') {
        const graph = this.getGraph()
        if (graph) {
          void this.resumeContext(graph.ctx).then(() => {
            if (graph.ctx.state === 'running') this.cache.forEach((a) => void this.ensureWarmChain(a))
          })
        }
      } else {
        const graph = this.getLoudGraph()
        if (graph) {
          void this.resumeContext(graph.ctx).then(() => {
            if (graph.ctx.state === 'running') this.cache.forEach((a) => void this.ensureLoudChain(a))
          })
        }
      }
    } catch {
      /* best effort */
    }
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices()
        const warm = new SpeechSynthesisUtterance('')
        warm.volume = 0
        window.speechSynthesis.speak(warm)
      }
    } catch {
      /* best effort */
    }
  }

  /** True while a voice is playing (with a safety timeout so a stuck state can never block PIN audio). */
  isBusy(): boolean {
    return this.speaking.size > 0 && Date.now() - this.busySince < MAX_BUSY_MS
  }

  getDiagnostics(): readonly AudioDiagnostic[] {
    return this.diagnostics
  }

  private report(pinId: string, url: string | null, reason: AudioDiagnostic['reason'], detail?: string) {
    const entry: AudioDiagnostic = { at: Date.now(), pinId, url, reason, detail }
    this.diagnostics.push(entry)
    if (this.diagnostics.length > 30) this.diagnostics.shift()
    console.warn('[AUDIO]', reason, '| pin:', pinId, '| url:', url ?? '-', detail ? '| ' + detail : '')
  }

  preload(url: string) {
    if (!url || this.cache.has(url)) return
    const audio = new Audio(url)
    audio.preload = 'auto'
    this.applyRate(audio)
    audio.load()
    this.cache.set(url, audio)
  }

  preloadAll(urls: string[]) {
    urls.filter(Boolean).forEach((u) => this.preload(u))
  }

  speakText(text: string, pinId: string): boolean {
    if (this.speaking.has(pinId)) return false
    if (!text || !('speechSynthesis' in window)) return false
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'ka-GE'
    utter.rate = 1
    utter.pitch = 1
    const voice = pickGeorgianVoice()
    if (voice) utter.voice = voice
    this.speaking.add(pinId)
    this.busySince = Date.now()
    utter.onend = () => this.speaking.delete(pinId)
    utter.onerror = () => this.speaking.delete(pinId)
    window.speechSynthesis.speak(utter)
    return true
  }

  async play(url: string | null | undefined, pinId: string, fallbackText: string): Promise<boolean> {
    const status = await this.playDetailed(url, pinId, fallbackText)
    return status === 'played' || status === 'tts'
  }

  /** Same as play() but tells the caller what happened, so a failed PIN voice can be retried. */
  async playDetailed(url: string | null | undefined, pinId: string, fallbackText: string): Promise<PlayStatus> {
    if (this.speaking.has(pinId)) return 'duplicate'

    if (url) {
      let audio = this.cache.get(url)
      if (!audio) {
        audio = new Audio(url)
        this.cache.set(url, audio)
      }
      let fellBackToTts = false
      try {
        audio.currentTime = 0
        this.applyRate(audio)
        if (this.pitch === 'mid') await this.ensureWarmChain(audio)
        else await this.ensureLoudChain(audio)

        this.speaking.add(pinId)
        this.busySince = Date.now()
        audio.onended = () => this.speaking.delete(pinId)
        audio.onerror = () => {
          this.speaking.delete(pinId)
          this.report(pinId, url, 'media-error', 'code=' + (audio?.error?.code ?? '?'))
          fellBackToTts = this.speakText(fallbackText, pinId)
        }
        await audio.play()
        return 'played'
      } catch (err) {
        if (fellBackToTts) return 'tts'
        this.speaking.delete(pinId)
        const name = err instanceof DOMException ? err.name : ''
        this.report(
          pinId,
          url,
          name === 'NotAllowedError'
            ? 'autoplay-blocked'
            : name === 'NotSupportedError'
              ? 'media-not-supported'
              : 'play-rejected',
          err instanceof Error ? err.name + ': ' + err.message : String(err),
        )
      }
    } else {
      this.report(pinId, null, 'no-audio-url')
    }

    if (this.speakText(fallbackText, pinId)) {
      this.busySince = Date.now()
      return 'tts'
    }
    this.report(pinId, url ?? null, 'tts-unavailable')
    return 'failed'
  }

  stopAll() {
    this.speaking.clear()
    this.cache.forEach((a) => {
      a.pause()
      a.currentTime = 0
    })
    window.speechSynthesis?.cancel()
  }
}

export const audioEngine = new AudioEngine()

function pickGeorgianVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith('ka')) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('ru')) ??
    null
  )
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.addEventListener('voiceschanged', () => pickGeorgianVoice(), { passive: true })
}
