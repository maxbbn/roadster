// Small synthesized sound layer: electric motor whine, vacuum fan, thruster hiss and one-shot effects.

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private motorA!: OscillatorNode;
  private motorB!: OscillatorNode;
  private motorGain!: GainNode;
  private motorFilter!: BiquadFilterNode;
  private fanGain!: GainNode;
  private fanFilter!: BiquadFilterNode;
  private jetGain!: GainNode;
  private muted = false;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.45;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.value = 1800;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorA = ctx.createOscillator();
    this.motorA.type = 'sawtooth';
    this.motorB = ctx.createOscillator();
    this.motorB.type = 'sine';
    const bGain = ctx.createGain();
    bGain.gain.value = 0.6;
    this.motorA.connect(this.motorFilter);
    this.motorB.connect(bGain).connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.master);
    this.motorA.start();
    this.motorB.start();

    const noise = this.noiseBuffer();
    const fanSrc = ctx.createBufferSource();
    fanSrc.buffer = noise;
    fanSrc.loop = true;
    this.fanFilter = ctx.createBiquadFilter();
    this.fanFilter.type = 'bandpass';
    this.fanFilter.frequency.value = 900;
    this.fanFilter.Q.value = 3;
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 0;
    fanSrc.connect(this.fanFilter).connect(this.fanGain).connect(this.master);
    fanSrc.start();

    const jetSrc = ctx.createBufferSource();
    jetSrc.buffer = noise;
    jetSrc.loop = true;
    const jetFilter = ctx.createBiquadFilter();
    jetFilter.type = 'highpass';
    jetFilter.frequency.value = 600;
    this.jetGain = ctx.createGain();
    this.jetGain.gain.value = 0;
    jetSrc.connect(jetFilter).connect(this.jetGain).connect(this.master);
    jetSrc.start();
  }

  private noiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.45, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  update(speed: number, throttle: number, fan: number, jet: number, active: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.abs(speed);
    const f = 70 + s * 14;
    this.motorA.frequency.setTargetAtTime(f, t, 0.05);
    this.motorB.frequency.setTargetAtTime(f * 2.01, t, 0.05);
    this.motorFilter.frequency.setTargetAtTime(600 + s * 60 + Math.abs(throttle) * 600, t, 0.08);
    const mg = active ? 0.025 + Math.min(1, s / 30) * 0.05 + Math.abs(throttle) * 0.03 : 0;
    this.motorGain.gain.setTargetAtTime(mg, t, 0.08);
    this.fanGain.gain.setTargetAtTime(active ? fan * 0.22 : 0, t, 0.1);
    this.fanFilter.frequency.setTargetAtTime(700 + fan * 500, t, 0.1);
    this.jetGain.gain.setTargetAtTime(active ? jet * 0.3 : 0, t, 0.04);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0, delay = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, gain: number, freq: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + dur);
  }

  collect(): void {
    this.tone(880, 0.12, 'sine', 0.18);
    this.tone(1320, 0.18, 'sine', 0.14, 0, 0.06);
  }
  fuel(): void {
    this.tone(440, 0.2, 'triangle', 0.18, 400);
  }
  checkpoint(): void {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.15, 0, i * 0.08));
  }
  jump(): void {
    this.burst(0.25, 0.25, 2400);
  }
  land(impact: number): void {
    this.burst(0.18, Math.min(0.5, impact * 0.03), 600);
  }
  clunk(): void {
    this.tone(160, 0.12, 'square', 0.08, -60);
  }
  mode(on: boolean): void {
    this.tone(on ? 500 : 700, 0.15, 'sine', 0.12, on ? 500 : -300);
  }
  explode(): void {
    this.burst(1.2, 0.8, 3000);
    this.tone(90, 0.8, 'sawtooth', 0.2, -60);
  }
  finish(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.16, 0, i * 0.12));
  }
}
