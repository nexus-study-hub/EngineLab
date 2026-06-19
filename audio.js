/**
 * audio.js — EngineLab synthesized engine sound.
 *
 * No samples are used: the engine note is built additively from harmonics of
 * the cylinder firing frequency, crossfaded across four "layers" (idle / low /
 * mid / high RPM) using bump-shaped gain curves, plus separate intake,
 * exhaust, turbo-whistle and rev-limiter chains. One-shot transients (gear
 * click, backfire, blow-off) reuse a shared noise buffer.
 *
 * All continuous parameters are updated every animation frame via
 * AudioParam.setTargetAtTime for zipper-free, smoothly glissandoing pitch
 * and crossfades — this is what makes the RPM sweep feel analog rather than
 * stepped.
 */

class EngineAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.masterVolume = 0.8;
    this.mode = "exterior"; // 'exterior' | 'interior'
  }

  /** Must be called from a user gesture (click / keydown) to satisfy autoplay policies. */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.15;

    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = "lowpass";
    this.cabinFilter.frequency.value = 20000;

    this.master.connect(this.cabinFilter);
    this.cabinFilter.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 1;
    this.chopGain = ctx.createGain();
    this.chopGain.gain.value = 1;
    this.engineBus.connect(this.chopGain);
    this.chopGain.connect(this.master);

    this.fxBus = ctx.createGain();
    this.fxBus.gain.value = 1;
    this.fxBus.connect(this.master);

    this._buildNoiseBuffer();
    this._buildHarmonicBank();
    this._buildLayerFilters();
    this._buildIntakeExhaust();
    this._buildTurbo();

    this.ready = true;
  }

  _buildNoiseBuffer() {
    const ctx = this.ctx;
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  _newNoiseSource(loop = true) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = loop;
    return src;
  }

  _buildHarmonicBank() {
    const ctx = this.ctx;
    const harmonics = [1, 2, 3, 4, 6, 8, 12];
    this.harmonicOscs = harmonics.map((mult, i) => {
      const osc = ctx.createOscillator();
      osc.type = i < 3 ? "sawtooth" : "square";
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      osc.start();
      return { osc, gain, mult, baseAmp: 1 / Math.pow(mult, 1.15) };
    });

    this.lopeLfo = ctx.createOscillator();
    this.lopeLfo.frequency.value = 7;
    this.lopeDepth = ctx.createGain();
    this.lopeDepth.gain.value = 0;
    this.lopeLfo.connect(this.lopeDepth);
    this.lopeLfo.start();

    this.harmonicSum = ctx.createGain();
    this.harmonicSum.gain.value = 1;
    this.harmonicOscs.forEach(h => h.gain.connect(this.harmonicSum));
  }

  _buildLayerFilters() {
    const ctx = this.ctx;
    const specs = [
      { name: "idle", type: "lowpass", freq: 900, Q: 0.6 },
      { name: "low", type: "bandpass", freq: 450, Q: 0.9 },
      { name: "mid", type: "bandpass", freq: 1100, Q: 1.1 },
      { name: "high", type: "bandpass", freq: 2400, Q: 1.4 }
    ];
    this.layers = {};
    specs.forEach(spec => {
      const filter = ctx.createBiquadFilter();
      filter.type = spec.type;
      filter.frequency.value = spec.freq;
      filter.Q.value = spec.Q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const shaper = ctx.createWaveShaper();
      shaper.curve = this._gritCurve(0.3);
      this.harmonicSum.connect(filter);
      filter.connect(shaper);
      shaper.connect(gain);
      gain.connect(this.engineBus);
      this.layers[spec.name] = { filter, gain, shaper };
    });
  }

  _gritCurve(amount) {
    const n = 256;
    const curve = new Float32Array(n);
    const k = amount * 50;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  _buildIntakeExhaust() {
    const ctx = this.ctx;

    this.intakeSrc = this._newNoiseSource(true);
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = "bandpass";
    this.intakeFilter.frequency.value = 1400;
    this.intakeFilter.Q.value = 0.8;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intakeSrc.connect(this.intakeFilter);
    this.intakeFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.engineBus);
    this.intakeSrc.start();

    this.exhaustSrc = this._newNoiseSource(true);
    this.exhaustFilter = ctx.createBiquadFilter();
    this.exhaustFilter.type = "lowpass";
    this.exhaustFilter.frequency.value = 220;
    this.exhaustGain = ctx.createGain();
    this.exhaustGain.gain.value = 0;
    this.exhaustSrc.connect(this.exhaustFilter);
    this.exhaustFilter.connect(this.exhaustGain);
    this.exhaustGain.connect(this.engineBus);
    this.exhaustSrc.start();

    this.subOsc = ctx.createOscillator();
    this.subOsc.type = "sine";
    this.subOsc.frequency.value = 50;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0;
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.engineBus);
    this.subOsc.start();
  }

  _buildTurbo() {
    const ctx = this.ctx;
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = "sine";
    this.turboOsc.frequency.value = 900;
    this.turboFilter = ctx.createBiquadFilter();
    this.turboFilter.type = "bandpass";
    this.turboFilter.Q.value = 6;
    this.turboFilter.frequency.value = 1800;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboFilter);
    this.turboFilter.connect(this.turboGain);
    this.turboGain.connect(this.engineBus);
    this.turboOsc.start();
  }

  /** Apply a new car's sound DNA — grit curve, harmonic spread, turbo presence. */
  loadCar(car) {
    if (!this.ready) return;
    this.car = car;
    const grit = car.sound.grit;
    Object.values(this.layers).forEach(l => {
      l.shaper.curve = this._gritCurve(0.15 + grit * 0.5);
    });
    this._lastBoost = 0;
  }

  setMuted(m) { this.muted = m; this._applyMasterGain(); }
  setVolume(v) { this.masterVolume = v; this._applyMasterGain(); }
  _applyMasterGain() {
    if (!this.ready) return;
    const target = this.muted ? 0 : this.masterVolume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.cabinFilter.frequency.setTargetAtTime(mode === "interior" ? 1800 : 20000, now, 0.15);
  }

  static bump(x, center, width) {
    const d = (x - center) / width;
    return Math.exp(-d * d * 2.2);
  }

  update(snap) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const car = snap.car;
    const sound = car.sound;
    const T = 0.045;

    if (!snap.running) {
      this.harmonicOscs.forEach(h => h.gain.gain.setTargetAtTime(0, now, 0.2));
      Object.values(this.layers).forEach(l => l.gain.gain.setTargetAtTime(0, now, 0.2));
      this.intakeGain.gain.setTargetAtTime(0, now, 0.2);
      this.exhaustGain.gain.setTargetAtTime(0, now, 0.2);
      this.subGain.gain.setTargetAtTime(0, now, 0.2);
      this.turboGain.gain.setTargetAtTime(0, now, 0.2);
      this.chopGain.gain.setTargetAtTime(1, now, 0.1);
      if (this.hasCustomSample) this.customGain.gain.setTargetAtTime(0, now, 0.2);
      return;
    }

    const rpmFrac = Math.min(1, snap.rpmFrac);
    const throttle = snap.throttle;
    const cylinders = car.cylinders;
    const firingHz = (snap.rpm / 60) * (cylinders / 2);

    const ampBase = 0.05 + throttle * 0.22 + 0.05;
    this.harmonicOscs.forEach(h => {
      const f = clamp(firingHz * h.mult, 20, 9000);
      h.osc.frequency.setTargetAtTime(f, now, T);
      const rolloff = h.mult <= 3 ? 1 : 1 - rpmFrac * 0.15;
      const amp = h.baseAmp * ampBase * sound.harmonicSpread * rolloff;
      h.gain.gain.setTargetAtTime(amp, now, T);
    });

    const lopeAmt = (1 - Math.min(1, rpmFrac / 0.25)) * 6;
    this.lopeDepth.gain.setTargetAtTime(lopeAmt, now, 0.1);

    const idleW = EngineAudio.bump(rpmFrac, 0.0, 0.10);
    const lowW = EngineAudio.bump(rpmFrac, 0.22, 0.18);
    const midW = EngineAudio.bump(rpmFrac, 0.52, 0.22);
    const highW = EngineAudio.bump(rpmFrac, 0.95, 0.30) * (0.55 + sound.screamFactor * 0.6);

    const loadFactor = 0.35 + throttle * 0.65;
    this.layers.idle.gain.gain.setTargetAtTime(idleW * 0.55, now, T);
    this.layers.low.gain.gain.setTargetAtTime(lowW * loadFactor * 0.9, now, T);
    this.layers.mid.gain.gain.setTargetAtTime(midW * loadFactor, now, T);
    this.layers.high.gain.gain.setTargetAtTime(highW * loadFactor * 1.05, now, T);

    this.layers.low.filter.frequency.setTargetAtTime(300 + rpmFrac * 700, now, T);
    this.layers.mid.filter.frequency.setTargetAtTime(700 + rpmFrac * 1800, now, T);
    this.layers.high.filter.frequency.setTargetAtTime(1600 + rpmFrac * 3600, now, T);

    const intakeFreq = 700 + rpmFrac * 3200;
    this.intakeFilter.frequency.setTargetAtTime(intakeFreq, now, T);
    this.intakeGain.gain.setTargetAtTime(throttle * (0.06 + rpmFrac * 0.10), now, T);

    this.exhaustFilter.frequency.setTargetAtTime(120 + rpmFrac * 260, now, T);
    this.exhaustGain.gain.setTargetAtTime((0.05 + throttle * 0.16) * (0.6 + sound.subBass), now, T);
    this.subOsc.frequency.setTargetAtTime(Math.max(28, firingHz * 0.5), now, T);
    this.subGain.gain.setTargetAtTime((0.04 + throttle * 0.10) * sound.subBass * 2.2, now, T);

    if (sound.turbo) {
      const boostThreshold = sound.boostThreshold ?? 0.3;
      const boost = clamp((rpmFrac - boostThreshold) / (1 - boostThreshold), 0, 1) * clamp(throttle * 1.3, 0, 1);
      const smoothBoost = this._lastBoost = lerp(this._lastBoost ?? 0, boost, 0.12);
      this.turboOsc.frequency.setTargetAtTime(700 + smoothBoost * 2600 + rpmFrac * 600, now, T);
      this.turboFilter.frequency.setTargetAtTime(900 + smoothBoost * 2800, now, T);
      this.turboGain.gain.setTargetAtTime(smoothBoost * 0.10, now, T);
    } else {
      this.turboGain.gain.setTargetAtTime(0, now, T);
    }

    if (snap.limiterActive) {
      const chop = 0.25 + 0.75 * Math.abs(Math.sin(now * 46));
      this.chopGain.gain.setTargetAtTime(chop, now, 0.01);
    } else {
      this.chopGain.gain.setTargetAtTime(1, now, 0.08);
    }

    if (snap.shiftFlash) this.triggerShiftClick();
    if (snap.backfire) this.triggerBackfire();
    this._updateCustomSample(snap, now, T);
  }

  triggerShiftClick() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this._lastClick && now - this._lastClick < 0.08) return;
    this._lastClick = now;
    const src = this._newNoiseSource(false);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    src.connect(filter); filter.connect(gain); gain.connect(this.fxBus);
    src.start(now); src.stop(now + 0.06);
  }

  triggerBackfire() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = this._newNoiseSource(false);
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1400 + Math.random() * 800;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    src.connect(filter); filter.connect(gain); gain.connect(this.fxBus);
    src.start(now); src.stop(now + 0.2);

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.4, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(og); og.connect(this.fxBus);
    osc.start(now); osc.stop(now + 0.2);
  }

  /**
   * Bonus feature: blend in a user-uploaded sample. The sample loops
   * continuously with its playback rate driven by RPM (so it pitches the
   * same way the synthesized layers do) and its gain driven by throttle.
   */
  loadCustomSample(audioBuffer) {
    if (!this.ready) return;
    const ctx = this.ctx;
    if (this.customSrc) {
      try { this.customSrc.stop(); } catch (e) { /* already stopped */ }
      this.customSrc.disconnect();
    }
    if (!this.customGain) {
      this.customGain = ctx.createGain();
      this.customGain.gain.value = 0;
      this.customGain.connect(this.engineBus);
    }
    this.customSrc = ctx.createBufferSource();
    this.customSrc.buffer = audioBuffer;
    this.customSrc.loop = true;
    this.customSrc.playbackRate.value = 1;
    this.customSrc.connect(this.customGain);
    this.customSrc.start();
    this.hasCustomSample = true;
  }

  clearCustomSample() {
    if (this.customSrc) {
      try { this.customSrc.stop(); } catch (e) { /* already stopped */ }
    }
    this.hasCustomSample = false;
    if (this.customGain) this.customGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  _updateCustomSample(snap, now, T) {
    if (!this.hasCustomSample || !this.customSrc) return;
    const rpmFrac = Math.min(1, snap.rpmFrac);
    const rate = 0.55 + rpmFrac * 1.7;
    this.customSrc.playbackRate.setTargetAtTime(rate, now, T);
    const gain = snap.running ? 0.05 + snap.throttle * 0.22 : 0;
    this.customGain.gain.setTargetAtTime(gain, now, T);
  }

  triggerBlowoff() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = this._newNoiseSource(false);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 3000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    src.connect(filter); filter.connect(gain); gain.connect(this.fxBus);
    src.start(now); src.stop(now + 0.4);
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
