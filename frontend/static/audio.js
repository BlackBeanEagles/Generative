/* ─── Battle Audio Engine (Web Audio API synthesizer + event sound effects) ── */

(function () {
  const CONFIGS = [
    { bpm: 0,   gain: 0.00, label: "Idle" },
    { bpm: 88,  gain: 0.35, label: "Warming Up" },
    { bpm: 118, gain: 0.55, label: "Battle" },
    { bpm: 145, gain: 0.70, label: "Intense" },
    { bpm: 168, gain: 0.85, label: "LEGENDARY" },
  ];

  const KICK  = [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0];
  const SNARE = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1];
  const HIHAT = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1];
  const OPEN  = [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0];

  const BASS_NOTES = [55, 55, 73.4, 55, 61.7, 55, 73.4, 82.4];
  const LEAD_NOTES = [330, 392, 440, 494, 440, 392, 330, 294, 330, 370, 440, 370, 294, 330, 392, 330];

  class BattleAudio {
    constructor() {
      this._ctx = null;
      this._master = null;
      this._fxGain = null;
      this._intensity = 0;
      this._bpm = 120;
      this._step = 0;
      this._nextBeat = 0;
      this._rafId = null;
      this._playing = false;
      this._volumeOverride = 0.7;
    }

    _init() {
      if (this._ctx) return;
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._master = this._ctx.createGain();
      this._master.gain.value = 0;
      this._master.connect(this._ctx.destination);
      this._fxGain = this._ctx.createGain();
      this._fxGain.gain.value = 0.55;
      this._fxGain.connect(this._ctx.destination);
    }

    get intensity() { return this._intensity; }

    setVolume(v) {
      this._volumeOverride = Math.max(0, Math.min(1, v));
      if (this._master && this._intensity > 0) {
        const target = CONFIGS[this._intensity].gain * this._volumeOverride;
        this._master.gain.linearRampToValueAtTime(target, this._ctx.currentTime + 0.3);
      }
      if (this._fxGain) this._fxGain.gain.value = 0.55 * this._volumeOverride;
    }

    setIntensity(level) {
      this._init();
      const lvl = Math.max(0, Math.min(4, Math.round(level)));
      this._intensity = lvl;
      if (lvl === 0) { this._stop(); return; }
      this._bpm = CONFIGS[lvl].bpm;
      const targetGain = CONFIGS[lvl].gain * this._volumeOverride;
      this._master.gain.linearRampToValueAtTime(targetGain, this._ctx.currentTime + 0.6);
      if (!this._playing) this._start();
      window.dispatchEvent(new CustomEvent("audio-intensity", { detail: { level: lvl, label: CONFIGS[lvl].label } }));
    }

    _start() {
      if (this._ctx.state === "suspended") this._ctx.resume();
      this._playing = true;
      this._step = 0;
      this._nextBeat = this._ctx.currentTime + 0.05;
      this._schedule();
    }

    _stop() {
      this._playing = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      if (this._master) this._master.gain.linearRampToValueAtTime(0, this._ctx.currentTime + 0.4);
      window.dispatchEvent(new CustomEvent("audio-intensity", { detail: { level: 0, label: "Idle" } }));
    }

    _stepDur() { return 60 / this._bpm / 4; }

    _schedule() {
      if (!this._playing) return;
      while (this._nextBeat < this._ctx.currentTime + 0.18) {
        this._tick(this._step, this._nextBeat);
        this._step = (this._step + 1) % 16;
        this._nextBeat += this._stepDur();
      }
      this._rafId = requestAnimationFrame(() => this._schedule());
    }

    _tick(s, t) {
      const lvl = this._intensity;
      if (lvl >= 1 && KICK[s])  this._kick(t);
      if (lvl >= 2 && SNARE[s]) this._snare(t);
      if (lvl >= 2 && HIHAT[s]) this._hat(t, false);
      if (lvl >= 3 && OPEN[s])  this._hat(t, true);
      if (lvl >= 2 && s % 8 === 0) this._bass(t, BASS_NOTES[s / 8]);
      if (lvl >= 3 && s % 2 === 0) this._lead(t, LEAD_NOTES[s]);
      if (lvl >= 4 && s % 4 === 0) this._lead(t, LEAD_NOTES[(s + 2) % 16], true);
    }

    _kick(t) {
      const o = this._ctx.createOscillator(), g = this._ctx.createGain();
      o.connect(g); g.connect(this._master);
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(0.001, t + 0.45);
      g.gain.setValueAtTime(1.8, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.start(t); o.stop(t + 0.45);
    }

    _snare(t) {
      const sr = this._ctx.sampleRate, len = Math.floor(sr * 0.14);
      const buf = this._ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const n = this._ctx.createBufferSource();
      n.buffer = buf;
      const f = this._ctx.createBiquadFilter();
      f.type = "highpass"; f.frequency.value = 1200;
      const g = this._ctx.createGain();
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      n.connect(f); f.connect(g); g.connect(this._master);
      n.start(t); n.stop(t + 0.14);
      const o = this._ctx.createOscillator(), og = this._ctx.createGain();
      o.frequency.value = 185;
      og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(og); og.connect(this._master);
      o.start(t); o.stop(t + 0.08);
    }

    _hat(t, open) {
      const sr = this._ctx.sampleRate, dur = open ? 0.28 : 0.038;
      const len = Math.floor(sr * dur);
      const buf = this._ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const n = this._ctx.createBufferSource(); n.buffer = buf;
      const f = this._ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 9000; f.Q.value = 0.4;
      const g = this._ctx.createGain();
      g.gain.setValueAtTime(open ? 0.35 : 0.28, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      n.connect(f); f.connect(g); g.connect(this._master);
      n.start(t); n.stop(t + dur);
    }

    _bass(t, freq) {
      const o = this._ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = freq;
      const f = this._ctx.createBiquadFilter(); f.type = "lowpass";
      f.frequency.value = 300 + this._intensity * 80;
      const g = this._ctx.createGain();
      g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(f); f.connect(g); g.connect(this._master);
      o.start(t); o.stop(t + 0.35);
    }

    _lead(t, freq, harmony = false) {
      const o = this._ctx.createOscillator();
      o.type = this._intensity >= 4 ? "square" : "triangle";
      o.frequency.value = harmony ? freq * 1.5 : freq;
      const g = this._ctx.createGain();
      const vol = harmony ? 0.08 : 0.13;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g); g.connect(this._master);
      o.start(t); o.stop(t + 0.1);
    }

    /* ── Sound effects (event-driven, bypass music master gain) ──────────── */

    playEffect(name) {
      this._init();
      if (this._ctx.state === "suspended") this._ctx.resume();
      const t = this._ctx.currentTime + 0.01;
      const v = 0.55 * this._volumeOverride;
      switch (name) {
        case "combo":              this._fx_combo(t, v);           break;
        case "challenge_start":    this._fx_challenge_start(t, v); break;
        case "challenge_complete": this._fx_fanfare(t, v);         break;
        case "new_expression":     this._fx_ping(t, v);            break;
        case "neutral_penalty":    this._fx_penalty(t, v);         break;
        case "streak_5":           this._fx_streak(t, v);          break;
        case "win":                this._fx_win(t, v);             break;
        case "crowd_vote":         this._fx_crowd(t, v);           break;
        case "countdown_tick":     this._fx_tick(t, v);            break;
      }
    }

    _tone(t, freq, type, vol, dur, dest) {
      const o = this._ctx.createOscillator(), g = this._ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(dest || this._fxGain);
      o.start(t); o.stop(t + dur + 0.02);
    }

    _fx_combo(t, v) {
      // C5-E5-G5 ascending arpeggio — satisfying "success"
      [523, 659, 784].forEach((freq, i) => this._tone(t + i * 0.07, freq, "triangle", v * 0.7, 0.14));
    }

    _fx_challenge_start(t, v) {
      // 3 urgent staccato pulses — "attention!"
      [880, 880, 1174].forEach((freq, i) => this._tone(t + i * 0.12, freq, "square", v * 0.35, 0.08));
    }

    _fx_fanfare(t, v) {
      // C5-E5-G5-C6 triumphant fanfare — challenge complete
      [523, 659, 784, 1047].forEach((freq, i) => {
        const dur = i === 3 ? 0.45 : 0.12;
        this._tone(t + i * 0.1, freq, i < 3 ? "square" : "triangle", v * (i === 3 ? 0.7 : 0.4), dur);
      });
    }

    _fx_ping(t, v) {
      // Soft bell — new expression discovered
      this._tone(t, 1047, "sine", v * 0.6, 0.35);
    }

    _fx_penalty(t, v) {
      // Descending buzz — neutral penalty
      [220, 165].forEach((freq, i) => {
        const o = this._ctx.createOscillator(), f = this._ctx.createBiquadFilter(), g = this._ctx.createGain();
        o.type = "sawtooth"; o.frequency.value = freq;
        f.type = "lowpass"; f.frequency.value = 550;
        const start = t + i * 0.15;
        g.gain.setValueAtTime(v * 0.45, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
        o.connect(f); f.connect(g); g.connect(this._fxGain);
        o.start(start); o.stop(start + 0.22);
      });
    }

    _fx_streak(t, v) {
      // Rapid C-D-E-G-A pentatonic run — streak milestone
      [523, 587, 659, 784, 880].forEach((freq, i) => this._tone(t + i * 0.055, freq, "triangle", v * 0.5, 0.1));
    }

    _fx_win(t, v) {
      // Ascending fanfare + held chord — game end victory
      [523, 659, 784, 1047].forEach((freq, i) => {
        const dur = i === 3 ? 0.55 : 0.14;
        this._tone(t + i * 0.12, freq, i < 3 ? "square" : "triangle", v * 0.45, dur);
      });
      // Harmony on final note
      [659, 784].forEach(freq => this._tone(t + 0.36, freq, "triangle", v * 0.22, 0.55));
    }

    _fx_crowd(t, v) {
      // Filtered noise burst — crowd appreciation cheer
      const sr = this._ctx.sampleRate, dur = 0.42;
      const buf = this._ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const n = this._ctx.createBufferSource(); n.buffer = buf;
      const f = this._ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1200; f.Q.value = 0.6;
      const g = this._ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v * 0.55, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      n.connect(f); f.connect(g); g.connect(this._fxGain);
      n.start(t); n.stop(t + dur + 0.05);
      // Add rising pitch whoop
      this._tone(t + 0.05, 440, "sine", v * 0.25, 0.22);
    }

    _fx_tick(t, v) {
      // Metronome tick — countdown last 5 seconds
      this._tone(t, 1760, "triangle", v * 0.28, 0.04);
    }

    unlock() {
      this._init();
      if (this._ctx.state === "suspended") this._ctx.resume();
    }
  }

  window.battleAudio = new BattleAudio();
})();
