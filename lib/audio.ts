/**
 * Cozy Web Audio Sound Synthesizer
 * Generates soothing chime, singing bowl, and gentle bell sounds
 * completely in-browser without external audio asset dependencies.
 */

class SoundEngine {
  private ctx: AudioContext | null = null

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
    return this.ctx
  }

  /**
   * Soothing Tibetan singing bowl / meditation chime for focus session completion
   */
  playFocusComplete() {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const frequencies = [528, 792, 1056] // Solfeggio 528Hz love/miracle harmonic tone

    frequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)

      const baseGain = idx === 0 ? 0.28 : 0.12 / (idx + 1)
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(baseGain, now + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now + idx * 0.06)
      osc.stop(now + 3.3)
    })
  }

  /**
   * Cheerful two-tone wind chime for break ending
   */
  playBreakComplete() {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const notes = [659.25, 880, 1318.51] // E5, A5, E6

    notes.forEach((freq, idx) => {
      const startTime = now + idx * 0.18
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, startTime)

      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.8)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(startTime)
      osc.stop(startTime + 1.9)
    })
  }

  /**
   * Gentle soft click for UI interaction
   */
  playSoftClick() {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(440, now)
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.04)

    gain.gain.setValueAtTime(0.08, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.05)
  }
}

export const soundEngine = new SoundEngine()
