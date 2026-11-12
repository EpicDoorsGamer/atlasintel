/* ==========================================================================
   Intro — boot-up sequence shown on page load.
   Black screen, scan line, a wireframe globe that draws itself in, and a
   typed log of the real loading steps. When loading is done an ENGAGE
   button appears; clicking it (or pressing Enter) reveals the live globe.
   ========================================================================== */
window.Intro = (() => {
  'use strict';
  const el = document.getElementById('intro');
  const log = el.querySelector('.intro-log');
  const bar = el.querySelector('.intro-bar i');
  const pct = el.querySelector('.intro-pct');
  const btn = document.getElementById('engage');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MIN_SHOW_MS = reduce ? 0 : 3200;
  const started = performance.now();
  let typing = Promise.resolve();
  let progress = 0;

  // ---- wireframe globe: meridians + parallels that draw themselves in
  (function buildWireframe() {
    const svg = el.querySelector('.intro-globe');
    const R = 120, parts = [];
    parts.push(`<circle r="${R}" pathLength="1" style="--d:0s"/>`);
    for (let i = 0; i < 6; i++) {          // meridians (ellipses squashed horizontally)
      const rx = Math.abs(Math.cos(i * Math.PI / 6)) * R;
      parts.push(`<ellipse rx="${rx.toFixed(1)}" ry="${R}" pathLength="1" style="--d:${0.15 + i * 0.12}s"/>`);
    }
    for (let j = -2; j <= 2; j++) {        // parallels (flattened ellipses at each latitude)
      const lat = j * Math.PI / 7, y = Math.sin(lat) * R, r = Math.cos(lat) * R;
      parts.push(`<ellipse cy="${y.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.18).toFixed(1)}" pathLength="1" style="--d:${0.9 + (j + 2) * 0.12}s"/>`);
    }
    parts.push(`<circle r="${R + 22}" class="orbit" pathLength="1" style="--d:1.5s"/>`);
    parts.push(`<circle r="${R + 34}" class="orbit dashed" pathLength="1" style="--d:1.7s"/>`);
    svg.innerHTML = parts.join('');
  })();

  // ---- typed log lines (queued so they never overlap)
  function type(text, cls = '') {
    typing = typing.then(() => new Promise(resolve => {
      const line = document.createElement('div');
      if (cls) line.className = cls;
      log.appendChild(line);
      while (log.children.length > 6) log.firstChild.remove();
      if (reduce) { line.textContent = text; return resolve(); }
      let i = 0;
      const timer = setInterval(() => {
        line.textContent = text.slice(0, ++i);
        if (i >= text.length) { clearInterval(timer); resolve(); }
      }, 14);
    }));
    return typing;
  }

  function setProgress(v) {
    progress = Math.max(progress, Math.min(100, v));
    bar.style.width = progress + '%';
    pct.textContent = Math.round(progress) + '%';
  }

  // a real loading step finished
  function step(label, value, failed = false) {
    setProgress(value);
    type(`> ${label} ${failed ? '[FAIL]' : '[OK]'}`, failed ? 'fail' : '');
  }

  type('> INITIALIZING GLOBAL MATRIX…');

  // resolves when the visitor presses ENGAGE
  function ready() {
    setProgress(100);
    return typing
      .then(() => new Promise(r => setTimeout(r, Math.max(0, MIN_SHOW_MS - (performance.now() - started)))))
      .then(() => type('> ALL SYSTEMS NOMINAL. AWAITING COMMAND.', 'ok'))
      .then(() => new Promise(resolve => {
        btn.disabled = false;
        el.classList.add('ready');
        btn.focus({ preventScroll: true });
        const go = () => {
          btn.removeEventListener('click', go);
          removeEventListener('keydown', onKey, true);
          el.classList.add('out');
          document.body.classList.add('engaged');
          setTimeout(() => el.remove(), reduce ? 0 : 1100);
          resolve();
        };
        const onKey = e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        };
        btn.addEventListener('click', go);
        addEventListener('keydown', onKey, true);
      }));
  }

  return { step, ready };
})();
