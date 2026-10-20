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
 * HTML media volume stays at 1.0; this gain adds approximately 3.5 dB.
 */
export const VOICE_GAIN = 1.5

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

/** Result of a playback start request. Only original WAV/media URLs are used — never TTS. */
export type PlayStatus = 'played' | 'duplicate' | 'busy' | 'cancelled' | 'failed'

export type PlaybackFailureReason = 'media-error' | 'play-rejected' | 'playback-timeout'

export type PlayOptions = {
  /** Called once if a started playback later fails. */
  onFailure?: (reason: PlaybackFailureReason) => void
}

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
    | 'gain-unavailable'
    | 'playback-timeout'
  detail?: string
}

/** A voice that has been "playing" longer than this is treated as stuck, not busy. */
const MAX_BUSY_MS = 12000
/** Never wait longer than this for AudioContext.resume() (it can hang without a user gesture). */
const RESUME_TIMEOUT_MS = 400

export class AudioEngine {
  private cache = new Map<string, HTMLAudioElement>()
  private playbackRate = VOICE_PLAYBACK_RATE
  private pitch: VoicePitch = VOICE_PITCH
  private volume = VOICE_VOLUME
  private graph: WarmGraph | null = null
  private loud: LoudGraph | null = null
  private wired = new WeakMap<HTMLAudioElement, Promise<boolean>>()
  private playbackSequence = 0
  private activePlayback: {
    sequence: number
    pinId: string
    url: string
    audio: HTMLAudioElement
    options: PlayOptions
    started: boolean
    failureReason: PlaybackFailureReason | null
    failureReported: boolean
    rejectStart: ((reason: Error) => void) | null
    timeout: ReturnType<typeof setTimeout> | null
  } | null = null
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
    // Exam voices must always play at the original recorded tempo (1.0x).
    audio.playbackRate = 1

    switch (this.pitch) {
      case 'low':
        audio.preservesPitch = false
        break
      case 'mid':
      case 'normal':
      default:
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

    try {
      const gain = ctx.createGain()
      gain.gain.value = VOICE_GAIN
      gain.connect(ctx.destination)
      this.loud = { ctx, gain }
      return this.loud
    } catch (err) {
      void Promise.resolve(ctx.close()).catch(() => {})
      this.report('engine', null, 'audio-context-not-running', err instanceof Error ? err.message : String(err))
      return null
    }
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
      let source: MediaElementAudioSourceNode | null = null
      try {
        source = graph.ctx.createMediaElementSource(audio)
        source.connect(graph.gain)
        return true
      } catch {
        if (source) {
          try {
            source.connect(graph.ctx.destination)
          } catch (err) {
            this.report('engine', null, 'audio-context-not-running', err instanceof Error ? err.message : String(err))
          }
        }
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
   * Starts the AudioContext inside the gesture and wires already-preloaded WAV voices,
   * so later PIN voices can play from GPS callbacks. Never enables browser TTS.
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
  }

  /** True while the single active voice is playing or being prepared. */
  isBusy(): boolean {
    return this.activePlayback !== null
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

  async play(
    url: string | null | undefined,
    pinId: string,
    _instructionText = '',
    options?: PlayOptions,
  ): Promise<boolean> {
    const status = await this.playDetailed(url, pinId, _instructionText, options)
    return status === 'played'
  }

  /**
   * Plays only the given media URL (original WAV). Never synthesizes speech from text.
   * Resolves 'played' once playback starts. A failure after start is delivered once
   * through options.onFailure; stopAll() invalidates the active request.
   */
  async playDetailed(
    url: string | null | undefined,
    pinId: string,
    _instructionText = '',
    options: PlayOptions = {},
  ): Promise<PlayStatus> {
    if (this.activePlayback) {
      return this.activePlayback.pinId === pinId ? 'duplicate' : 'busy'
    }

    if (!url) {
      this.report(pinId, null, 'no-audio-url', 'No original WAV mapped for this PIN; not using TTS')
      console.error('[AUDIO] Missing original WAV for PIN', pinId, '— instruction was not spoken')
      return 'failed'
    }

    let audio = this.cache.get(url)
    if (!audio) {
      audio = new Audio(url)
      this.cache.set(url, audio)
    }
    const playback = {
      sequence: ++this.playbackSequence,
      pinId,
      url,
      audio,
      options,
      started: false,
      failureReason: null as PlaybackFailureReason | null,
      failureReported: false,
      rejectStart: null as ((reason: Error) => void) | null,
      timeout: null as ReturnType<typeof setTimeout> | null,
    }
    this.activePlayback = playback

    const isCurrent = () =>
      this.activePlayback === playback && this.activePlayback.sequence === playback.sequence

    const clearPlayback = () => {
      if (playback.timeout !== null) {
        clearTimeout(playback.timeout)
        playback.timeout = null
      }
      if (isCurrent()) this.activePlayback = null
    }

    const retireAudio = () => {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      if (this.cache.get(url) === audio) this.cache.delete(url)
    }

    const finishFailure = (reason: PlaybackFailureReason) => {
      if (!isCurrent() || playback.failureReported) return
      playback.failureReason = reason
      playback.failureReported = true
      clearPlayback()
      retireAudio()
      this.report(
        pinId,
        url,
        reason === 'media-error' ? 'media-error' : 'playback-timeout',
        reason,
      )
      if (playback.started) {
        options.onFailure?.(reason)
      } else {
        playback.rejectStart?.(new Error(reason))
      }
    }

    try {
      audio.currentTime = 0
      this.applyRate(audio)
      const gainApplied =
        this.pitch === 'mid' ? await this.ensureWarmChain(audio) : await this.ensureLoudChain(audio)
      if (!isCurrent()) return 'cancelled'
      if (!gainApplied) {
        this.report(pinId, url, 'gain-unavailable', 'Playing at original media level')
      }

      audio.onended = () => {
        if (isCurrent()) clearPlayback()
      }
      audio.onerror = () => {
        if (!isCurrent()) return
        console.error('[AUDIO] Original WAV failed for PIN', pinId, '| url:', url)
        finishFailure('media-error')
      }
      playback.timeout = setTimeout(() => finishFailure('playback-timeout'), MAX_BUSY_MS)
      const startTimeout = new Promise<never>((_resolve, reject) => {
        playback.rejectStart = reject
      })
      await Promise.race([audio.play(), startTimeout])
      if (!isCurrent()) return 'cancelled'
      if (playback.failureReason) {
        clearPlayback()
        return 'failed'
      }
      playback.rejectStart = null
      if (audio.playbackRate !== 1) {
        audio.playbackRate = 1
      }
      playback.started = true
      return 'played'
    } catch (err) {
      if (!isCurrent()) return playback.failureReported ? 'failed' : 'cancelled'
      clearPlayback()
      retireAudio()
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
      console.error(
        '[AUDIO] Could not play original WAV for PIN',
        pinId,
        '| url:',
        url,
        '|',
        err instanceof Error ? err.message : String(err),
      )
      return 'failed'
    }
  }

  stopAll() {
    const playback = this.activePlayback
    this.playbackSequence++
    this.activePlayback = null
    if (playback?.timeout !== null && playback?.timeout !== undefined) {
      clearTimeout(playback.timeout)
      playback.timeout = null
    }
    playback?.rejectStart?.(new Error('cancelled'))
    if (playback) playback.rejectStart = null
    if (playback) {
      playback.audio.onended = null
      playback.audio.onerror = null
      playback.audio.pause()
      playback.audio.currentTime = 0
      if (this.cache.get(playback.url) === playback.audio) this.cache.delete(playback.url)
    }
    this.cache.forEach((a) => {
      a.pause()
      a.currentTime = 0
    })
  }
}

export const audioEngine = new AudioEngine()
