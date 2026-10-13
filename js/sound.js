// Sound effects, synthesised with Web Audio so there are no files to ship.
// Nothing plays until unlock() runs from a click or key press.
(function (root) {
  'use strict';
  // two buses: game sounds, which go silent the moment the game pauses, and menu clicks, which do not
  let ac = null, master = null, game = null, ui = null, out = null, hiss = null, muted = false, held = false;
  const last = {};
  // every game sound still playing or queued, so pausing can stop them outright
  const ringing = new Set();
  function track(node) { if (out === game) { ringing.add(node); node.onended = () => ringing.delete(node); } }

  function unlock() {
    if (!ac) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ac.destination);
      game = ac.createGain(); game.gain.value = held ? 0 : 1; game.connect(master);
      ui = ac.createGain(); ui.connect(master);
      out = game;
      hiss = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = hiss.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  }

  function tone(freq, dur, o) {
    o = o || {};
    const t = ac.currentTime + (o.delay || 0);
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    track(osc);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise(dur, o) {
    o = o || {};
    const t = ac.currentTime + (o.delay || 0);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = hiss; src.loop = true;
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.from || 1200, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    track(src);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  const tune = (notes, step, o) => notes.forEach((n, i) => tone(n, step * 1.6, Object.assign({ delay: i * step }, o)));

  const sounds = {
    tick: () => tone(392, 0.11, { type: 'square', gain: 0.1 }),
    go: () => tone(784, 0.3, { type: 'square', gain: 0.12 }),
    bump: (power) => {
      const g = Math.max(0.2, Math.min(1, (power || 0) / 320));
      tone(150, 0.13, { gain: 0.5 * g, to: 55 });
      noise(0.06, { gain: 0.22 * g, from: 2000, to: 500 });
    },
    dash: () => noise(0.17, { gain: 0.16, from: 500, to: 2800, type: 'bandpass' }),
    slamDash: () => { noise(0.3, { gain: 0.26, from: 300, to: 3400, type: 'bandpass' }); tone(90, 0.3, { type: 'sawtooth', gain: 0.12, to: 260 }); },
    slamReady: () => tune([392, 523, 784], 0.06, { type: 'square', gain: 0.1 }),
    waveReady: () => { noise(0.35, { gain: 0.14, from: 500, to: 1500, attack: 0.15 }); tone(294, 0.2, { type: 'triangle', gain: 0.1, to: 392 }); },
    slam: () => { tone(95, 0.6, { gain: 0.8, to: 28 }); noise(0.5, { gain: 0.55, from: 4200, to: 140 }); tone(300, 0.18, { type: 'square', gain: 0.1, to: 80 }); },
    thorns: () => { tone(1400, 0.07, { type: 'square', gain: 0.12, to: 500 }); noise(0.09, { gain: 0.25, from: 5000, to: 2000, type: 'highpass' }); },
    fall: () => tone(720, 0.42, { type: 'triangle', gain: 0.16, to: 140 }),
    creak: () => { tone(70, 0.5, { type: 'sawtooth', gain: 0.1, to: 110 }); tone(64, 0.5, { type: 'sawtooth', gain: 0.08, to: 96, delay: 0.05 }); },
    shrink: () => tune([196, 147, 196, 147], 0.16, { type: 'square', gain: 0.1 }),
    spawn: () => tone(880, 0.09, { gain: 0.1, to: 1320 }),
    big: () => tone(110, 0.3, { type: 'triangle', gain: 0.3, to: 330 }),
    power: () => { tone(160, 0.32, { type: 'square', gain: 0.1, to: 480 }); tone(80, 0.32, { type: 'sawtooth', gain: 0.12, to: 240 }); },
    hide: () => tone(900, 0.4, { gain: 0.16, to: 200 }),
    charge: () => { tone(200, 0.28, { type: 'sawtooth', gain: 0.14, to: 1600 }); noise(0.12, { gain: 0.12, from: 3000, to: 6000, type: 'highpass', delay: 0.16 }); },
    armour: () => tune([1200, 900, 1500], 0.045, { type: 'square', gain: 0.09 }),
    wearOff: () => tune([520, 390], 0.08, { type: 'triangle', gain: 0.12 }),
    click: () => tone(520, 0.05, { type: 'triangle', gain: 0.12 }),
    warn: () => tone(620, 0.05, { type: 'triangle', gain: 0.1 }),
    gone: () => tone(120, 0.14, { type: 'triangle', gain: 0.28, to: 48 }),
    splash: () => { noise(0.5, { gain: 0.4, from: 2600, to: 280 }); tone(210, 0.28, { gain: 0.18, to: 60 }); },
    wave: () => noise(1.3, { gain: 0.3, from: 260, to: 1500, attack: 0.5 }),
    washed: () => noise(0.22, { gain: 0.25, from: 1600, to: 500 }),
    bomb: () => { tone(130, 0.45, { gain: 0.7, to: 32 }); noise(0.4, { gain: 0.5, from: 3200, to: 180 }); },
    roundWon: () => tune([523, 659, 784], 0.1, { type: 'triangle', gain: 0.18 }),
    roundLost: () => tune([330, 262], 0.14, { type: 'triangle', gain: 0.16 }),
    matchWon: () => tune([523, 659, 784, 1047, 1319], 0.12, { type: 'triangle', gain: 0.2 }),
    matchLost: () => tune([392, 330, 262, 196], 0.18, { type: 'triangle', gain: 0.18 }),
  };

  // gapMs stops a pile-up from firing the same sound every frame
  function play(name, arg, gapMs) {
    if (!ac || muted || !sounds[name]) return;
    const now = ac.currentTime;
    if (gapMs && last[name] !== undefined && now - last[name] < gapMs / 1000) return;
    last[name] = now;
    out = name === 'click' ? ui : game;
    sounds[name](arg);
  }

  // Pausing has to be silent at once, in every browser. A gentle fade on the game
  // bus was not enough in Firefox, so this does it twice over: every game sound
  // that is playing or queued (the later notes of a tune, a wave still swelling)
  // is stopped outright, and the bus is cut with no ramp.
  function setPaused(on) {
    held = on;
    if (!game) return;
    if (on) {
      ringing.forEach((node) => { try { node.stop(); } catch (e) { /* already over */ } });
      ringing.clear();
    }
    const level = on ? 0 : 1, now = ac.currentTime;
    game.gain.cancelScheduledValues(now);
    game.gain.setValueAtTime(level, now);
    game.gain.value = level;
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.6;
  }

  root.Sfx = { unlock, play, setMuted, setPaused, isMuted: () => muted };
})(window);
