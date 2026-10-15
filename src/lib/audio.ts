/**
 * ხმის სიჩქარე — შეცვალე ეს რიცხვი.
 * 1 = ნორმალური · 0.9 = ოდნავ ნელი · 0.8 = უფრო ნელი · 0.75 = ნელი · 0.7 = ძალიან ნელი · 1.1 = ჩქარი · 1.2 = უფრო ჩქარი
 */
export const VOICE_PLAYBACK_RATE = 1.0

/**
 * ტემბრი:
 * - normal — ორიგინალი AI ხმა
 * - mid    — თბილი/რბილი (sexy): pitch უცვლელი + ღრმა, გლუვი EQ
 * - low    — ღრმა ტემბრი (pitch follows — ბოხი შეიძლება)
 */
export type VoicePitch = 'normal' | 'mid' | 'low'
export const VOICE_PITCH: VoicePitch = 'mid'

/** @deprecated გამოიყენე VOICE_PITCH */
export const VOICE_LOW_PITCH = (['low'] as VoicePitch[]).includes(VOICE_PITCH)

/** ხმის სიმაღლე (volume): 0 = ჩუმი · 1 = სრული. HTML media volume 1-ზე მეტს არ იღებს. */
export const VOICE_VOLUME = 1

/** 130% loudness through a GainNode. The prepared mid timbre stays; this does not change pitch or speed. */
export const VOICE_GAIN = 1.3

const WIRED = Symbol('cityroute-audio-wired')

type WarmChain = {
  ctx: AudioContext
  resume: () => Promise<void>
}

type QueueJob = {
  url: string | null
  pinId: string
  fallbackText: string
  resolve: (started: boolean) => void
}

export class AudioEngine {
  private cache = new Map<string, HTMLAudioElement>()
  private playbackRate = VOICE_PLAYBACK_RATE
  private pitch: VoicePitch = VOICE_PITCH
  private volume = VOICE_VOLUME
  private warmChains = new WeakMap<HTMLAudioElement, WarmChain>()
  private sharedCtx: AudioContext | null = null
  private warmFailed = false
  private player: HTMLAudioElement | null = null
  private queue: QueueJob[] = []
  private draining = false
  private generation = 0
  private currentPinId: string | null = null
  private stopWaiters = new Set<() => void>()
  private speechDone: Promise<void> | null = null
  private finishSpeech: (() => void) | null = null

  setPlaybackRate(rate: number) {
    this.playbackRate = rate
    this.applyToLive()
  }

  setPitch(pitch: VoicePitch) {
    this.pitch = pitch
    this.applyToLive()
  }

  /** @deprecated გამოიყენე setPitch('low' | 'normal') */
  setLowPitch(low: boolean) {
    this.setPitch(low ? 'low' : 'normal')
  }

  setVolume(volume: number) {
    this.volume = volume
    this.applyToLive()
  }

  private applyToLive() {
    this.cache.forEach((audio) => this.applyRate(audio))
    if (this.player) this.applyRate(this.player)
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

  /** mid — თბილი, ღრმა, გლუვი ტემბრი (pitch-ის დაწევის გარეშე). ერთი საერთო AudioContext. */
  private ensureWarmChain(audio: HTMLAudioElement): WarmChain | null {
    if (this.pitch !== 'mid' || this.warmFailed) return null

    const existing = this.warmChains.get(audio)
    if (existing) return existing

    const wired = (audio as HTMLAudioElement & { [WIRED]?: WarmChain })[WIRED]
    if (wired) {
      this.warmChains.set(audio, wired)
      return wired
    }

    const ctx = this.ensureContext()
    if (!ctx) return null

    let source: MediaElementAudioSourceNode
    try {
      source = ctx.createMediaElementSource(audio)
    } catch (err) {
      console.error('[audio] warm chain failed', err)
      this.warmFailed = true
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

    const loud = ctx.createGain()
    loud.gain.value = VOICE_GAIN

    source
      .connect(depth)
      .connect(chest)
      .connect(intimacy)
      .connect(soften)
      .connect(darken)
      .connect(smooth)
      .connect(loud)
      .connect(ctx.destination)

    const chain: WarmChain = { ctx, resume: () => ctx.resume() }
    ;(audio as HTMLAudioElement & { [WIRED]?: WarmChain })[WIRED] = chain
    this.warmChains.set(audio, chain)
    return chain
  }

  private ensureContext(): AudioContext | null {
    if (this.sharedCtx && this.sharedCtx.state !== 'closed') return this.sharedCtx
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    try {
      this.sharedCtx = new Ctx()
      return this.sharedCtx
    } catch (err) {
      console.error('[audio] AudioContext failed', err)
      this.warmFailed = true
      this.sharedCtx = null
      return null
    }
  }

  private async resumeSharedContext(): Promise<void> {
    const ctx = this.pitch === 'mid' && !this.warmFailed ? this.ensureContext() : null
    if (!ctx || ctx.state !== 'suspended') return
    try {
      await Promise.race([
        ctx.resume(),
        new Promise((resolve) => window.setTimeout(resolve, 300)),
      ])
    } catch (err) {
      console.error('[audio] AudioContext.resume failed', err)
    }
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
    return this.startSpeech(text, pinId)
  }

  private startSpeech(text: string, pinId: string): boolean {
    if (!text || typeof window.speechSynthesis?.speak !== 'function') return false
    try {
      const utter = new SpeechSynthesisUtterance(text)
      utter.lang = 'ka-GE'
      utter.rate = 0.95
      utter.pitch = 1
      const voice = pickGeorgianVoice()
      if (voice) utter.voice = voice
      this.speechDone = new Promise((resolve) => {
        this.finishSpeech = resolve
        utter.onend = () => resolve()
        utter.onerror = (event) => {
          console.error('[audio] speech error', pinId, event)
          resolve()
        }
      })
      window.speechSynthesis.speak(utter)
      return true
    } catch (err) {
      console.error('[audio] speech failed', pinId, err)
      this.speechDone = null
      this.finishSpeech = null
      return false
    }
  }

  /**
   * Queue a clip. Resolves true once playback has started (not when it ends).
   * The next clip waits until this one finishes. The same pinId is not queued twice.
   */
  play(url: string | null | undefined, pinId: string, fallbackText: string): Promise<boolean> {
    if (this.currentPinId === pinId || this.queue.some((job) => job.pinId === pinId)) {
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      this.queue.push({ url: url || null, pinId, fallbackText, resolve })
      void this.drain()
    })
  }

  stopAll() {
    this.generation += 1
    this.currentPinId = null
    const dropped = this.queue.splice(0)
    for (const job of dropped) job.resolve(false)
    this.player?.pause()
    if (this.player && this.player.readyState >= 1) {
      try {
        this.player.currentTime = 0
      } catch (err) {
        console.warn('[audio] stop seek failed', err)
      }
    }
    this.cache.forEach((audio) => {
      audio.pause()
    })
    for (const wake of this.stopWaiters) wake()
    this.stopWaiters.clear()
    this.finishSpeech?.()
    this.finishSpeech = null
    this.speechDone = null
    window.speechSynthesis?.cancel()
  }

  private async drain() {
    if (this.draining) return
    this.draining = true
    const token = this.generation
    try {
      while (this.queue.length > 0 && this.generation === token) {
        const job = this.queue.shift()
        if (!job) break
        this.currentPinId = job.pinId
        this.speechDone = null
        const started = await this.startJob(job, token)
        job.resolve(started)
        if (started && this.generation === token) {
          const speech = this.speechDone
          if (speech) await this.withCap(speech, 15000)
          else await this.waitForCurrentEnd(token)
        }
        if (this.currentPinId === job.pinId) this.currentPinId = null
      }
    } finally {
      this.draining = false
      this.currentPinId = null
      if (this.queue.length > 0) void this.drain()
    }
  }

  private async startJob(job: QueueJob, token: number): Promise<boolean> {
    if (job.url) {
      try {
        await this.startClip(job.url, token)
        if (token !== this.generation) return false
        return true
      } catch (err) {
        if (token !== this.generation) return false
        console.error('[audio] playback failed', { pinId: job.pinId, url: job.url, err })
        this.player?.pause()
      }
    } else if (!job.fallbackText) {
      console.error('[audio] nothing to play', job.pinId)
      return false
    }

    if (token !== this.generation) return false
    const spoke = this.startSpeech(job.fallbackText, job.pinId)
    if (!spoke) console.error('[audio] fallback speech unavailable', job.pinId, job.fallbackText)
    return spoke
  }

  private ensurePlayer(): HTMLAudioElement {
    if (!this.player) {
      this.player = new Audio()
      this.player.preload = 'auto'
      this.applyRate(this.player)
    }
    return this.player
  }

  private sameSource(audio: HTMLAudioElement, url: string): boolean {
    if (audio.src === url) return true
    try {
      return audio.src === new URL(url, window.location.href).href
    } catch {
      return false
    }
  }

  private async startClip(url: string, token: number): Promise<void> {
    const audio = this.ensurePlayer()
    if (!this.sameSource(audio, url)) {
      audio.src = url
      audio.load()
    }
    if (audio.readyState < 1) await this.waitForMetadata(audio, token)
    if (token !== this.generation) throw new Error('audio stopped')
    if (audio.readyState >= 1) {
      try {
        audio.currentTime = 0
      } catch (err) {
        console.warn('[audio] seek failed', url, err)
      }
    }
    this.applyRate(audio)
    this.ensureWarmChain(audio)
    await this.resumeSharedContext()
    if (token !== this.generation) throw new Error('audio stopped')
    await audio.play()
  }

  private waitForMetadata(audio: HTMLAudioElement, token: number): Promise<void> {
    if (audio.readyState >= 1) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error('audio load timeout'))
      }, 8000)
      const ok = () => {
        cleanup()
        resolve()
      }
      const bad = () => {
        cleanup()
        reject(new Error('audio load error'))
      }
      const stop = () => {
        cleanup()
        reject(new Error('audio stopped'))
      }
      const cleanup = () => {
        window.clearTimeout(timer)
        audio.removeEventListener('loadedmetadata', ok)
        audio.removeEventListener('error', bad)
        this.stopWaiters.delete(stop)
      }
      this.stopWaiters.add(stop)
      audio.addEventListener('loadedmetadata', ok)
      audio.addEventListener('error', bad)
      if (token !== this.generation) stop()
    })
  }

  private withCap(pending: Promise<void>, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, ms)
      void pending.finally(() => {
        window.clearTimeout(timer)
        resolve()
      })
    })
  }

  private waitForCurrentEnd(token: number): Promise<void> {
    const audio = this.player
    if (!audio || token !== this.generation) return Promise.resolve()
    if (audio.ended) return Promise.resolve()
    return new Promise((resolve) => {
      let timer = 0
      const finish = () => {
        window.clearTimeout(timer)
        audio.removeEventListener('ended', finish)
        audio.removeEventListener('error', finish)
        this.stopWaiters.delete(finish)
        resolve()
      }
      timer = window.setTimeout(finish, 15000)
      this.stopWaiters.add(finish)
      audio.addEventListener('ended', finish)
      audio.addEventListener('error', finish)
      if (token !== this.generation || audio.ended) finish()
    })
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
