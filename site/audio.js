// Procedural techno soundtrack and sound effects for THE CONSTRUCT.
// Everything is synthesized with Web Audio at runtime: oscillators, filtered
// noise, a generated reverb impulse and a dub delay. No audio files ship.
//
// The music is a 4-bar step sequencer (kick, hats, clap, acid bass, stabs,
// arp lead, drone) whose layers switch on as the level rises. It follows the
// core's time scale, so bullet time slows the tempo and pitch and closes a
// low-pass filter over the whole mix. The Architect level swaps to a darker
// pattern. Sound effects fire from the core's event bitmask.

export function createAudio() {
  const S = { level: 1, timeScale: 1, boss: false, paused: false, hp: 100, alive: true, won: false };
  let ctx = null, started = false, running = false, muted = false;
  try { muted = localStorage.getItem('construct-mute') === '1'; } catch {}

  // ---------- graph ----------
  let meter, master, comp, btFilter, music, drums, bassBus, sfx, verb, verbSend, echo, echoSend, echoFb, drive, noiseBuf;
  let drone = null;
  let rateSm = 1; // smoothed time scale the sequencer and pitch follow

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.85;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.16;
    btFilter = ctx.createBiquadFilter(); btFilter.type = 'lowpass'; btFilter.frequency.value = 18000; btFilter.Q.value = 0.9;
    music = ctx.createGain(); music.gain.value = 0.75;
    sfx = ctx.createGain(); sfx.gain.value = 1;
    drums = ctx.createGain(); bassBus = ctx.createGain(); bassBus.gain.value = 1;
    drive = shaper(2.2);

    // reverb: generated decaying-noise impulse
    verb = ctx.createConvolver(); verb.buffer = impulse(2.2, 2.8);
    verbSend = ctx.createGain(); verbSend.gain.value = 0.45; verbSend.connect(verb); verb.connect(btFilter);
    // dub echo: dotted eighth, low-passed feedback
    echo = ctx.createDelay(1.5); echoSend = ctx.createGain(); echoFb = ctx.createGain(); echoFb.gain.value = 0.42;
    const echoLp = ctx.createBiquadFilter(); echoLp.type = 'lowpass'; echoLp.frequency.value = 2600;
    echoSend.connect(echo); echo.connect(echoLp); echoLp.connect(echoFb); echoFb.connect(echo); echoLp.connect(music);

    drums.connect(music); bassBus.connect(drive); drive.connect(music);
    music.connect(btFilter); sfx.connect(btFilter);
    btFilter.connect(comp); comp.connect(master); master.connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 1024; master.connect(meter);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function impulse(sec, decay) {
    const len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  function shaper(k) {
    const ws = ctx.createWaveShaper(), n = 512, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
    ws.curve = c; ws.oversample = '2x'; return ws;
  }

  // ---------- primitives ----------
  const pitch = () => rateSm; // frequency multiplier: bullet time pitches everything down
  function osc(type, f0, t0, dur, { f1, sweep = 0.1, gain = 0.3, a = 0.003, dest = sfx, detune = 0, lp, q = 1, lp1 } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(Math.max(1, f0), t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + sweep);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let tail = o;
    if (lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = q;
      f.frequency.setValueAtTime(lp, t0); if (lp1) f.frequency.exponentialRampToValueAtTime(lp1, t0 + dur);
      o.connect(f); tail = f;
    }
    tail.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return g;
  }
  function noise(t0, dur, { type = 'bandpass', f = 1000, f1, q = 1, gain = 0.3, a = 0.002, dest = sfx, rate = 1 } = {}) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = rate;
    src.start(t0, Math.random() * 1.5);
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t0); if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(dest);
    src.stop(t0 + dur + 0.05);
    return g;
  }
  function chord(semis, root, t0, dur, { type = 'sawtooth', gain = 0.08, lp = 2500, lp1 = 300, a = 0.01, dest = music, spread = 9, send = 0 } = {}) {
    for (const s of semis) for (const d of [-spread, spread]) {
      const g = osc(type, root * 2 ** (s / 12) * pitch(), t0, dur, { gain, a, dest, detune: d, lp, lp1, q: 2 });
      if (send) { const sg = ctx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(verbSend); }
    }
  }

  // ---------- drum kit ----------
  function kick(t, v = 1) {
    const p = pitch();
    osc('sine', 160 * p, t, 0.45, { f1: 42 * p, sweep: 0.09, gain: 1.1 * v, a: 0.002, dest: drums });
    noise(t, 0.02, { type: 'highpass', f: 2500, gain: 0.5 * v, dest: drums });
  }
  function hat(t, v = 1, open = false) {
    noise(t, open ? 0.3 : 0.045, { type: 'highpass', f: 8500, q: 0.7, gain: 0.22 * v, dest: drums, rate: pitch() });
  }
  function clap(t, v = 1) {
    for (let i = 0; i < 3; i++) noise(t + i * 0.011, 0.03, { type: 'bandpass', f: 1400, q: 0.9, gain: 0.3 * v, dest: drums });
    const g = noise(t + 0.03, 0.22, { type: 'bandpass', f: 1600, q: 0.8, gain: 0.35 * v, dest: drums });
    const sg = ctx.createGain(); sg.gain.value = 0.5; g.connect(sg); sg.connect(verbSend);
  }
  function perc(t, f, v = 1) {
    const g = osc('sine', f * pitch(), t, 0.08, { f1: f * 0.6 * pitch(), sweep: 0.05, gain: 0.25 * v, dest: music });
    const sg = ctx.createGain(); sg.gain.value = 0.9; g.connect(sg); sg.connect(echoSend);
  }

  // ---------- synths ----------
  const ROOT = 55; // A1
  const root = () => S.boss ? ROOT * 2 ** (-4 / 12) : ROOT; // Architect: down to F, darker
  function bass(t, semis, acc, dur) {
    const f = root() * 2 ** (semis / 12) * pitch();
    const open = 700 + 1500 * intensity() + (acc ? 1600 : 0);
    osc('sawtooth', f, t, dur, { gain: acc ? 0.42 : 0.3, a: 0.004, dest: bassBus, lp: open * pitch(), lp1: 110, q: acc ? 14 : 9 });
  }
  function stab(t, semis) {
    chord(semis, root() * 4, t, 0.28, { gain: 0.055, lp: 3200, lp1: 350, send: 0.6 });
    const g = ctx.createGain(); g.gain.value = 0.35; g.connect(echoSend);
    for (const s of semis) osc('square', root() * 4 * 2 ** (s / 12) * pitch(), t, 0.12, { gain: 0.03, dest: g });
  }
  function lead(t, semis) {
    const g = osc('square', root() * 8 * 2 ** (semis / 12) * pitch(), t, 0.14, { gain: 0.07, a: 0.004, dest: music, lp: 5000, lp1: 900 });
    const sg = ctx.createGain(); sg.gain.value = 0.7; g.connect(sg); sg.connect(echoSend);
  }
  function startDrone() {
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(0.07, ctx.currentTime, 1.5);
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 260; flt.Q.value = 4;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoG = ctx.createGain(); lfoG.gain.value = 140; lfo.connect(lfoG); lfoG.connect(flt.frequency); lfo.start();
    const oscs = [[0, -6], [0, 6], [7, 0], [-12, 0]].map(([s, d]) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = d; o.userSemis = s;
      o.frequency.value = ROOT * 2 * 2 ** (s / 12); o.connect(flt); o.start(); return o;
    });
    flt.connect(g); g.connect(music);
    const sg = ctx.createGain(); sg.gain.value = 0.3; g.connect(sg); sg.connect(verbSend);
    drone = { g, oscs, flt, retune() {
      for (const o of oscs) o.frequency.setTargetAtTime(root() * 2 * 2 ** (o.userSemis / 12) * rateSm, ctx.currentTime, 0.15);
    } };
  }

  // ---------- sequencer ----------
  const intensity = () => Math.min(1, (S.level - 1) / 9);
  const bpm = () => 128 + Math.min(S.level, 10) * 1.2 + (S.boss ? 5 : 0);
  const LOOK = 0.2, TICK = 40;
  let step = 0, nextT = 0, timer = 0;
  // 16th-note acid lines, semitones above the root; null = rest, uppercase-style accents in ACC
  const BASS = [
    [0, null, 0, 12, 0, null, 3, 0, null, 0, 12, null, 0, 7, 3, 0],
    [0, null, 0, 12, 0, null, 3, 0, null, 0, 12, null, 5, 3, 0, -2],
    [0, null, 0, 12, 0, 10, null, 0, null, 0, 12, 0, null, 7, 0, 15],
    [0, null, 0, 12, 0, null, 3, 0, null, 0, 12, null, 0, 3, 5, 6],
  ];
  const BOSS_BASS = [
    [0, 0, null, 6, 0, 0, null, 12, 0, 0, null, 6, 0, 1, 0, 6],
    [0, 0, null, 6, 0, 0, null, 12, 0, 0, null, 6, 13, 12, 6, 0],
  ];
  const ACC = new Set([3, 6, 10, 13, 15]);
  const ARP = [0, 3, 7, 10, 12, 15, 19, 22, 24, 19, 15, 12, 10, 7, 3, 0];
  const BOSS_ARP = [0, 6, 12, 6, 1, 6, 13, 6, 0, 6, 12, 6, 1, 7, 6, 1];

  function playStep(i, t) {
    const bar = (i >> 4) & 3, s = i & 15, I = intensity(), boss = S.boss;
    // drums
    if (s % 4 === 0) kick(t);
    if (bar === 3 && s === 14 && (I > 0.5 || boss)) kick(t, 0.8);
    if (boss && s === 11) kick(t, 0.7);
    if (s % 4 === 2) hat(t, 1, I > 0.55 && s === 10);
    else if (I > 0.25 && s % 2 === 0) hat(t, 0.35);
    else if (I > 0.7 || boss) hat(t, 0.18);
    if (s === 4 || s === 12) clap(t);
    if (boss && s === 15 && bar % 2) clap(t, 0.5);
    if (I > 0.4 && (s === 7 || (s === 13 && bar % 2))) perc(t, boss ? 1900 : 2400, 0.7);
    if (S.hp < 30 && S.alive && (s === 0 || s === 8)) osc('sine', 1760, t, 0.06, { gain: 0.09, dest: music });
    // bass line
    const line = boss ? BOSS_BASS[bar & 1] : BASS[bar];
    const n = line[s];
    if (n !== null) bass(t, n, ACC.has(s) || boss && s % 4 === 0, 60 / bpm() / 4 / rateSm * 0.85);
    // stabs
    if (boss ? (s === 3 || s === 9 || s === 14) : (I > 0.3 && (s === 6 || (s === 14 && bar % 2) || (bar === 3 && s === 11))))
      stab(t, boss ? [0, 6, 10] : [0, 3, 7, 10]);
    // arp lead
    if ((I > 0.5 && bar % 2) || boss) {
      const arp = boss ? BOSS_ARP : ARP;
      if (!boss || s % 2 === 0) lead(t, arp[(s + bar * 4) & 15]);
    }
  }
  function schedule() {
    while (nextT < ctx.currentTime + LOOK) {
      playStep(step, nextT);
      nextT += 60 / bpm() / 4 / rateSm;
      step = (step + 1) & 63;
    }
  }
  function startMusic() {
    if (running) return;
    running = true; step = 0; nextT = ctx.currentTime + 0.05;
    echo.delayTime.value = 60 / bpm() * 0.75;
    music.gain.setTargetAtTime(0.75, ctx.currentTime, 0.3);
    if (!drone) startDrone(); else drone.g.gain.setTargetAtTime(0.07, ctx.currentTime, 0.5);
    timer = setInterval(schedule, TICK);
  }
  function stopMusic() {
    if (!running) return;
    running = false; clearInterval(timer);
  }

  // ---------- sound effects ----------
  const now = () => ctx.currentTime;
  const FX = {
    fire() {
      const t = now(), p = 0.9 + Math.random() * 0.2;
      osc('sawtooth', 1100 * p, t, 0.11, { f1: 90, sweep: 0.09, gain: 0.32, lp: 5000, lp1: 500 });
      noise(t, 0.07, { type: 'bandpass', f: 2600, q: 0.6, gain: 0.35 });
      osc('sine', 110, t, 0.13, { f1: 38, sweep: 0.08, gain: 0.55 });
      const g = noise(t, 0.16, { type: 'highpass', f: 900, gain: 0.08 });
      g.connect(verbSend);
    },
    hit() {
      const t = now();
      osc('square', 2600, t, 0.045, { f1: 1200, sweep: 0.03, gain: 0.22 });
      osc('sine', 3400, t + 0.005, 0.03, { gain: 0.12 });
      noise(t, 0.03, { type: 'highpass', f: 5000, gain: 0.15 });
    },
    kill() {
      const t = now();
      for (let i = 0; i < 9; i++) {
        const f = 1600 * 2 ** (-i / 3.5) * (0.8 + Math.random() * 0.45);
        osc('square', f, t + i * 0.032, 0.03, { gain: 0.16, lp: 6000 });
      }
      const g = noise(t, 0.3, { type: 'bandpass', f: 3200, f1: 500, q: 1.2, gain: 0.25 });
      g.connect(verbSend);
      osc('sine', 80, t, 0.32, { f1: 32, sweep: 0.2, gain: 0.5 });
    },
    damage() {
      const t = now();
      const d = shaper(4); d.connect(sfx);
      osc('sine', 62, t, 0.32, { f1: 28, sweep: 0.22, gain: 0.7, dest: d });
      noise(t, 0.22, { type: 'lowpass', f: 900, gain: 0.35, dest: d });
      // digital static: noise chopped by a 38 Hz square
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.start(t, Math.random());
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8;
      const vca = ctx.createGain(); vca.gain.value = 0;
      const chop = ctx.createOscillator(); chop.type = 'square'; chop.frequency.value = 38;
      const cg = ctx.createGain(); cg.gain.value = 0.22; chop.connect(cg); cg.connect(vca.gain); chop.start(t);
      const env = ctx.createGain(); env.gain.setValueAtTime(1, t); env.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      src.connect(bp); bp.connect(vca); vca.connect(env); env.connect(sfx);
      src.stop(t + 0.3); chop.stop(t + 0.3);
    },
    spawn() {
      const t = now();
      for (let i = 0; i < 4; i++) {
        noise(t + i * 0.03, 0.014, { type: 'highpass', f: 4000, gain: 0.09 });
        osc('sine', 1400 + i * 300, t + i * 0.03, 0.02, { gain: 0.05 });
      }
    },
    blink() {
      const t = now();
      const g = noise(t, 0.45, { type: 'bandpass', f: 250, f1: 6000, q: 2.5, gain: 0.45, a: 0.4 });
      g.connect(verbSend);
      osc('sine', 130, t + 0.45, 0.2, { f1: 45, sweep: 0.12, gain: 0.6 });
      chord([0, 6], root() * 4, t + 0.45, 0.25, { gain: 0.06, lp: 2500, lp1: 300, dest: sfx, send: 0.7 });
    },
    levelStart() {
      const t = now();
      chord([0, 7], root() * 2, t, 0.16, { gain: 0.09, lp: 2200, lp1: 250, dest: sfx, send: 0.5 });
      chord([0, 7], root(), t + 0.17, 0.4, { gain: 0.1, lp: 1500, lp1: 120, dest: sfx, send: 0.6 });
      osc('sine', 140, t + 0.17, 0.4, { f1: 40, sweep: 0.1, gain: 0.8 });
    },
    levelClear() {
      const t = now();
      noise(t, 0.75, { type: 'bandpass', f: 200, f1: 7000, q: 3, gain: 0.35, a: 0.6 }).connect(verbSend);
      osc('sine', 150, t + 0.75, 0.5, { f1: 38, sweep: 0.1, gain: 1 });
      chord([0, 3, 7, 14], ROOT * 4, t + 0.75, 2.6, { gain: 0.07, a: 0.02, lp: 1800, lp1: 250, dest: sfx, send: 0.8 });
    },
    death() {
      const t = now();
      osc('sawtooth', 220, t, 1.5, { f1: 22, sweep: 1.3, gain: 0.4, lp: 3000, lp1: 80 });
      noise(t, 1.1, { type: 'lowpass', f: 3000, f1: 150, gain: 0.3 }).connect(verbSend);
      osc('sine', 50, t, 0.8, { f1: 20, sweep: 0.6, gain: 0.8 });
    },
    win() {
      const t = now();
      chord([0, 4, 7, 11, 14], ROOT * 4, t, 5, { gain: 0.06, a: 0.5, lp: 3000, lp1: 400, dest: sfx, send: 1 });
      chord([0, 7], ROOT * 2, t, 5, { gain: 0.07, a: 0.3, lp: 800, lp1: 120, dest: sfx, send: 0.6 });
      const scale = [0, 4, 7, 11, 12, 16, 19, 23, 24];
      for (let i = 0; i < 18; i++) {
        const g = osc('sine', ROOT * 8 * 2 ** (scale[i % 9] / 12) * (i >= 9 ? 2 : 1), t + 0.2 + i * 0.09, 0.25, { gain: 0.08 });
        g.connect(verbSend); g.connect(echoSend);
      }
    },
  };

  // ---------- public API ----------
  const api = {
    /** Call from a user gesture. Creates the context and starts the music. */
    start() {
      if (!ctx) build();
      if (ctx.state === 'suspended') ctx.resume();
      started = true;
      if (S.alive && !S.won) startMusic();
    },
    /** Per-frame state from the core. */
    update({ level, timeScale, boss, paused, hp, alive, won }) {
      Object.assign(S, { level, timeScale, boss, paused, hp, alive, won });
      if (!ctx || !started) return;
      const target = Math.max(0.28, timeScale);
      rateSm += (target - rateSm) * 0.12;
      const t = ctx.currentTime;
      // bullet time closes the filter over the whole mix; pause muffles harder
      const cut = paused ? 350 : 300 + 17700 * Math.pow((rateSm - 0.28) / 0.72, 1.6);
      btFilter.frequency.setTargetAtTime(cut, t, 0.05);
      music.gain.setTargetAtTime(paused ? 0.3 : (alive && !won ? 0.75 : 0.35), t, 0.15);
      if (drone) drone.retune();
      if (!alive || won) stopMusic();
      else if (!running) startMusic();
    },
    fx: FX,
    play(name) { if (ctx && started && !muted) FX[name](); },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('construct-mute', muted ? '1' : '0'); } catch {}
      if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.85, ctx.currentTime, 0.02);
      return muted;
    },
    get muted() { return muted; },
    get running() { return running; },
    get ctx() { return ctx; },
    /** RMS and peak of the master output over the last analyser window, for debugging. */
    level() {
      if (!meter) return { rms: 0, peak: 0 };
      const b = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(b);
      let s = 0, p = 0; for (const v of b) { s += v * v; p = Math.max(p, Math.abs(v)); }
      return { rms: Math.sqrt(s / b.length), peak: p };
    },
  };
  return api;
}
