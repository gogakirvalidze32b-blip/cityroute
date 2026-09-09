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

/** ხმის სიმაღლე (volume): 0 = ჩუმი · 1 = სრული */
export const VOICE_VOLUME = 1

const WIRED = Symbol('cityroute-audio-wired')

type WarmChain = {
  ctx: AudioContext
  resume: () => Promise<void>
}

export class AudioEngine {
  private cache = new Map<string, HTMLAudioElement>()
  private speaking = new Set<string>()
  private playbackRate = VOICE_PLAYBACK_RATE
  private pitch: VoicePitch = VOICE_PITCH
  private volume = VOICE_VOLUME
  private warmChains = new WeakMap<HTMLAudioElement, WarmChain>()

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

  /** mid — თბილი, ღრმა, გლუვი ტემბრი (pitch-ის დაწევის გარეშე). */
  private ensureWarmChain(audio: HTMLAudioElement): WarmChain | null {
    if (this.pitch !== 'mid') return null

    const existing = this.warmChains.get(audio)
    if (existing) return existing

    const wired = (audio as HTMLAudioElement & { [WIRED]?: WarmChain })[WIRED]
    if (wired) {
      this.warmChains.set(audio, wired)
      return wired
    }

    const ctx = new AudioContext()

    let source: MediaElementAudioSourceNode
    try {
      source = ctx.createMediaElementSource(audio)
    } catch {
      ctx.close()
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

    source
      .connect(depth)
      .connect(chest)
      .connect(intimacy)
      .connect(soften)
      .connect(darken)
      .connect(smooth)
      .connect(ctx.destination)

    const chain: WarmChain = { ctx, resume: () => ctx.resume() }
    ;(audio as HTMLAudioElement & { [WIRED]?: WarmChain })[WIRED] = chain
    this.warmChains.set(audio, chain)
    return chain
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
    utter.rate = 0.95
    utter.pitch = 1
    const voice = pickGeorgianVoice()
    if (voice) utter.voice = voice
    this.speaking.add(pinId)
    utter.onend = () => this.speaking.delete(pinId)
    utter.onerror = () => this.speaking.delete(pinId)
    window.speechSynthesis.speak(utter)
    return true
  }

  async play(url: string | null | undefined, pinId: string, fallbackText: string): Promise<boolean> {
    if (this.speaking.has(pinId)) return false

    if (url) {
      let audio = this.cache.get(url)
      if (!audio) {
        audio = new Audio(url)
        this.cache.set(url, audio)
      }
      try {
        audio.currentTime = 0
        this.applyRate(audio)
        const warm = this.ensureWarmChain(audio)
        if (warm) await warm.resume()

        this.speaking.add(pinId)
        audio.onended = () => this.speaking.delete(pinId)
        audio.onerror = () => {
          this.speaking.delete(pinId)
          this.speakText(fallbackText, pinId)
        }
        await audio.play()
        return true
      } catch {
        this.speaking.delete(pinId)
      }
    }

    return this.speakText(fallbackText, pinId)
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
