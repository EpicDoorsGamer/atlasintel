/* ==========================================================================
   DayNight — paints the globe's surface texture with live day/night shading.
   Computes where the sun is overhead right now, darkens the night hemisphere,
   lights up cities on the night side and draws a glowing terminator line.
   Output is an equirectangular canvas (lng -180..180, lat 90..-90) that
   globe.gl uses as its globe image.
   ========================================================================== */
window.DayNight = (() => {
  'use strict';
  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g2 = canvas.getContext('2d');
  let lights = null; // night-lights luminance, 0..1 per pixel

  const RAD = Math.PI / 180;
  const sinLat = new Float32Array(H), cosLat = new Float32Array(H), lng = new Float32Array(W);
  for (let y = 0; y < H; y++) {
    const lat = (90 - (y + 0.5) / H * 180) * RAD;
    sinLat[y] = Math.sin(lat);
    cosLat[y] = Math.cos(lat);
  }
  for (let x = 0; x < W; x++) lng[x] = (-180 + (x + 0.5) / W * 360) * RAD;

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
        } catch { lights = null; /* cross-origin failure: shade without lights */ }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

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

  function render({ date = new Date(), night = true } = {}) {
    const img = g2.createImageData(W, H), px = img.data;
    const sun = subsolar(date);
    const sd = Math.sin(sun.lat * RAD), cd = Math.cos(sun.lat * RAD), sl = sun.lng * RAD;
    const cosDl = new Float32Array(W);
    for (let x = 0; x < W; x++) cosDl[x] = Math.cos(lng[x] - sl);

    for (let y = 0; y < H; y++) {
      const a = sinLat[y] * sd, b = cosLat[y] * cd;
      for (let x = 0; x < W; x++) {
        const i = y * W + x, o = i * 4;
        // cosine of the sun's zenith angle: > 0 day, < 0 night
        const cz = night ? a + b * cosDl[x] : 1;
        // smooth ~6° twilight band
        let t = (cz + 0.1) / 0.2;
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
    g2.putImageData(img, 0, 0);
    return { canvas, sun };
  }

  return { loadLights, render, subsolar };
})();
