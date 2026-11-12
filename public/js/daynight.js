/* ==========================================================================
   DayNight — live day/night shading for the globe surface.
   Computes where the sun is overhead right now, darkens the night hemisphere,
   lights up cities on the night side and adds a glowing terminator line.

   The per-pixel work (2 million pixels) runs in a Web Worker so it never
   blocks the page: this same file is loaded as the worker script.
   Output: equirectangular ImageData (lng -180..180, lat 90..-90).
   ========================================================================== */
(function (root) {
  'use strict';
  const IS_WORKER = typeof window === 'undefined';
  const W = 2048, H = 1024, RAD = Math.PI / 180;

  const sinLat = new Float32Array(H), cosLat = new Float32Array(H), lng = new Float32Array(W);
  for (let y = 0; y < H; y++) {
    const lat = (90 - (y + 0.5) / H * 180) * RAD;
    sinLat[y] = Math.sin(lat);
    cosLat[y] = Math.cos(lat);
  }
  for (let x = 0; x < W; x++) lng[x] = (-180 + (x + 0.5) / W * 360) * RAD;

  // Point on Earth where the sun is directly overhead (accurate to ~0.5°, plenty for shading).
  function subsolar(date = new Date()) {
    const dayOfYear = (date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5;
    const B = 2 * Math.PI * (dayOfYear - 81) / 365;
    const equationOfTime = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
    const declination = 23.44 * Math.sin(B);
    const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    let lon = -15 * (utcHours - 12 + equationOfTime / 60);
    lon = ((lon + 540) % 360) - 180;
    return { lat: declination, lng: lon };
  }

  // Fill an RGBA pixel buffer (W*H*4) with the shaded surface.
  function shade(px, lights, date, night) {
    const sun = subsolar(date);
    const sd = Math.sin(sun.lat * RAD), cd = Math.cos(sun.lat * RAD), sl = sun.lng * RAD;
    const cosDl = new Float32Array(W);
    for (let x = 0; x < W; x++) cosDl[x] = Math.cos(lng[x] - sl);
    for (let y = 0; y < H; y++) {
      const a = sinLat[y] * sd, b = cosLat[y] * cd;
      for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4;
        const cz = night ? a + b * cosDl[x] : 1;     // cos(sun zenith): > 0 day, < 0 night
        let t = (cz + 0.1) / 0.2;                     // smooth ~6° twilight band
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        t = t * t * (3 - 2 * t);
        const glow = night ? Math.exp(-(cz * cz) / 0.0008) : 0;
        const L = lights && night ? lights[i] * (1 - t) : 0;
        px[o] = 3 + 9 * t + L * 255 + glow * 8;
        px[o + 1] = 8 + 34 * t + L * 175 + glow * 95;
        px[o + 2] = 14 + 44 * t + L * 70 + glow * 115;
        px[o + 3] = 255;
      }
    }
    return sun;
  }

  // ---------------------------------------------------------------- worker side
  if (IS_WORKER) {
    let lights = null;
    root.onmessage = e => {
      const m = e.data;
      if (m.type === 'lights') { lights = m.lights; return; }
      if (m.type === 'render') {
        const px = new Uint8ClampedArray(W * H * 4);
        shade(px, lights, new Date(m.time), m.night);
        root.postMessage({ id: m.id, px }, [px.buffer]);
      }
    };
    return;
  }

  // ---------------------------------------------------------------- page side
  let lights = null, worker = null, nextId = 0;
  const pending = new Map();
  try {
    worker = new Worker(document.currentScript.src); // this same file, running off the main thread
    worker.onmessage = e => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (done) done(e.data.px);
    };
    worker.onerror = () => { worker = null; };
  } catch { worker = null; /* file:// or very old browser: shade on the main thread */ }

  function loadLights(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0, W, H);
          const d = g.getImageData(0, 0, W, H).data;
          lights = new Float32Array(W * H);
          for (let i = 0; i < W * H; i++) {
            const l = (d[i * 4] * 0.4 + d[i * 4 + 1] * 0.45 + d[i * 4 + 2] * 0.15) / 255;
            lights[i] = l > 0.1 ? Math.min(1, (l - 0.1) / 0.75) : 0;
          }
          worker?.postMessage({ type: 'lights', lights });
        } catch { lights = null; /* cross-origin failure: shade without lights */ }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  function renderSync(date, night) {
    const px = new Uint8ClampedArray(W * H * 4);
    shade(px, lights, date, night);
    return new ImageData(px, W, H);
  }

  // -> Promise<ImageData>
  function render({ date = new Date(), night = true } = {}) {
    if (!worker) return Promise.resolve(renderSync(date, night));
    return new Promise(resolve => {
      const id = ++nextId;
      const fallback = setTimeout(() => { pending.delete(id); resolve(renderSync(date, night)); }, 8000);
      pending.set(id, px => { clearTimeout(fallback); resolve(new ImageData(px, W, H)); });
      worker.postMessage({ type: 'render', id, time: +date, night });
    });
  }

  root.DayNight = { loadLights, render, subsolar, W, H };
})(self);
