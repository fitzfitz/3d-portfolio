import { flight, useSpaceStore } from "../store/spaceStore";

/**
 * Fully synthesized Web Audio soundscape. No assets, no React.
 * Inert no-op if AudioContext is unavailable or construction throws.
 * init() must be called from a user gesture (browser autoplay policy).
 */
class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private warpGain: GainNode | null = null;
  private muted = false;
  private rafId: number | null = null;

  init() {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);

      // Engine hum: looped brown-noise buffer -> lowpass -> gain
      const noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 200;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      noise.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
      noise.start();

      // Warp layer: detuned saw pair -> gain (0 until warping)
      this.warpGain = this.ctx.createGain();
      this.warpGain.gain.value = 0;
      for (const detune of [-7, 7]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = 55;
        osc.detune.value = detune;
        osc.connect(this.warpGain);
        osc.start();
      }
      const warpFilter = this.ctx.createBiquadFilter();
      warpFilter.type = "lowpass";
      warpFilter.frequency.value = 400;
      this.warpGain.connect(warpFilter).connect(this.master);

      // Ambient pad: two slow detuned oscillators, barely audible
      const padGain = this.ctx.createGain();
      padGain.gain.value = 0;
      padGain.gain.setTargetAtTime(0.03, this.ctx.currentTime, 4);
      for (const [type, freq] of [["sine", 65.4], ["triangle", 98.0]] as const) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        osc.detune.value = Math.random() * 6 - 3;
        osc.connect(padGain);
        osc.start();
      }
      padGain.connect(this.master);
    } catch {
      this.ctx = null; // stay inert forever
    }
  }

  setMuted(v: boolean) {
    this.muted = v;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(v ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  startLoop() {
    if (this.rafId !== null) return;
    const tick = () => {
      if (this.ctx && this.engineFilter && this.engineGain && this.warpGain) {
        const t = this.ctx.currentTime;
        const speedNorm = Math.min(1, flight.speed / 10.8);
        this.engineFilter.frequency.setTargetAtTime(200 + speedNorm * 700, t, 0.1);
        this.engineGain.gain.setTargetAtTime(speedNorm * 0.08, t, 0.15);
        const warping = useSpaceStore.getState().isWarping;
        this.warpGain.gain.setTargetAtTime(warping ? 0.06 : 0, t, warping ? 0.08 : 0.25);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private blip(type: OscillatorType, freq: number, dur: number, vol: number, sweepTo?: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Orbit lock: two-note minor-third chime */
  chime() {
    this.blip("sine", 659.25, 0.5, 0.1);
    setTimeout(() => this.blip("sine", 783.99, 0.7, 0.1), 120);
  }
  /** Orbit break: low thunk */
  thunk() {
    this.blip("triangle", 130, 0.18, 0.12, 70);
  }
  /** Boundary-wrap teleport: descending zap */
  zap() {
    this.blip("sawtooth", 1200, 0.3, 0.06, 180);
  }
  /** Chatter line tick */
  uiTick() {
    this.blip("square", 880, 0.04, 0.025);
  }
}

export const soundManager = new SoundManager();
