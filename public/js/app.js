/* ==========================================================================
   A.T.L.A.S. — Global Economic Intelligence Matrix
   Globe (globe.gl) + HUD dossier for every UN member state.
   Data: ./server.py  ->  World Bank WDI (economy/trade) + Google News / GDELT (news)
   ========================================================================== */
(() => {
  'use strict';

  const ONLINE = location.protocol !== 'file:';
  const COUNTRIES = window.UN_COUNTRIES;
  const byNum = new Map(COUNTRIES.map(c => [c.num, c]));
  const byIso3 = new Map(COUNTRIES.map(c => [c.iso3, c]));
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------ formatting
  const usd = v => {
    if (v == null || isNaN(v)) return '—';
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
    if (a >= 1e3) return `${s}$${Math.round(a).toLocaleString('en-US')}`;
    return `${s}$${a.toFixed(0)}`;
  };
  const big = v => {
    if (v == null) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  };
  const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  const pctPlain = v => v == null ? '—' : `${v.toFixed(1)}%`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const flagImg = (c, w = 80) => c.iso2 ? `<img src="https://flagcdn.com/w${w}/${c.iso2.toLowerCase()}.png" alt="" loading="lazy">` : '';
  const ago = iso => {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('atlas.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('atlas.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ------------------------------------------------------------ layers
  const LAYERS = {
    'NY.GDP.MKTP.CD':    { label: 'GDP (current US$)', short: 'GDP', fmt: usd, scale: 'log' },
    'NY.GDP.PCAP.CD':    { label: 'GDP per capita (US$)', short: 'GDP / CAPITA', fmt: usd, scale: 'log' },
    'NE.EXP.GNFS.CD':    { label: 'Exports, goods & services', short: 'EXPORTS', fmt: usd, scale: 'log' },
    'NE.IMP.GNFS.CD':    { label: 'Imports, goods & services', short: 'IMPORTS', fmt: usd, scale: 'log' },
    'NY.GDP.MKTP.KD.ZG': { label: 'Real GDP growth (annual %)', short: 'GROWTH', fmt: pct, scale: 'div' },
  };

  const state = {
    layer: 'NY.GDP.MKTP.CD',
    global: {},           // ind -> { values: {ISO3: [year, value]} }
    ranks: {},            // ind -> Map(iso3 -> rank)
    domain: null,         // [lo, hi] for current layer
    selected: null,
    hover: null,
    econ: {},             // iso3 -> payload
    tab: 'economy',
    indexTab: 'all',
    watch: new Set(store.get('watch', [])),
    year: null,           // null = latest reported values; a number = time-slider year
    history: {},          // ind -> { years: [...], values: {ISO3: [v per year]} }
    yearCache: {},
    hotspots: [],         // news hotspots (last 24 h of GDELT events)
  };

  // ------------------------------------------------------------ data
  // Economic data is pre-built into static JSON by build_data.py (refreshed daily by GitHub Actions).
  async function getJSON(path) {
    if (!ONLINE) throw new Error('Serve the public/ folder over http (see README) to load data');
    const r = await fetch(path);
    if (!r.ok) throw new Error(r.status === 404 ? 'NO DATA ON FILE' : `HTTP ${r.status}`);
    return r.json();
  }

  // News comes live from the GDELT Project, straight from the browser.
  // GDELT allows ~1 request per 5 s per visitor, so requests are queued, retried and cached 15 min.
  // (A rate-limited reply carries no CORS header, so it surfaces as a network error.)
  let gdeltNext = 0;
  async function gdeltSlot() {
    const wait = Math.max(0, gdeltNext - Date.now());
    gdeltNext = Date.now() + wait + 5500;
    if (wait) await new Promise(r => setTimeout(r, wait));
  }
  // GDELT titles come tokenised ("India , Canada", "$2 . 5 billion"); tidy them up
  const cleanTitle = t => String(t || '')
    .replace(/(\d) \. (\d)/g, '$1.$2')
    .replace(/\s+([,.;:!?%)\]'’])/g, '$1')
    .replace(/([(\[$])\s+/g, '$1')
    .replace(/\s+-\s+(?=[A-Za-z])/g, '-')
    .replace(/\s{2,}/g, ' ')
    .trim();

  async function gdelt(query, { timespan = '7d', max = 40, force = false, sort = 'hybridrel' } = {}) {
    const key = 'gdelt.' + query;
    const hit = store.get(key, null);
    if (!force && hit && Date.now() - hit.t < 15 * 60e3) return hit.v;
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&sort=${sort}`
      + `&maxrecords=${max}&timespan=${timespan}&query=${encodeURIComponent(query)}`;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      await gdeltSlot();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const text = await (await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer))).text();
        let data;
        try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 90) || 'EMPTY REPLY'); }
        const items = (data.articles || []).map(a => ({
          title: cleanTitle(a.title),
          url: a.url,
          source: a.domain,
          published: /^\d{8}T\d{6}Z$/.test(a.seendate || '')
            ? a.seendate.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z') : null,
        }));
        const v = { items, provider: 'GDELT', fetched: new Date().toISOString() };
        store.set(key, { t: Date.now(), v });
        return v;
      } catch (e) { lastErr = e; }
    }
    if (hit) return { ...hit.v, stale: true };
    throw new Error('NEWS FEED BUSY · ' + (lastErr?.message || 'RETRY SHORTLY'));
  }

  // Every headline this browser has seen for a country.
  const ARCHIVE_MAX = 200;
  function archiveMerge(iso3, items) {
    const arch = store.get('archive.' + iso3, []);
    const seen = new Set(arch.map(a => a.title));
    const now = new Date().toISOString();
    for (const it of items) {
      if (it.title && !seen.has(it.title)) { arch.push({ ...it, firstSeen: now }); seen.add(it.title); }
    }
    arch.sort((a, b) => (b.published || b.firstSeen).localeCompare(a.published || a.firstSeen));
    const kept = arch.slice(0, ARCHIVE_MAX);
    store.set('archive.' + iso3, kept);
    return kept.length;
  }

  // ------------------------------------------------------------ colour scale
  const RAMP = [[6, 48, 72], [0, 140, 190], [0, 229, 255], [190, 252, 255]];
  function ramp(t) {
    t = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
    return RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
  }
  // values shown on the globe: latest reported, or the time slider's year
  function valuesFor(ind = state.layer) {
    const h = state.history[ind];
    if (state.year == null || !h) return state.global[ind]?.values;
    const key = ind + '|' + state.year;
    if (state.yearCache[key]) return state.yearCache[key];
    const i = h.years.indexOf(state.year), out = {};
    if (i >= 0) for (const [iso, arr] of Object.entries(h.values)) if (arr[i] != null) out[iso] = [state.year, arr[i]];
    return (state.yearCache[key] = out);
  }
  function ranksFor(ind = state.layer) {
    if (state.year == null || !state.history[ind]) return state.ranks[ind];
    const key = 'rank|' + ind + '|' + state.year;
    if (state.yearCache[key]) return state.yearCache[key];
    const vals = valuesFor(ind);
    const list = COUNTRIES.filter(c => vals[c.iso3]).sort((a, b) => vals[b.iso3][1] - vals[a.iso3][1]);
    const m = new Map(list.map((c, i) => [c.iso3, i + 1]));
    m.total = list.length;
    return (state.yearCache[key] = m);
  }
  function layerT(iso3, ind = state.layer) {
    const v = valuesFor(ind)?.[iso3];
    if (!v) return null;
    if (LAYERS[ind].scale === 'div') return Math.max(-1, Math.min(1, v[1] / 8));
    const [lo, hi] = domainFor(ind);
    return v[1] > 0 ? Math.max(0, Math.min(1, (Math.log10(v[1]) - lo) / (hi - lo || 1))) : 0;
  }
  // colour scale: fixed across all years (from the full history) so the time slider shows real change
  function domainFor(ind) {
    const h = state.history[ind], g = state.global[ind];
    const src = h || g;
    if (!src) return [0, 1];
    if (src._domain) return src._domain;
    const vals = h ? Object.values(h.values).flat() : COUNTRIES.map(c => g.values[c.iso3]?.[1]);
    const logs = vals.filter(v => v > 0).map(Math.log10).sort((a, b) => a - b);
    // 2% / 99% quantiles so outliers don't wash everyone out
    const q = p => logs[Math.max(0, Math.min(logs.length - 1, Math.round(p * (logs.length - 1))))];
    return (src._domain = logs.length ? [q(0.02), q(0.99)] : [0, 1]);
  }
  function colourFor(iso3, alphaMul = 1) {
    const t = layerT(iso3);
    if (t == null) return `rgba(70,100,120,${0.16 * alphaMul})`;
    if (LAYERS[state.layer].scale === 'div') {
      const c = t >= 0 ? [0, 229, 255] : [255, 120, 60];
      return `rgba(${c},${(0.12 + Math.abs(t) * 0.68) * alphaMul})`;
    }
    return `rgba(${ramp(t)},${(0.06 + t * 0.5) * alphaMul})`;
  }
  function computeRanks(ind) {
    const g = state.global[ind];
    if (!g) return;
    const list = COUNTRIES.filter(c => g.values[c.iso3]).sort((a, b) => g.values[b.iso3][1] - g.values[a.iso3][1]);
    state.ranks[ind] = new Map(list.map((c, i) => [c.iso3, i + 1]));
    state.ranks[ind].total = list.length;
  }

  // ------------------------------------------------------------ globe
  const wrap = $('globeWrap');
  const globe = new Globe($('globe'), { rendererConfig: { antialias: true, alpha: true }, animateIn: true })
    .width(innerWidth).height(innerHeight)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true).atmosphereColor('#19d8ff').atmosphereAltitude(0.22)
    .showGraticules(true)
    .polygonsTransitionDuration(900)
    .pointOfView({ lat: 22, lng: 10, altitude: 5.5 });

  if (location.search.includes('debug')) window.ATLAS_DEBUG = { globe, styleGlobe: () => styleGlobe(), paint: () => paintSurface() };

  globe.renderer().setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));

  const mat = globe.globeMaterial();
  mat.color.set('#04141f');
  mat.emissive.set('#032635');
  mat.emissiveIntensity = 0.55;
  mat.shininess = 12;

  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.minDistance = 101 * 1.15;

  addEventListener('resize', () => globe.width(innerWidth).height(innerHeight));

  let features = [];

  // ------------------------------------------------------------ hit testing
  // Country shapes are painted into the globe texture (see below), so hover and click
  // are resolved here: screen point -> lat/lng -> country, hotspot or capital beacon.
  function inRing(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function featureContains(f, lng, lat) {
    const b = f.bbox;
    if (b && (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3])) return false;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    return polys.some(p => inRing(p[0], lng, lat) && !p.slice(1).some(h => inRing(h, lng, lat)));
  }
  function featureAt(lat, lng) {
    return features.find(f => featureContains(f, lng, lat)) || null;
  }
  // -> country | hotspot (has .hot) | { nonUN: name } | null
  function hitTest(clientX, clientY) {
    const wr = wrap.getBoundingClientRect();
    const x = clientX - wr.left, y = clientY - wr.top;
    const pov = globe.pointOfView();
    const horizon = Math.acos(1 / (1 + pov.altitude)) * 180 / Math.PI;
    const screenDist = (lat, lng) => {
      if (angularDistance(pov, { lat, lng }) > horizon) return Infinity;
      const p = globe.getScreenCoords(lat, lng, 0.01);
      return Math.hypot(p.x - x, p.y - y);
    };
    if (hotOn) {
      let bestH = null, dH = 9;
      for (const h of state.hotspots) { const d = screenDist(h.lat, h.lng); if (d < dH) { dH = d; bestH = h; } }
      if (bestH) return bestH;
    }
    let best = null, bestD = 14; // tiny states: nearest capital beacon wins
    for (const c of COUNTRIES) {
      if (c.lat == null) continue;
      const d = screenDist(c.lat, c.lng);
      if (d < bestD) { bestD = d; best = c; }
    }
    const g = globe.toGlobeCoords(x, y);
    const f = g ? featureAt(g.lat, g.lng) : null;
    if (f && (!best || bestD > 6)) return f.country || { nonUN: f.properties.name || 'Territory' };
    return best;
  }
  function activate(hit) {
    if (!hit) return;
    if (hit.hot) {
      if (hit.country) select(hit.country);
      else toast(`HOTSPOT · ${hit.name.toUpperCase()} · OUTSIDE UN MEMBER TERRITORY`);
    } else if (hit.nonUN) {
      toast(`NO UN RECORD · ${hit.nonUN.toUpperCase()} IS NOT A UN MEMBER STATE`);
    } else select(hit);
  }

  const globeEl = $('globe');
  let downAt = null, hoverRaf = 0, lastMove = null;
  globeEl.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  globeEl.addEventListener('click', e => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // was a drag
    activate(hitTest(e.clientX, e.clientY));
  });
  globeEl.addEventListener('pointermove', e => {
    if (e.buttons) { if (state.hover || tooltip.style.display === 'block') setHover(null); return; } // rotating
    lastMove = e;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (lastMove) setHover(hitTest(lastMove.clientX, lastMove.clientY));
    });
  });
  globeEl.addEventListener('pointerleave', () => { lastMove = null; setHover(null); });

  async function loadGeometry() {
    const hi = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json').then(r => r.json());
    features = topojson.feature(hi, hi.objects.countries).features;
    for (const f of features) {
      f.country = byNum.get(f.id) || null;
      if (f.country) f.country.feature = f;
    }
    buildSurfacePaths();

    // the only 3D country shape: the selected nation rising off the globe
    globe
      .polygonCapCurvatureResolution(4)
      .polygonAltitude(() => selAlt)
      .polygonCapColor(() => 'rgba(0, 229, 255, 0.78)')
      .polygonSideColor(() => 'rgba(0, 229, 255, 0.35)')
      .polygonStrokeColor(() => '#d6fbff');

    // hover outline (a few thin lines instead of re-building country meshes)
    globe
      .pathsData([])
      .pathPoints(d => d)
      .pathPointLat(p => p[1])
      .pathPointLng(p => p[0])
      .pathPointAlt(0.004)
      .pathColor(() => 'rgba(200, 252, 255, 0.95)')
      .pathTransitionDuration(0);

    // capitals as small beacons, merged into ONE mesh; tiny island states get a bigger one
    globe
      .pointsData(COUNTRIES.filter(c => c.lat != null))
      .pointLat('lat').pointLng('lng')
      .pointsMerge(true)
      .pointsTransitionDuration(0);

    // pulse rings: the selected capital (cyan) + the biggest news hotspots (amber to red)
    globe
      .ringLat('lat').ringLng('lng')
      .ringColor(d => d.sel ? (t => `rgba(0, 229, 255, ${1 - t})`) : (t => `rgba(${hotColour(d)}, ${(1 - t) * 0.85})`))
      .ringMaxRadius(d => d.sel ? 4.5 : 0.8 + d.t * 3.2)
      .ringPropagationSpeed(d => d.sel ? 2.6 : 0.9 + d.t * 1.6)
      .ringRepeatPeriod(d => d.sel ? 850 : 2300 - d.t * 1400)
      .ringAltitude(d => d.sel ? selAlt + 0.002 : 0.004);

    styleGlobe();
  }

  // ------------------------------------------------------------ globe surface texture
  // Country colours, borders and hotspot dots are painted into the globe's own texture:
  // one draw call, instead of ~3 meshes per country shape (thousands of draw calls).
  const TEX_W = 4096, TEX_H = 2048;
  const surface = document.createElement('canvas');
  surface.width = TEX_W;
  surface.height = TEX_H;
  const sg = surface.getContext('2d');
  const sky = document.createElement('canvas');
  sky.width = DayNight.W;
  sky.height = DayNight.H;
  let skyReady = false, texObj = null, paintQueued = false, bootstrapping = false;
  let unBorders = null, otherBorders = null;
  const tx = lng => (lng + 180) / 360 * TEX_W;
  const ty = lat => (90 - lat) / 180 * TEX_H;

  function buildSurfacePaths() {
    unBorders = new Path2D();
    otherBorders = new Path2D();
    for (const f of features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const p = new Path2D();
      let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
      for (const poly of polys) for (const ring of poly) {
        ring.forEach(([lng, lat], i) => {
          i ? p.lineTo(tx(lng), ty(lat)) : p.moveTo(tx(lng), ty(lat));
          if (lng < x0) x0 = lng; if (lng > x1) x1 = lng; if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
        });
        p.closePath();
      }
      f.path = p;
      f.bbox = [x0, y0, x1, y1];
      (f.country ? unBorders : otherBorders).addPath(p);
    }
  }

  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    setTimeout(paintSurface, 0);
  }
  function paintSurface() {
    paintQueued = false;
    if (!features.length) return;
    const sel = state.selected;
    if (skyReady) sg.drawImage(sky, 0, 0, TEX_W, TEX_H);
    else { sg.fillStyle = '#071c27'; sg.fillRect(0, 0, TEX_W, TEX_H); }
    for (const f of features) {
      sg.fillStyle = f.country ? colourFor(f.country.iso3, sel ? 0.35 : 1) : (sel ? 'rgba(40,60,70,0.05)' : 'rgba(60,80,90,0.12)');
      sg.fill(f.path, 'evenodd');
    }
    sg.lineJoin = 'round';
    sg.lineWidth = 1.4;
    sg.strokeStyle = 'rgba(0, 229, 255, 0.18)';
    sg.stroke(otherBorders);
    sg.lineWidth = 1.8;
    sg.strokeStyle = sel ? 'rgba(0, 229, 255, 0.35)' : 'rgba(0, 229, 255, 0.6)';
    sg.stroke(unBorders);
    if (hotOn) {
      for (const h of state.hotspots) {
        // widen by 1/cos(lat) so dots stay round on the sphere
        const x = tx(h.lng), y = ty(h.lat), r = 4 + h.t * 9, k = 1 / Math.max(0.2, Math.cos(h.lat * Math.PI / 180));
        const col = hotColour(h);
        sg.fillStyle = `rgba(${col}, 0.22)`;
        sg.beginPath(); sg.ellipse(x, y, r * 2.4 * k, r * 2.4, 0, 0, Math.PI * 2); sg.fill();
        sg.fillStyle = `rgba(${col}, 0.95)`;
        sg.beginPath(); sg.ellipse(x, y, r * k, r, 0, 0, Math.PI * 2); sg.fill();
      }
    }
    pushTexture();
  }
  function pushTexture() {
    if (texObj) { texObj.needsUpdate = true; return; }
    if (bootstrapping) return;
    // first time: let globe.gl create its texture from an image, then keep feeding it our canvas
    bootstrapping = true;
    const prev = mat.map, until = performance.now() + 20000;
    globe.globeImageUrl(surface.toDataURL('image/jpeg', 0.8));
    (function waitForTexture() {
      if (mat.map && mat.map !== prev) {
        texObj = mat.map;
        texObj.image = surface;
        texObj.anisotropy = Math.min(8, globe.renderer().capabilities.getMaxAnisotropy());
        texObj.needsUpdate = true;
        if (mat.color) mat.color.set('#ffffff');
        if (mat.emissive) mat.emissive.set('#000000');
        bootstrapping = false;
      } else if (performance.now() < until) setTimeout(waitForTexture, 50);
      else bootstrapping = false;
    })();
  }

  // how far the selected nation rises: proportional to zoom so small states don't turn into towers
  let selAlt = 0.05;
  function styleGlobe() {
    const sel = state.selected;
    schedulePaint();
    globe.polygonsData(sel?.feature ? [sel.feature] : []);
    globe
      .pointAltitude(c => c === sel ? selAlt + 0.003 : c.shape ? 0.008 : 0.02)
      .pointRadius(c => c === sel ? 0.05 : c.shape ? (sel ? 0.045 : 0.09) : (sel ? 0.15 : 0.3))
      .pointColor(c => c === sel ? '#ffb300' : c.shape ? 'rgba(160, 245, 255, 0.85)' : '#00e5ff');
    updateHoverOutline();
  }
  function updateHoverOutline() {
    const f = state.hover && state.hover !== state.selected ? state.hover.feature : null;
    if (!f) { globe.pathsData([]); return; }
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    globe.pathsData(polys.map(p => p[0]).filter(r => r.length > 6).sort((a, b) => b.length - a.length).slice(0, 14));
  }

  // ------------------------------------------------------------ hover tooltip
  const tooltip = $('tooltip');
  let mouse = { x: 0, y: 0 }, mouseOnGlobe = false;
  addEventListener('mousemove', e => {
    mouse = { x: e.clientX, y: e.clientY };
    // the globe never gets a "leave" when the pointer slides onto a HUD panel
    mouseOnGlobe = e.target.tagName === 'CANVAS';
    if (!mouseOnGlobe) { if (tooltip.style.display === 'block' || state.hover) setHover(null); return; }
    if (tooltip.style.display === 'block') placeTooltip();
  });
  function placeTooltip() {
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    let x = mouse.x + 18, y = mouse.y + 14;
    if (x + w > innerWidth - 8) x = mouse.x - w - 18;
    if (y + h > innerHeight - 40) y = mouse.y - h - 14;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }
  function setHover(c) {
    if (!mouseOnGlobe) c = null; // globe.gl re-fires hover during camera flights at a stale pointer position
    const country = c && !c.nonUN && !c.hot ? c : null;
    const changed = country !== state.hover;
    state.hover = country;
    if (!c) { tooltip.style.display = 'none'; }
    else if (c.hot) {
      tooltip.innerHTML = `<div class="tt-name" style="color:rgb(${hotColour(c)})">&#9673; NEWS HOTSPOT</div>
        <div class="tt-name">${esc(c.name)}</div>
        <div class="tt-row">ARTICLES (24H): <b>${c.articles.toLocaleString('en-US')}</b></div>
        <div class="tt-row">CONFLICT SHARE: <b>${Math.round(c.conflict * 100)}%</b> · TONE <b>${c.tone > 0 ? '+' : ''}${c.tone.toFixed(1)}</b></div>
        ${c.source ? `<div class="tt-row">TOP SOURCE: <b>${esc(c.source)}</b></div>` : ''}
        ${c.country ? '<div class="tt-row">CLICK TO OPEN DOSSIER</div>' : ''}`;
      tooltip.style.display = 'block'; placeTooltip();
    } else if (c.nonUN) {
      tooltip.innerHTML = `<div class="tt-name">${esc(c.nonUN)}</div><div class="tt-row">NOT A UN MEMBER STATE</div>`;
      tooltip.style.display = 'block'; placeTooltip();
    } else {
      const L = LAYERS[state.layer], v = valuesFor()?.[c.iso3];
      const rk = ranksFor(), r = rk?.get(c.iso3);
      tooltip.innerHTML = `<div class="tt-name">${esc(c.name)}${c.status === 'observer' ? '<span class="obs">OBS</span>' : ''}</div>
        <div class="tt-row">${L.short}: <b>${v ? L.fmt(v[1]) : 'N/A'}</b>${v ? ` · ${v[0]}` : state.year ? ` · ${state.year}` : ''}</div>
        ${r ? `<div class="tt-row">RANK <b>#${r}</b> / ${rk.total}</div>` : ''}
        <div class="tt-row">CAPITAL <b>${esc(c.capital || '—')}</b></div>`;
      tooltip.style.display = 'block'; placeTooltip();
    }
    document.body.style.cursor = c ? 'pointer' : '';
    if (changed) updateHoverOutline();
  }

  // ------------------------------------------------------------ selection
  const body = document.body;
  const link = $('link'), linkPath = $('linkPath'), linkStart = $('linkStart');
  const lock = $('lock');

  // camera target: centre of the nation's main landmass (not its capital, which is often on a coast)
  function viewFor(c) {
    const f = c.feature;
    if (!f) return { lat: c.lat, lng: c.lng, altitude: 0.35 };
    // extent of the largest polygon only (ignore far-flung overseas territories)
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null, bestArea = -1;
    for (const p of polys) {
      let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
      for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (x1 - x0 > 300) continue; // ring wraps the antimeridian; bbox would be meaningless
      const area = (x1 - x0) * (y1 - y0);
      if (area > bestArea) { bestArea = area; best = [x0, x1, y0, y1]; }
    }
    if (!best) return { lat: c.lat, lng: c.lng, altitude: 1.2 };
    const [x0, x1, y0, y1] = best;
    const span = Math.max(y1 - y0, (x1 - x0) * Math.cos(((y0 + y1) / 2) * Math.PI / 180));
    const altitude = Math.max(0.32, Math.min(2.1, span / 24));
    // big countries: frame the landmass; small ones: the capital is close enough
    const w = Math.min(1, span / 6);
    return {
      lat: c.lat + ((y0 + y1) / 2 - c.lat) * w,
      lng: c.lng + ((x0 + x1) / 2 - c.lng) * w,
      altitude,
    };
  }

  let selectSeq = 0;
  function select(c, { fromHash = false, tab = null } = {}) {
    if (!c) return;
    if (tab && tab !== state.tab) { state.tab = tab; for (const b of $('dTabs').children) b.classList.toggle('on', b.dataset.tab === tab); }
    if (state.selected === c) { if (tab) renderTab(); return; }
    const seq = ++selectSeq;
    state.selected = c;
    tooltip.style.display = 'none';
    closeSearch();

    body.classList.add('focused');
    controls.autoRotate = false;
    link.classList.remove('on');
    lock.classList.remove('on');
    void lock.offsetWidth; // restart the lock-on animation

    const view = viewFor(c);
    selAlt = Math.min(0.08, 0.012 + view.altitude * 0.05);
    styleGlobe();
    updateRings();
    globe.pointOfView(view, 1700);

    renderHeader(c);
    boot(c);
    holoIn(['.dossier-head', '#dTabs', '#dBody'], 420);
    setTimeout(() => { if (seq === selectSeq) laserScan(c); }, 1750);
    $('lockLabel').textContent = (c.capital || c.name).toUpperCase();
    setTimeout(() => { if (seq === selectSeq) lock.classList.add('on'); }, 1350);
    setTimeout(() => { if (seq === selectSeq) link.classList.add('on'); }, 1600);

    if (!fromHash) history.replaceState(null, '', '#' + c.iso3);
    renderTab();
  }

  function deselect() {
    if (!state.selected) return;
    const c = state.selected;
    selectSeq++;
    state.selected = null;
    clearScan();
    body.classList.remove('focused');
    link.classList.remove('on');
    lock.classList.remove('on');
    updateRings();
    styleGlobe();
    globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: 2.5 }, 1400);
    setTimeout(() => { if (!state.selected) controls.autoRotate = true; }, 1500);
    history.replaceState(null, '', location.pathname);
  }

  // per-frame: keep the connector line + lock reticle glued to the capital
  function angularDistance(a, b) {
    const r = Math.PI / 180;
    const cos = Math.sin(a.lat * r) * Math.sin(b.lat * r) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((a.lng - b.lng) * r);
    return Math.acos(Math.max(-1, Math.min(1, cos))) / r;
  }
  let frame = 0;
  function tick() {
    requestAnimationFrame(tick);
    frame++;
    const pov = globe.pointOfView();
    if (frame % 10 === 0) {
      $('hudPov').textContent = `LAT ${pov.lat.toFixed(1)} · LNG ${pov.lng.toFixed(1)} · ALT ${pov.altitude.toFixed(2)}`;
    }
    const c = state.selected;
    if (!c) return;
    const horizon = Math.acos(1 / (1 + pov.altitude)) * 180 / Math.PI;
    const visible = angularDistance(pov, c) < horizon * 0.96;
    link.classList.toggle('hidden', !visible);
    lock.classList.toggle('hidden', !visible);
    if (!visible) return;

    const p = globe.getScreenCoords(c.lat, c.lng, selAlt);
    const wr = wrap.getBoundingClientRect();
    const cx = p.x + wr.left, cy = p.y + wr.top;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    lock.style.transform = `translate(${cx}px, ${cy}px)`;

    const ar = $('dossierAnchor').getBoundingClientRect();
    const dr = $('dossier').getBoundingClientRect();
    const ax = dr.right + 3, ay = ar.top + ar.height / 2;
    if (cx < ax + 40) { link.classList.add('hidden'); return; }
    const mx = ax + Math.max(36, (cx - ax) * 0.38);
    linkPath.setAttribute('d', `M ${ax} ${ay} H ${mx} V ${cy} H ${cx - 9}`);
    linkStart.setAttribute('cx', ax);
    linkStart.setAttribute('cy', ay);
  }

  // ------------------------------------------------------------ dossier
  function renderHeader(c) {
    $('dFlag').innerHTML = flagImg(c, 160);
    $('dName').textContent = c.name;
    $('dSub').textContent = `TARGET ACQUIRED · ${c.iso3}${c.status === 'observer' ? ' · UN OBSERVER STATE' : ' · UN MEMBER STATE'}`;
    $('dMeta').innerHTML = `CAPITAL <b>${esc(c.capital || '—')}</b> · ${c.lat?.toFixed(2)}°, ${c.lng?.toFixed(2)}°<br>${esc(c.region)} · <b>${esc(c.income)}</b>`;
    updateWatchBtn();
  }

  function boot(c) {
    const el = $('boot');
    const lines = [
      `> ESTABLISHING UPLINK :: ${c.iso3}-${c.num}`,
      `> TRIANGULATING ${c.lat?.toFixed(3)}N ${c.lng?.toFixed(3)}E`,
      `> DECRYPTING WORLD BANK WDI ARCHIVE`,
      `> SCANNING NEWS SPECTRUM`,
    ];
    el.innerHTML = lines.map((l, i) => `<div style="animation-delay:${i * 0.22}s">${esc(l)} <span class="ok">[OK]</span></div>`).join('');
    el.classList.add('on');
    clearTimeout(boot.t);
    boot.t = setTimeout(() => el.classList.remove('on'), 2300);
  }

  function setTab(t) {
    state.tab = t;
    for (const b of $('dTabs').children) b.classList.toggle('on', b.dataset.tab === t);
    holoIn(['#dBody']);
    renderTab();
  }

  async function getEcon(c) {
    if (!state.econ[c.iso3]) {
      state.econ[c.iso3] = getJSON(`api/econ/${c.iso3}.json`)
        .then(d => { (state.econLoaded ||= new Set()).add(c.iso3); return d; })
        .catch(e => { delete state.econ[c.iso3]; throw e; });
    }
    return state.econ[c.iso3];
  }

  // instant summary from the globe's layer data while the full history downloads
  function quickLook(c) {
    const row = (ind, k) => {
      const v = state.global[ind]?.values?.[c.iso3];
      return v ? `<div class="tile"><div class="k">${k}</div><div class="v">${LAYERS[ind].fmt(v[1])}</div><div class="y">${v[0]}</div></div>` : '';
    };
    const tiles = row('NY.GDP.MKTP.CD', 'GDP') + row('NY.GDP.PCAP.CD', 'GDP per capita') + row('NE.EXP.GNFS.CD', 'Exports') + row('NE.IMP.GNFS.CD', 'Imports');
    return `${tiles ? `<div class="sec-title">SNAPSHOT</div><div class="tiles">${tiles}</div>` : ''}
      <div class="loading">LOADING TIME SERIES</div>`;
  }

  function latest(series) {
    return series && series.length ? series[series.length - 1] : null;
  }

  async function renderTab() {
    const c = state.selected;
    if (!c) return;
    const tab = state.tab, out = $('dBody');
    out.innerHTML = (tab === 'economy' || tab === 'trade') && !state.econLoaded?.has(c.iso3) ? quickLook(c) : `<div class="loading">RETRIEVING ${tab.toUpperCase()} DATA</div>`;
    try {
      if (tab === 'economy') await renderEconomy(c, out);
      else if (tab === 'trade') await renderTrade(c, out);
      else if (tab === 'news') await renderNews(c, out);
      else await renderArchive(c, out);
    } catch (e) {
      if (state.selected === c && state.tab === tab) out.innerHTML = `<div class="err">UPLINK FAILURE — ${esc(e.message)}</div>`;
    }
  }
  const stillOn = (c, tab) => state.selected === c && state.tab === tab;

  function tile(k, point, fmt) {
    return point
      ? `<div class="tile"><div class="k">${k}</div><div class="v">${fmt(point[1])}</div><div class="y">${point[0]}</div></div>`
      : `<div class="tile na"><div class="k">${k}</div><div class="v">N/A</div><div class="y">no data</div></div>`;
  }

  async function renderEconomy(c, out) {
    const { series: s } = await getEcon(c);
    if (!stillOn(c, 'economy')) return;
    const gdp = latest(s.gdp), g = latest(s.gdpGrowth);
    const rank = state.ranks['NY.GDP.MKTP.CD']?.get(c.iso3);
    out.innerHTML = `
      <div class="sec-title">GROSS DOMESTIC PRODUCT <span class="yr">${gdp ? gdp[0] : ''}</span></div>
      <div class="hero">
        <div class="hero-val">${usd(gdp?.[1])}</div>
        ${g ? `<div class="hero-sub">REAL GROWTH <span class="delta ${g[1] >= 0 ? 'up' : 'down'}">${g[1] >= 0 ? '▲' : '▼'} ${pct(g[1])}</span></div>` : ''}
        ${rank ? `<div class="hero-sub">RANK <b style="color:#fff">#${rank}</b> / ${state.ranks['NY.GDP.MKTP.CD'].total}</div>` : ''}
      </div>
      <div class="sec-title">INDICATORS</div>
      <div class="tiles">
        ${tile('GDP per capita', latest(s.gdpPerCapita), usd)}
        ${tile('Population', latest(s.population), big)}
        ${tile('Inflation (CPI)', latest(s.inflation), pctPlain)}
        ${tile('Unemployment', latest(s.unemployment), pctPlain)}
        ${tile('Gov. debt / GDP', latest(s.debt), pctPlain)}
        ${tile('Current account / GDP', latest(s.currentAccount), pct)}
      </div>
      <div class="sec-title">GDP TRAJECTORY <span class="yr">US$ · CURRENT</span></div>
      <div id="chGdp"></div>
      <div class="sec-title">REAL GROWTH <span class="yr">ANNUAL %</span></div>
      <div id="chGrowth"></div>
      <div class="note">SOURCE · WORLD BANK WORLD DEVELOPMENT INDICATORS. VALUES ARE THE MOST RECENT YEAR REPORTED.</div>`;
    $('chGdp').replaceWith(lineChart([{ data: s.gdp, color: '#00e5ff', label: 'GDP', fill: true }], usd));
    $('chGrowth').replaceWith(barChart(s.gdpGrowth.slice(-24), pct));
  }

  async function renderTrade(c, out) {
    const { series: s } = await getEcon(c);
    if (!stillOn(c, 'trade')) return;
    const ex = latest(s.exports), im = latest(s.imports);
    const max = Math.max(ex?.[1] || 0, im?.[1] || 0) || 1;
    const bal = ex && im && ex[0] === im[0] ? ex[1] - im[1] : null;
    const exRank = state.ranks['NE.EXP.GNFS.CD']?.get(c.iso3);
    const imRank = state.ranks['NE.IMP.GNFS.CD']?.get(c.iso3);
    const ep = latest(s.exportsPct), ip = latest(s.importsPct);
    const openness = ep && ip && ep[0] === ip[0] ? [ep[0], ep[1] + ip[1]] : null;
    out.innerHTML = `
      <div class="sec-title">TRADE FLOWS <span class="yr">${ex ? ex[0] : ''} · GOODS & SERVICES</span></div>
      <div class="balance">
        <div class="flow exp"><div class="k">▲ EXPORTS${exRank ? ` · #${exRank}` : ''}</div><div class="v">${usd(ex?.[1])}</div>
          <div class="meter"><i style="width:${(ex?.[1] || 0) / max * 100}%"></i></div></div>
        <div class="flow imp"><div class="k">▼ IMPORTS${imRank ? ` · #${imRank}` : ''}</div><div class="v">${usd(im?.[1])}</div>
          <div class="meter"><i style="width:${(im?.[1] || 0) / max * 100}%"></i></div></div>
      </div>
      ${bal != null ? `<div class="net ${bal >= 0 ? 'surplus' : 'deficit'}"><span class="k">TRADE BALANCE · ${bal >= 0 ? 'SURPLUS' : 'DEFICIT'}</span><span class="v">${bal >= 0 ? '+' : ''}${usd(bal)}</span></div>` : ''}
      <div class="sec-title">EXPORTS vs IMPORTS <span class="yr">US$ · CURRENT</span></div>
      <div class="legend-inline"><span><i style="background:#00e5ff"></i>EXPORTS</span><span><i style="background:#ffb300"></i>IMPORTS</span></div>
      <div id="chTrade"></div>
      <div class="sec-title">EXPOSURE</div>
      <div class="tiles">
        ${tile('Exports / GDP', latest(s.exportsPct), pctPlain)}
        ${tile('Imports / GDP', latest(s.importsPct), pctPlain)}
        ${tile('Trade openness', openness, pctPlain)}
        ${tile('Current account / GDP', latest(s.currentAccount), pct)}
        ${tile('FDI net inflows', latest(s.fdi), usd)}
        ${tile('Total reserves', latest(s.reserves), usd)}
      </div>
      <div class="note">SOURCE · WORLD BANK WDI (BALANCE-OF-PAYMENTS BASIS). RANKS ARE AMONG UN MEMBER &amp; OBSERVER STATES WITH DATA.</div>`;
    $('chTrade').replaceWith(lineChart([
      { data: s.exports, color: '#00e5ff', label: 'EXP' },
      { data: s.imports, color: '#ffb300', label: 'IMP' },
    ], usd));
  }

  // headlines that actually name the country first, then the rest; newest first within each
  function rankNews(c, items) {
    const name = c.name.toLowerCase();
    const named = n => n.title.toLowerCase().includes(name) ? 0 : 1;
    return items.map(n => ({ ...n, title: cleanTitle(n.title) }))
      .filter(n => n.title)
      .sort((a, b) => named(a) - named(b) || (b.published || '').localeCompare(a.published || ''))
      .slice(0, 40);
  }

  // 1) show the daily snapshot baked by build_data.py instantly, 2) upgrade to live GDELT results
  async function renderNews(c, out, force = false) {
    const lastSeen = store.get('seen.' + c.iso3, null);
    const draw = (data, banner) => {
      if (!stillOn(c, 'news')) return;
      const items = data.items;
      const archived = archiveMerge(c.iso3, items);
      out.innerHTML = `
        ${hotspotsFor(c)}
        ${banner ? `<div class="${banner.err ? 'err' : 'loading'}" style="margin-bottom:8px;padding:8px 10px">${esc(banner.text)}</div>` : ''}
        <div class="news-bar"><span>${items.length} HEADLINES · ${esc(data.label)}${data.fetched ? ' · ' + ago(data.fetched).toUpperCase() : ''}</span>
          <button class="btn" id="newsRefresh">↻ RESCAN</button></div>
        ${items.length ? `<ul class="news">${items.map((n, i) => `
          <li style="animation-delay:${Math.min(i, 12) * 0.04}s">
            <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
            <div class="src"><b>${esc(n.source)}</b> · ${ago(n.published)}${lastSeen && n.published && n.published > lastSeen ? ' · <span class="new">NEW SINCE LAST VISIT</span>' : ''}</div>
          </li>`).join('')}</ul>` : '<div class="loading">NO SIGNALS DETECTED IN THE LAST 7 DAYS</div>'}
        <div class="note">${archived} HEADLINES ARCHIVED IN THIS BROWSER FOR ${esc(c.name.toUpperCase())} · SEE ARCHIVE TAB. NEWS VIA THE GDELT PROJECT.</div>`;
      $('newsRefresh').onclick = () => renderNews(c, out, true).catch(e => { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; });
    };

    let snap = null;
    try {
      const s = await getJSON(`api/news/${c.iso3}.json`);
      snap = { items: rankNews(c, s.items || []), fetched: s.fetched, label: 'DAILY SNAPSHOT' };
    } catch { /* no snapshot yet */ }
    if (snap && !force) draw(snap, { text: 'SCANNING LIVE FEED' });
    else out.innerHTML = `${hotspotsFor(c)}<div class="loading">${force ? 'RESCANNING' : 'SCANNING'} LIVE FEED</div>`;
    store.set('seen.' + c.iso3, new Date().toISOString());

    try {
      const live = await gdelt(`"${c.name}" sourcelang:english`, { force, max: 75 });
      draw({ items: rankNews(c, live.items), fetched: live.fetched, label: live.stale ? 'LAST LIVE SCAN' : 'LIVE · 7 DAYS' },
        live.stale ? { err: true, text: 'LIVE FEED BUSY · SHOWING LAST LIVE SCAN' } : null);
    } catch (e) {
      if (snap) return draw(snap, { err: true, text: 'LIVE FEED BUSY · SHOWING DAILY SNAPSHOT' });
      const saved = store.get('archive.' + c.iso3, []);
      if (saved.length) return draw({ items: saved.slice(0, 40), label: 'SAVED IN THIS BROWSER' }, { err: true, text: 'LIVE FEED BUSY · SHOWING SAVED HEADLINES' });
      draw({ items: [], label: 'NO FEED' }, { err: true, text: e.message + ' · TRY RESCAN IN A MINUTE' });
    }
  }

  async function renderArchive(c, out) {
    const data = { items: store.get('archive.' + c.iso3, []) };
    if (!stillOn(c, 'archive')) return;
    const items = data.items || [];
    out.innerHTML = `
      <div class="news-bar"><span>${items.length} TRACKED HEADLINES · SAVED IN THIS BROWSER</span></div>
      ${items.length ? `<ul class="news">${items.map((n, i) => `
        <li style="animation-delay:${Math.min(i, 12) * 0.04}s">
          <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
          <div class="src"><b>${esc(n.source)}</b> · PUBLISHED ${n.published ? new Date(n.published).toLocaleDateString() : '—'} · LOGGED ${new Date(n.firstSeen).toLocaleDateString()}</div>
        </li>`).join('')}</ul>` : '<div class="loading">ARCHIVE EMPTY — OPEN THE NEWS TAB TO START TRACKING</div>'}`;
  }

  // ------------------------------------------------------------ charts (hand-rolled SVG)
  const W = 400, H = 150, PL = 46, PR = 8, PT = 10, PB = 20;

  function chartShell() {
    const div = document.createElement('div');
    div.className = 'chart';
    return div;
  }

  function lineChart(series, fmt) {
    const div = chartShell();
    const all = series.flatMap(s => s.data || []);
    if (all.length < 2) { div.innerHTML = '<div class="loading" style="animation:none">INSUFFICIENT DATA</div>'; return div; }
    const x0 = Math.min(...all.map(d => d[0])), x1 = Math.max(...all.map(d => d[0]));
    let y0 = Math.min(0, ...all.map(d => d[1])), y1 = Math.max(...all.map(d => d[1]));
    if (y1 === y0) y1 = y0 + 1;
    const sx = x => PL + (x - x0) / (x1 - x0 || 1) * (W - PL - PR);
    const sy = y => PT + (1 - (y - y0) / (y1 - y0)) * (H - PT - PB);
    const ticks = [y0, (y0 + y1) / 2, y1];
    let svg = `<svg viewBox="0 0 ${W} ${H}">
      <defs>${series.map((s, i) => `<linearGradient id="g${i}${s.label}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>
      <g class="grid">${ticks.map(t => `<line x1="${PL}" x2="${W - PR}" y1="${sy(t)}" y2="${sy(t)}"/>`).join('')}</g>
      ${ticks.map(t => `<text class="axis" x="${PL - 6}" y="${sy(t) + 3}" text-anchor="end">${fmt(t)}</text>`).join('')}
      <text class="axis" x="${PL}" y="${H - 4}">${x0}</text>
      <text class="axis" x="${W - PR}" y="${H - 4}" text-anchor="end">${x1}</text>`;
    series.forEach((s, i) => {
      if (!s.data?.length) return;
      const d = s.data.map((p, j) => `${j ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
      if (s.fill) svg += `<path class="area" d="${d} L${sx(s.data.at(-1)[0])},${sy(y0)} L${sx(s.data[0][0])},${sy(y0)} Z" fill="url(#g${i}${s.label})"/>`;
      svg += `<path class="line" pathLength="1" d="${d}" stroke="${s.color}" style="filter:drop-shadow(0 0 3px ${s.color})"/>`;
    });
    svg += `<line class="cursor" x1="0" x2="0" y1="${PT}" y2="${H - PB}"/>`;
    series.forEach((s, i) => { svg += `<circle class="cursor dot${i}" r="3" fill="${s.color}" cx="-10" cy="-10" style="stroke-dasharray:none"/>`; });
    svg += '</svg><div class="readout"></div>';
    div.innerHTML = svg;

    const el = div.querySelector('svg'), cur = div.querySelector('line.cursor'), ro = div.querySelector('.readout');
    el.addEventListener('mousemove', e => {
      const r = el.getBoundingClientRect();
      const vx = (e.clientX - r.left) / r.width * W;
      const year = Math.round(x0 + (vx - PL) / (W - PL - PR) * (x1 - x0));
      const yr = Math.max(x0, Math.min(x1, year));
      cur.setAttribute('x1', sx(yr)); cur.setAttribute('x2', sx(yr));
      const parts = [];
      series.forEach((s, i) => {
        const p = s.data?.find(d => d[0] === yr);
        const dot = div.querySelector('.dot' + i);
        if (p) { dot.setAttribute('cx', sx(p[0])); dot.setAttribute('cy', sy(p[1])); parts.push(`<span style="color:${s.color}">${s.label} ${fmt(p[1])}</span>`); }
        else dot.setAttribute('cx', -10);
      });
      ro.innerHTML = `${yr} · ${parts.join(' · ') || 'n/a'}`;
      ro.style.left = (sx(yr) / W * 100) + '%';
    });
    return div;
  }

  function barChart(data, fmt) {
    const div = chartShell();
    if (!data?.length) { div.innerHTML = '<div class="loading" style="animation:none">INSUFFICIENT DATA</div>'; return div; }
    const h = 120;
    const vals = data.map(d => d[1]);
    const y0 = Math.min(0, ...vals), y1 = Math.max(0, ...vals) || 1;
    const sy = y => PT + (1 - (y - y0) / (y1 - y0 || 1)) * (h - PT - PB);
    const bw = (W - PL - PR) / data.length;
    let svg = `<svg viewBox="0 0 ${W} ${h}">
      <g class="grid"><line x1="${PL}" x2="${W - PR}" y1="${sy(0)}" y2="${sy(0)}" style="stroke:rgba(0,229,255,.3)"/></g>
      <text class="axis" x="${PL - 6}" y="${sy(y1) + 3}" text-anchor="end">${fmt(y1)}</text>
      <text class="axis" x="${PL - 6}" y="${sy(0) + 3}" text-anchor="end">0%</text>
      ${y0 < 0 ? `<text class="axis" x="${PL - 6}" y="${sy(y0) + 3}" text-anchor="end">${fmt(y0)}</text>` : ''}
      <text class="axis" x="${PL}" y="${h - 4}">${data[0][0]}</text>
      <text class="axis" x="${W - PR}" y="${h - 4}" text-anchor="end">${data.at(-1)[0]}</text>`;
    data.forEach(([yr, v], i) => {
      const y = v >= 0 ? sy(v) : sy(0), hh = Math.abs(sy(v) - sy(0));
      svg += `<rect class="bar ${v < 0 ? 'neg' : ''}" style="animation-delay:${i * 0.025}s" x="${PL + i * bw + bw * 0.18}" y="${y}" width="${bw * 0.64}" height="${Math.max(0.5, hh)}" fill="${v >= 0 ? '#00e5ff' : '#ff6a3d'}" opacity=".85"><title>${yr}: ${fmt(v)}</title></rect>`;
    });
    div.innerHTML = svg + '</svg>';
    return div;
  }

  // ------------------------------------------------------------ nations index
  function renderIndex() {
    const ind = state.layer, L = LAYERS[ind], vals = valuesFor(ind);
    $('indexMetric').textContent = L.short + (state.year ? ' · ' + state.year : '');
    let list = COUNTRIES.slice();
    if (state.indexTab === 'watch') list = list.filter(c => state.watch.has(c.iso3));
    const val = c => vals?.[c.iso3]?.[1];
    list.sort((a, b) => (val(b) ?? -Infinity) - (val(a) ?? -Infinity) || a.name.localeCompare(b.name));
    $('indexCount').textContent = list.length;
    const rk = ranksFor(ind);
    $('indexList').innerHTML = list.length ? list.map(c => {
      const v = val(c), t = layerT(c.iso3);
      return `<li data-iso="${c.iso3}">
        <span class="rk">${rk?.get(c.iso3) ? '#' + rk.get(c.iso3) : '—'}</span>
        <span class="fl">${flagImg(c, 40)}</span>
        <span class="nm">${esc(c.name)}${c.status === 'observer' ? '<span class="obs">OBS</span>' : ''}</span>
        <span class="vl">${v != null ? L.fmt(v) : 'N/A'}</span>
        <span class="bar"><i style="width:${t == null ? 0 : Math.abs(t) * 100}%;${t < 0 ? 'background:#ff6a3d' : ''}"></i></span>
      </li>`;
    }).join('') : `<li class="empty">${state.indexTab === 'watch' ? 'WATCHLIST EMPTY — OPEN A NATION AND PRESS ☆ TO TRACK IT.' : 'NO DATA'}</li>`;
  }
  $('indexList').addEventListener('click', e => {
    const li = e.target.closest('li[data-iso]');
    if (li) select(byIso3.get(li.dataset.iso));
  });
  document.querySelector('.index-tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.indexTab = b.dataset.tab;
    for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
    renderIndex();
  });

  // ------------------------------------------------------------ watchlist
  function updateWatchBtn() {
    const on = state.selected && state.watch.has(state.selected.iso3);
    $('watchBtn').classList.toggle('on', !!on);
    $('watchBtn').textContent = on ? '★' : '☆';
    $('watchBtn').title = on ? 'Remove from watchlist' : 'Add to watchlist';
  }
  $('watchBtn').onclick = () => {
    const c = state.selected;
    if (!c) return;
    state.watch.has(c.iso3) ? state.watch.delete(c.iso3) : state.watch.add(c.iso3);
    store.set('watch', [...state.watch]);
    updateWatchBtn();
    renderIndex();
    toast(state.watch.has(c.iso3) ? `${c.name.toUpperCase()} ADDED TO WATCHLIST` : `${c.name.toUpperCase()} REMOVED FROM WATCHLIST`);
  };

  // ------------------------------------------------------------ layers
  async function setLayer(ind) {
    state.layer = ind;
    for (const b of $('layers').children) b.classList.toggle('on', b.dataset.ind === ind);
    const L = LAYERS[ind];
    $('legendTitle').textContent = L.label;
    try {
      await Promise.all([loadGlobal(ind), loadHistory(ind).catch(() => {})]);
    } catch (e) {
      toast('LAYER DATA UNAVAILABLE · ' + e.message);
    }
    if (state.layer !== ind) return;
    configureRange();
    if (L.scale === 'div') {
      $('legendBar').style.background = 'linear-gradient(90deg, rgba(255,120,60,.9), rgba(255,120,60,.1), rgba(0,229,255,.1), rgba(0,229,255,.9))';
      $('legendMin').textContent = '-8%'; $('legendMax').textContent = '+8%';
    } else {
      $('legendBar').style.background = `linear-gradient(90deg, ${[0, .33, .66, 1].map(t => `rgb(${ramp(t)})`).join(',')})`;
      const [lo, hi] = domainFor(ind);
      $('legendMin').textContent = L.fmt(10 ** lo); $('legendMax').textContent = L.fmt(10 ** hi);
    }
    styleGlobe();
    renderIndex();
  }
  async function loadHistory(ind) {
    if (state.history[ind]) return;
    state.history[ind] = await getJSON(`api/history/${ind}.json`);
  }
  async function loadGlobal(ind) {
    if (state.global[ind]) return;
    state.global[ind] = await getJSON(`api/global/${ind}.json`);
    computeRanks(ind);
  }
  $('layers').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setLayer(b.dataset.ind); });

  // ------------------------------------------------------------ search
  const search = $('search'), results = $('searchResults');
  let hits = [], active = 0;
  function closeSearch() { results.classList.remove('open'); }
  function doSearch() {
    const q = search.value.trim().toLowerCase();
    if (!q) { closeSearch(); return; }
    const score = c => {
      const n = c.name.toLowerCase();
      if (c.iso3.toLowerCase() === q) return 0;
      if (n.startsWith(q)) return 1;
      if (n.includes(q)) return 2;
      if ((c.capital || '').toLowerCase().startsWith(q)) return 3;
      return 9;
    };
    hits = COUNTRIES.map(c => [score(c), c]).filter(x => x[0] < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, 10).map(x => x[1]);
    active = 0;
    results.innerHTML = hits.length ? hits.map((c, i) => `<li data-iso="${c.iso3}" class="${i === 0 ? 'active' : ''}"><span class="flag">${flagImg(c, 40)}</span>${esc(c.name)}<span class="sr-cap">${esc(c.capital || '')} · ${c.iso3}</span></li>`).join('')
      : '<li style="cursor:default;color:var(--muted)">NO MATCH</li>';
    results.classList.add('open');
  }
  search.addEventListener('input', doSearch);
  search.addEventListener('focus', doSearch);
  search.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % (hits.length || 1);
      [...results.children].forEach((li, i) => li.classList.toggle('active', i === active));
    } else if (e.key === 'Enter' && hits[active]) {
      select(hits[active]); search.value = ''; search.blur();
    } else if (e.key === 'Escape') { search.blur(); closeSearch(); }
  });
  results.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-iso]');
    if (li) { e.preventDefault(); select(byIso3.get(li.dataset.iso)); search.value = ''; search.blur(); }
  });
  search.addEventListener('blur', () => setTimeout(closeSearch, 120));

  // ------------------------------------------------------------ misc UI
  $('closeBtn').onclick = deselect;
  $('dTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  addEventListener('keydown', e => {
    if (!body.classList.contains('engaged') || CommandBar.isOpen) return;
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (e.key === 'Escape' && !typing) deselect();
    if (e.key === '/' && !typing) { e.preventDefault(); search.focus(); }
  });
  $('cmdBtn').addEventListener('click', () => CommandBar.open());
  addEventListener('hashchange', () => {
    if (!body.classList.contains('engaged')) return;
    const c = byIso3.get(location.hash.slice(1).toUpperCase());
    if (c) select(c, { fromHash: true });
  });

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    holoIn([t]);
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('on'), 3200);
  }

  function clock() {
    const d = new Date();
    $('clock').textContent = d.toISOString().slice(11, 19);
  }
  setInterval(clock, 1000); clock();

  const WORLD_QUERY = 'sourcelang:english (economy OR markets OR trade OR election OR summit)'; // keep in sync with build_data.py
  async function loadTicker() {
    const show = items => {
      if (!items?.length) return false;
      const html = items.slice(0, 30).map(n => `<span class="ts">${n.published ? new Date(n.published).toISOString().slice(11, 16) + 'Z' : ''}</span><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(cleanTitle(n.title))}${n.source ? ' — ' + esc(n.source) : ''}</a><span class="sep">◆</span>`).join('');
      const inner = $('tickerInner');
      inner.innerHTML = html + html; // doubled for a seamless loop
      inner.style.setProperty('--dur', Math.max(60, inner.textContent.length * 0.09) + 's');
      inner.classList.add('run');
      return true;
    };
    let shown = false;
    try { shown = show((await getJSON('api/news/_world.json')).items); } catch { /* no snapshot yet */ }
    // with a snapshot on screen, let a country's news use the GDELT rate limit first
    if (shown) await new Promise(r => setTimeout(r, 20000));
    try {
      show((await gdelt(WORLD_QUERY, { timespan: '24h', max: 50, sort: 'datedesc' })).items);
    } catch (e) {
      if (!shown) $('tickerInner').textContent = ONLINE ? 'WORLD FEED OFFLINE · ' + e.message : 'OFFLINE MODE · SERVE THE public/ FOLDER OVER HTTP FOR LIVE DATA';
    }
  }

  async function loadWorldGdp() {
    const v = state.global['NY.GDP.MKTP.CD']?.values?.WLD;
    if (v) { $('worldGdp').textContent = usd(v[1]); $('worldYear').textContent = '· ' + v[0]; }
  }

  // ------------------------------------------------------------ time slider
  const tRange = $('tRange'), tPlay = $('tPlay'), tLive = $('tLive');
  let playTimer = null;
  const historyYears = () => state.history[state.layer]?.years || [];

  function setYear(y) {
    if (y === state.year) return;
    state.year = y;
    body.classList.toggle('time-travel', y != null);
    $('tYear').textContent = y == null ? 'LIVE' : y;
    $('tSub').textContent = y == null ? 'LATEST REPORTED' : 'HISTORICAL VIEW';
    $('yearStamp').textContent = y ?? '';
    tLive.classList.toggle('on', y == null);
    const yrs = historyYears();
    tRange.value = y ?? (yrs.at(-1) || tRange.max);
    rangeFill();
    styleGlobe();
    renderIndex();
  }
  function rangeFill() {
    const min = +tRange.min, max = +tRange.max;
    tRange.style.setProperty('--p', ((tRange.value - min) / (max - min || 1) * 100) + '%');
  }
  function configureRange() {
    const yrs = historyYears();
    if (!yrs.length) return;
    tRange.min = yrs[0];
    tRange.max = yrs.at(-1);
    $('tMin').textContent = yrs[0];
    $('tMax').textContent = yrs.at(-1);
    if (state.year != null) state.year = Math.min(Math.max(state.year, yrs[0]), yrs.at(-1));
    tRange.value = state.year ?? yrs.at(-1);
    rangeFill();
  }
  function playRange(from, to) {
    stopPlay();
    let y = from;
    setYear(y);
    tPlay.textContent = '❚❚';
    tPlay.classList.add('on');
    playTimer = setInterval(() => (y >= to ? stopPlay() : setYear(++y)), 650);
  }
  function stopPlay() {
    clearInterval(playTimer);
    playTimer = null;
    tPlay.textContent = '▶';
    tPlay.classList.remove('on');
  }
  function initTimebar() {
    tRange.addEventListener('input', () => { stopPlay(); setYear(+tRange.value); });
    tLive.addEventListener('click', () => { stopPlay(); setYear(null); });
    tPlay.addEventListener('click', () => {
      if (playTimer) return stopPlay();
      const yrs = historyYears();
      if (!yrs.length) return;
      playRange(state.year == null || state.year >= yrs.at(-1) ? yrs[0] : state.year, yrs.at(-1));
    });
    configureRange();
  }

  // ------------------------------------------------------------ day / night shading
  let nightOn = store.get('opt.night', true);
  let lightsReady = null;
  async function updateSky() {
    // city lights (a 700 KB image) arrive in the background and trigger one more repaint;
    // never make the shading wait for them
    lightsReady ||= DayNight.loadLights('https://cdn.jsdelivr.net/npm/three-globe@2.44.0/example/img/earth-night.jpg')
      .then(() => updateSky());
    const img = await DayNight.render({ night: nightOn });
    sky.getContext('2d').putImageData(img, 0, 0);
    skyReady = true;
    schedulePaint();
    const sun = DayNight.subsolar(new Date());
    $('hudSun').textContent = nightOn
      ? `SUN OVERHEAD ${Math.abs(sun.lat).toFixed(1)}°${sun.lat >= 0 ? 'N' : 'S'} · ${Math.abs(sun.lng).toFixed(1)}°${sun.lng >= 0 ? 'E' : 'W'}`
      : 'SHADING OFF';
  }

  // ------------------------------------------------------------ news hotspots
  let hotOn = store.get('opt.hot', true);
  function hotColour(h) {
    // thresholds ≈ median and top-10% of GDELT's typical conflict share
    return h.conflict >= 0.32 ? [255, 77, 94] : h.conflict >= 0.22 ? [255, 140, 40] : [255, 205, 80];
  }
  function countryAt(lat, lng) {
    return featureAt(lat, lng)?.country || null;
  }
  const stampIso = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`;
  async function loadHotspots() {
    try {
      const d = await getJSON('api/hotspots.json');
      const max = Math.max(1, ...d.spots.map(s => s.articles));
      state.hotspots = d.spots.map(s => ({ ...s, hot: true, t: Math.sqrt(s.articles / max), country: countryAt(s.lat, s.lng) }));
      $('hudHot').textContent = `${d.spots.length} SITES · ${d.hours}H WINDOW · ${ago(stampIso(d.to)).toUpperCase()}`;
    } catch {
      $('hudHot').textContent = 'NO SNAPSHOT YET';
    }
    updateHotspots();
  }
  function updateHotspots() {
    schedulePaint();
    updateRings();
  }
  function updateRings() {
    const data = hotOn ? state.hotspots.slice(0, 24) : [];
    if (state.selected) data.push({ sel: true, lat: state.selected.lat, lng: state.selected.lng });
    globe.ringsData(data);
  }
  function hotspotsFor(c) {
    const list = state.hotspots.filter(h => h.country === c);
    if (!list.length) return '';
    return `<div class="sec-title">ACTIVE NEWS HOTSPOTS <span class="yr">LAST 24H · GDELT EVENTS</span></div>
      <ul class="hotlist">${list.map(h => `<li>
        <i style="background:rgb(${hotColour(h)});color:rgb(${hotColour(h)})"></i>
        <span class="hn">${esc(h.name)}</span>
        <span class="ha">${h.articles.toLocaleString('en-US')} ARTICLES · ${Math.round(h.conflict * 100)}% CONFLICT · TONE ${h.tone > 0 ? '+' : ''}${h.tone.toFixed(1)}</span>
        ${h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">TOP STORY ↗ ${esc(h.source)}</a>` : ''}
      </li>`).join('')}</ul>`;
  }

  // ------------------------------------------------------------ toggles (hands / night / hotspots)
  function renderToggles() {
    const set = (k, on) => document.querySelector(`#toggles [data-t="${k}"]`).classList.toggle('on', on);
    set('hands', Hands.active);
    set('night', nightOn);
    set('hot', hotOn);
  }
  function setOption(k, on) {
    if (k === 'hands') return toggleHands(on);
    if (k === 'night') { nightOn = on ?? !nightOn; store.set('opt.night', nightOn); updateSky(); }
    if (k === 'hot') { hotOn = on ?? !hotOn; store.set('opt.hot', hotOn); updateHotspots(); }
    renderToggles();
  }
  $('toggles').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) setOption(b.dataset.t);
  });


  // ------------------------------------------------------------ hologram effects
  // flicker/glitch elements in (staggered); accepts selectors or elements
  function holoIn(targets, delay = 0) {
    targets.forEach((t, i) => {
      const el = typeof t === 'string' ? document.querySelector(t) : t;
      if (!el) return;
      el.classList.remove('holo-in');
      void el.offsetWidth; // restart the animation
      el.style.animationDelay = `${delay + i * 90}ms`;
      el.classList.add('holo-in');
    });
  }

  // laser sweep across the selected country, clipped to its on-screen outline
  const scanSvg = $('scan');
  let scanTimer = null;
  function clearScan() {
    clearTimeout(scanTimer);
    scanSvg.classList.remove('on');
    scanSvg.innerHTML = '';
  }
  function laserScan(c) {
    clearScan();
    const f = c.feature;
    if (!f || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pov = globe.pointOfView();
    const horizon = Math.acos(1 / (1 + pov.altitude)) * 180 / Math.PI * 0.98;
    const wr = wrap.getBoundingClientRect();
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d = '', x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) {
      const ring = poly[0], stepN = Math.max(1, Math.floor(ring.length / 220)), pts = [];
      for (let i = 0; i < ring.length; i += stepN) {
        const [lng, lat] = ring[i];
        if (angularDistance(pov, { lat, lng }) > horizon) continue;
        const p = globe.getScreenCoords(lat, lng, selAlt);
        const x = p.x + wr.left, y = p.y + wr.top;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (pts.length > 2) d += `M${pts.join('L')}Z`;
    }
    if (!d || x1 - x0 < 6) return;
    const w = x1 - x0, h = y1 - y0, beam = Math.max(24, w * 0.12);
    scanSvg.innerHTML = `
      <defs>
        <clipPath id="scanClip"><path d="${d}"/></clipPath>
        <linearGradient id="scanBeam" x1="0" x2="1">
          <stop offset="0" stop-color="#00e5ff" stop-opacity="0"/>
          <stop offset=".85" stop-color="#00e5ff" stop-opacity=".55"/>
          <stop offset="1" stop-color="#e8feff" stop-opacity="1"/>
        </linearGradient>
        <pattern id="scanGrid" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 .5H6" stroke="rgba(0,229,255,.35)" stroke-width="1"/>
        </pattern>
      </defs>
      <g clip-path="url(#scanClip)">
        <rect class="scan-grid" x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#scanGrid)"/>
        <rect class="scan-beam" x="${x0 - beam}" y="${y0 - 2}" width="${beam}" height="${h + 4}" fill="url(#scanBeam)"/>
      </g>
      <path class="scan-outline" d="${d}" pathLength="1"/>
      <text class="scan-label" x="${x0}" y="${Math.max(16, y0 - 10)}">SCANNING · ${esc(c.iso3)}</text>`;
    scanSvg.classList.add('on');
    const beamEl = scanSvg.querySelector('.scan-beam');
    const dur = Math.min(1600, 700 + w * 1.5);
    beamEl.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${w + beam}px)` }],
      { duration: dur, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
    scanTimer = setTimeout(() => {
      const label = scanSvg.querySelector('.scan-label');
      if (label) label.textContent = `SCAN COMPLETE · ${c.iso3}`;
      scanSvg.classList.add('done');
      scanTimer = setTimeout(clearScan, 900);
    }, dur);
  }
  // a manual drag moves the globe under the overlay: drop it
  $('globe').addEventListener('pointerdown', () => { if (scanSvg.classList.contains('on')) clearScan(); });

  // ------------------------------------------------------------ hand-gesture control
  async function toggleHands(force) {
    const want = force ?? !Hands.active;
    if (want === Hands.active) return renderToggles();
    if (!want) { Hands.stop(); return renderToggles(); }
    try {
      await Hands.start({
        rotate(dx, dy) {
          const p = globe.pointOfView(), k = 0.09 * p.altitude;
          controls.autoRotate = false;
          globe.pointOfView({ lat: Math.max(-85, Math.min(85, p.lat + dy * k)), lng: p.lng - dx * k, altitude: p.altitude });
        },
        zoom(dy) {
          const p = globe.pointOfView();
          controls.autoRotate = false;
          globe.pointOfView({ ...p, altitude: Math.max(0.25, Math.min(5, p.altitude * Math.exp(dy * 0.008))) });
        },
        select(x, y) {
          const hit = hitTest(x, y);
          if (hit) activate(hit);
          else toast('NOTHING UNDER CURSOR');
        },
        close() { deselect(); },
        idle() { if (!state.selected) controls.autoRotate = true; },
        onStateChange: renderToggles,
      });
      toast('HAND LINK ACTIVE · VIDEO STAYS ON THIS DEVICE');
    } catch (e) {
      toast('HAND TRACKING UNAVAILABLE · ' + (e.message || e));
    }
    renderToggles();
  }

  // ------------------------------------------------------------ command bar wiring
  CommandBar.init({
    countries: COUNTRIES,
    byIso3: iso => byIso3.get(iso),
    flag: c => `<span class="fl">${flagImg(c, 40)}</span>`,
    select: (c, tab) => select(c, { tab }),
    reset() { stopPlay(); setYear(null); deselect(); },
    setLayer: ind => setLayer(ind),
    setYear(y) { stopPlay(); setYear(y); },
    play: (from, to) => playRange(from, to),
    years() { const y = historyYears(); return y.length ? [y[0], y.at(-1)] : [1990, new Date().getFullYear() - 1]; },
    layerLabel: (ind = state.layer) => LAYERS[ind].short,
    fmt: (ind, v) => LAYERS[ind].fmt(v),
    async top(ind, n, asc, year) {
      await setLayer(ind);
      stopPlay();
      setYear(year ?? null);
      const vals = valuesFor(ind) || {};
      return COUNTRIES.filter(c => vals[c.iso3])
        .map(c => ({ c, v: vals[c.iso3][1] }))
        .sort((a, b) => asc ? a.v - b.v : b.v - a.v)
        .slice(0, n);
    },
    toggle: (k, on) => setOption(k, on),
    watch(c) {
      state.watch.has(c.iso3) ? state.watch.delete(c.iso3) : state.watch.add(c.iso3);
      store.set('watch', [...state.watch]);
      updateWatchBtn();
      renderIndex();
      return state.watch.has(c.iso3);
    },
    async compare(cs) {
      const data = await Promise.all(cs.map(c => getEcon(c).catch(() => null)));
      const rows = [
        ['GDP', 'gdp', usd, true],
        ['Real growth', 'gdpGrowth', pct, true],
        ['GDP per capita', 'gdpPerCapita', usd, true],
        ['Population', 'population', big, null],
        ['Exports', 'exports', usd, true],
        ['Imports', 'imports', usd, null],
        ['Inflation', 'inflation', pctPlain, false],
        ['Unemployment', 'unemployment', pctPlain, false],
        ['Gov. debt / GDP', 'debt', pctPlain, false],
      ];
      const cell = (d, key) => latest(d?.series?.[key]);
      return `<div class="cmd-title">COMPARISON · LATEST REPORTED</div>
        <table class="cmd-compare"><thead><tr><th></th>${cs.map(c => `<th data-iso="${c.iso3}">${flagImg(c, 40)}<br>${esc(c.name)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(([label, key, fmt, higherBetter]) => {
          const vals = data.map(d => cell(d, key));
          const nums = vals.map(v => v?.[1]).filter(v => v != null);
          const best = higherBetter == null || !nums.length ? null : higherBetter ? Math.max(...nums) : Math.min(...nums);
          return `<tr><td>${label}</td>${vals.map(v => `<td class="${v && v[1] === best && nums.length > 1 ? 'best' : ''}">${v ? fmt(v[1]) : '—'}<small>${v ? v[0] : ''}</small></td>`).join('')}</tr>`;
        }).join('')}</tbody></table>`;
    },
  });

  // ------------------------------------------------------------ boot
  async function main() {
    tick();
    const status = $('sysStatus');
    Intro.step('LINKING ORBITAL RENDERER', 8);
    try {
      await loadGeometry();
      Intro.step(`MAPPING ${features.length} TERRITORIES · ${COUNTRIES.length} NATIONS`, 40);
    } catch (e) {
      status.textContent = 'GEO FAULT';
      Intro.step('WORLD GEOMETRY UPLINK', 100, true);
      await Intro.ready();
      toast('COULD NOT LOAD WORLD GEOMETRY · CHECK INTERNET CONNECTION');
      return;
    }
    renderIndex();
    await setLayer(state.layer);
    Intro.step('DECRYPTING WORLD BANK ARCHIVE', 65, !state.global[state.layer]);
    loadWorldGdp();
    if (ONLINE && state.global[state.layer]) { status.textContent = 'ONLINE'; status.classList.add('ok'); }
    else status.textContent = 'OFFLINE';
    // warm the other layers so ranks are ready in the trade tab
    ['NE.EXP.GNFS.CD', 'NE.IMP.GNFS.CD', 'NY.GDP.PCAP.CD'].forEach(ind => loadGlobal(ind).catch(() => {}));
    initTimebar();
    renderToggles();
    await loadHotspots();
    Intro.step(`TRIANGULATING ${state.hotspots.length} NEWS HOTSPOTS`, 82, !state.hotspots.length);
    await updateSky();
    Intro.step('COMPUTING SOLAR TERMINATOR', 96);

    await Intro.ready();

    // ENGAGE: fly in and glitch the HUD into existence
    globe.pointOfView({ lat: 22, lng: 10, altitude: 2.5 }, 2200);
    holoIn(['#topbar', '#index', '#toggles', '#hud', '#timebar', '#ticker'], 250);
    if (!ONLINE) toast('OFFLINE MODE · SERVE THE public/ FOLDER OVER HTTP (SEE README)');

    setInterval(loadHotspots, 30 * 60 * 1000);
    setInterval(updateSky, 2 * 60 * 1000);
    loadTicker();
    setInterval(loadTicker, 15 * 60 * 1000);
    setInterval(() => { if (state.selected && state.tab === 'news') renderTab(); }, 15 * 60 * 1000);

    const fromHash = byIso3.get(location.hash.slice(1).toUpperCase());
    if (fromHash) setTimeout(() => select(fromHash, { fromHash: true }), 1600);
  }
  main();
})();
