/* ==========================================================================
   Satellites — live satellite positions.
   Orbit data (TLEs) comes from CelesTrak via a snapshot the site ships in
   api/tle/ (refreshed by the daily data job), with CelesTrak itself as the
   fallback when that snapshot is stale.
   Positions are propagated with satellite.js (SGP4) in a Web Worker: this
   same file is loaded as the worker script, so the page never stutters.
   ========================================================================== */
(function (root) {
  'use strict';
  const IS_WORKER = typeof window === 'undefined';
  const SATJS = 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js';

  // ---------------------------------------------------------------- worker side
  if (IS_WORKER) {
    importScripts(SATJS);
    const S = root.satellite;
    let recs = [];
    const geo = (rec, date) => {
      const pv = S.propagate(rec, date);
      if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
      const gd = S.eciToGeodetic(pv.position, S.gstime(date));
      const v = pv.velocity;
      return [S.degreesLat(gd.latitude), S.degreesLong(gd.longitude), gd.height, v ? Math.hypot(v.x, v.y, v.z) : 0];
    };
    root.onmessage = e => {
      const m = e.data;
      if (m.type === 'init') {
        recs = m.tles.map(([l1, l2]) => { try { return S.twoline2satrec(l1, l2); } catch { return null; } });
        root.postMessage({ type: 'ready' });
      } else if (m.type === 'tick') {
        const date = new Date(m.time), out = new Float32Array(recs.length * 4);
        for (let i = 0; i < recs.length; i++) {
          let g = null;
          try { g = recs[i] && geo(recs[i], date); } catch { g = null; }
          if (g && Number.isFinite(g[0])) out.set(g, i * 4);
          else out[i * 4 + 2] = NaN;
        }
        root.postMessage({ type: 'pos', id: m.id, out }, [out.buffer]);
      } else if (m.type === 'orbit') {
        const pts = [];
        for (let k = 0; k <= m.steps; k++) {
          let g = null;
          try { g = recs[m.index] && geo(recs[m.index], new Date(m.time + k * m.stepSec * 1000)); } catch { g = null; }
          if (g) pts.push([g[0], g[1], g[2]]);
        }
        root.postMessage({ type: 'orbit', id: m.id, pts });
      }
    };
    return;
  }

  // ---------------------------------------------------------------- page side
  const SCRIPT = document.currentScript.src;
  const GROUPS = [ // drawn back to front; a satellite in several groups keeps the first one listed here
    { id: 'stations', label: 'SPACE STATION', color: '#ffb300', size: 2.6 },
    { id: 'weather', label: 'WEATHER', color: '#3dffa8', size: 1.4 },
    { id: 'visual', label: 'BRIGHT SATELLITE', color: '#39f3ff', size: 1.3 },
    { id: 'starlink', label: 'STARLINK', color: 'rgba(200, 225, 255, 0.85)', size: 0.75 },
  ];
  const TTL = 2 * 3600 * 1000;
  // The site ships its own snapshot (public/api/tle/, refreshed by the daily data job).
  // Only when it is older than this does the browser ask CelesTrak for something fresher.
  const SNAPSHOT_STALE = { starlink: 4 * 86400e3, default: 36 * 3600e3 };
  let worker = null, meta = [], timer = null, busy = false, onUpdate = null, nextId = 0;
  let speed = 1, simBase = 0, realBase = 0, running = false, indexP = null;
  const waiting = new Map();
  const isTle = text => /^1 \d/m.test(text);

  const snapshotIndex = () => indexP ||= fetch('api/tle/index.json')
    .then(r => (r.ok ? r.json() : null)).catch(() => null);

  async function snapshot(group) {
    const info = (await snapshotIndex())?.groups?.[group];
    if (!info) return null;
    try {
      const r = await fetch(`api/tle/${group}.txt`);
      const text = r.ok ? await r.text() : '';
      return isTle(text) ? { text, age: Date.now() - info.fetched * 1000 } : null;
    } catch { return null; }
  }

  // CelesTrak directly: kept in the browser for 2 hours, because CelesTrak blocks an IP
  // that downloads the same group again within that time.
  async function celestrak(group) {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`;
    let cache = null, hit = null;
    try { cache = await caches.open('atlas-tle'); hit = await cache.match(url); } catch { cache = null; }
    if (hit && Date.now() - +hit.headers.get('x-fetched') < TTL) return hit.text();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const text = await r.text();
      if (r.ok && isTle(text)) {
        if (cache) await cache.put(url, new Response(text, { headers: { 'x-fetched': String(Date.now()) } }));
        return text;
      }
    } catch { /* slow, blocked or offline */ }
    if (hit) return hit.text();
    throw new Error('CelesTrak unavailable');
  }

  async function tleText(group) {
    const snap = await snapshot(group);
    if (snap && snap.age < (SNAPSHOT_STALE[group] || SNAPSHOT_STALE.default)) return snap.text;
    try { return await celestrak(group); } catch (e) {
      if (snap) return snap.text; // an old orbit still beats an empty sky
      throw e;
    }
  }

  function parse(text, group, seen, tles) {
    const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
    for (let i = 0; i + 2 < lines.length + 1; i++) {
      if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ') && !lines[i].startsWith('1 ') && !lines[i].startsWith('2 ')) {
        const norad = lines[i + 1].slice(2, 7).trim();
        if (!seen.has(norad)) {
          seen.add(norad);
          meta.push({ name: lines[i].trim(), group, norad });
          tles.push([lines[i + 1], lines[i + 2]]);
        }
        i += 2;
      }
    }
  }

  const simTime = () => simBase + (Date.now() - realBase) * speed;

  function tick() {
    if (busy || !worker) return;
    busy = true;
    worker.postMessage({ type: 'tick', id: ++nextId, time: simTime() });
  }

  async function start(cb) {
    if (running) return;
    running = true;
    onUpdate = cb;
    if (!worker) {
      const results = await Promise.allSettled(GROUPS.map(g => tleText(g.id)));
      if (!running) return;
      const seen = new Set(), tles = [];
      meta = [];
      results.forEach((r, i) => { if (r.status === 'fulfilled') parse(r.value, GROUPS[i].id, seen, tles); });
      if (!tles.length) { running = false; throw new Error('ORBIT DATA UNAVAILABLE'); }
      worker = new Worker(SCRIPT);
      worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'pos') {
          busy = false;
          if (running) onUpdate?.({ meta, pos: m.out, time: simTime() });
        } else if (m.type === 'orbit') {
          waiting.get(m.id)?.(m.pts);
          waiting.delete(m.id);
        }
      };
      worker.onerror = () => { busy = false; };
      worker.postMessage({ type: 'init', tles });
    }
    simBase = Date.now();
    realBase = Date.now();
    busy = false;
    tick();
    timer = setInterval(tick, 500);
  }

  function stop() {
    running = false;
    clearInterval(timer);
    timer = null;
  }

  function setSpeed(x) {
    simBase = simTime();
    realBase = Date.now();
    speed = x;
  }

  // future ground track of one satellite: [[lat, lng, altKm], ...]
  function orbit(index, minutes = 95, stepSec = 30) {
    if (!worker) return Promise.resolve([]);
    return new Promise(resolve => {
      const id = ++nextId;
      waiting.set(id, resolve);
      worker.postMessage({ type: 'orbit', id, index, time: simTime(), steps: Math.round(minutes * 60 / stepSec), stepSec });
    });
  }

  root.Satellites = {
    GROUPS, start, stop, setSpeed, orbit,
    get active() { return running; },
    get speed() { return speed; },
  };
})(self);
