/* ==========================================================================
   SFX — synthesised HUD sound effects (Web Audio API).
   Every sound is generated in the browser: no audio files, nothing to license.
   Browsers only allow audio after the first click / key press, so the engine
   wakes up on the first user gesture.
   ========================================================================== */
window.SFX = (() => {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = JSON.parse(localStorage.getItem('atlas.muted') || 'false'); } catch { /* private mode */ }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor(); // keeps stacked sounds from clipping
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // a single enveloped oscillator, optionally gliding from f to `to`
  function tone({ f = 880, to = null, type = 'sine', dur = 0.08, vol = 0.2, at = 0, attack = 0.004 }) {
    const t0 = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  // filtered white noise with a sweeping filter: whooshes, air, static
  function noise({ dur = 0.4, vol = 0.15, f = 800, to = 3000, q = 1.2, at = 0, type = 'bandpass' }) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t0);
    fl.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(fl);
    fl.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const SOUNDS = {
    // pointer moves onto a country / button
    hover: () => tone({ f: 2400, dur: 0.035, vol: 0.03 }),
    // generic button press
    click: () => tone({ f: 1600, to: 1100, type: 'square', dur: 0.045, vol: 0.045 }),
    // dossier tab change: two-step chirp
    tab: () => {
      tone({ f: 1200, type: 'triangle', dur: 0.05, vol: 0.07 });
      tone({ f: 1800, type: 'triangle', dur: 0.05, vol: 0.055, at: 0.045 });
    },
    // camera flies to a country
    select: () => {
      noise({ dur: 1.1, vol: 0.11, f: 260, to: 2800, q: 0.9 });
      tone({ f: 180, to: 540, type: 'sawtooth', dur: 0.7, vol: 0.03 });
    },
    // reticle locks onto the capital
    lock: () => {
      tone({ f: 880, type: 'square', dur: 0.05, vol: 0.045 });
      tone({ f: 880, type: 'square', dur: 0.05, vol: 0.045, at: 0.09 });
      tone({ f: 1760, dur: 0.4, vol: 0.11, at: 0.19 });
      tone({ f: 2637, dur: 0.32, vol: 0.05, at: 0.19 });
    },
    // dossier panel slides in
    open: () => {
      noise({ dur: 0.35, vol: 0.06, f: 1800, to: 500, q: 2 });
      tone({ f: 520, to: 1040, type: 'triangle', dur: 0.22, vol: 0.055 });
    },
    // dossier closes / zoom out
    close: () => {
      noise({ dur: 0.55, vol: 0.075, f: 2400, to: 250, q: 1 });
      tone({ f: 900, to: 240, type: 'triangle', dur: 0.34, vol: 0.075 });
    },
    // terminal line typed in the boot sequence
    type: () => tone({ f: 2600 + Math.random() * 1400, type: 'square', dur: 0.018, vol: 0.022 }),
    // fresh data arrived
    data: () => [0, 0.06, 0.12].forEach((at, i) => tone({ f: 1400 + i * 350, dur: 0.05, vol: 0.045, at })),
    // time slider step
    tick: () => tone({ f: 1500, type: 'square', dur: 0.015, vol: 0.028 }),
    toggleOn: () => {
      tone({ f: 700, type: 'triangle', dur: 0.06, vol: 0.07 });
      tone({ f: 1400, type: 'triangle', dur: 0.08, vol: 0.07, at: 0.06 });
    },
    toggleOff: () => {
      tone({ f: 1400, type: 'triangle', dur: 0.06, vol: 0.07 });
      tone({ f: 700, type: 'triangle', dur: 0.08, vol: 0.07, at: 0.06 });
    },
    // warning toast
    alert: () => {
      tone({ f: 330, type: 'sawtooth', dur: 0.11, vol: 0.05 });
      tone({ f: 330, type: 'sawtooth', dur: 0.11, vol: 0.05, at: 0.15 });
    },
  };
  // rate-limit the chatty ones
  const MIN_GAP = { hover: 70, tick: 40, type: 30 };
  const last = {};

  function play(name) {
    if (muted || !ctx) return;
    const now = performance.now();
    if (MIN_GAP[name] && now - (last[name] || 0) < MIN_GAP[name]) return;
    last[name] = now;
    try { SOUNDS[name]?.(); } catch { /* audio glitches must never break the UI */ }
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('atlas.muted', JSON.stringify(muted)); } catch { /* private mode */ }
    if (!muted) ensure();
  }

  const unlock = () => ensure();
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, unlock, { capture: true, passive: true }));

  return { play, setMuted, get muted() { return muted; } };
})();
