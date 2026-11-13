/* ==========================================================================
   Strike — the maths behind the strike simulation. Pure functions, no DOM.

   Effects radii use the public scaling laws from Glasstone & Dolan,
   "The Effects of Nuclear Weapons" (1977), the same reference behind tools
   such as NUKEMAP. Casualties use the ring model of the US Office of
   Technology Assessment, "The Effects of Nuclear War" (1979), applied to a
   simple population model: every Natural Earth city spread out with an
   exponential density profile, over each country's rural background density.
   These are order-of-magnitude estimates for illustration and education.
   ========================================================================== */
window.Strike = (() => {
  'use strict';
  const R_EARTH = 6371;
  const rad = Math.PI / 180;

  // ---------------------------------------------------------------- weapon effects
  // Radii in km for a yield in kilotons. "air" = burst height that maximises the 5 psi area;
  // "surface" = ground burst (smaller blast radii, a crater and heavy fallout).
  function effects(kt, burst = 'air') {
    const s = Math.cbrt(kt), air = burst === 'air';
    const blast = (k, surfaceFactor) => k * s * (air ? 1 : surfaceFactor);
    const r = {
      fireball: 0.062 * kt ** 0.4 * (air ? 1 : 1.3),
      psi12: blast(0.43, 0.65),
      psi5: blast(0.69, 0.63),
      psi2: blast(1.21, 0.63),
      psi1: blast(1.6, 0.74),
      rad500: 0.7 * kt ** 0.19,
      thermal3: 0.626 * kt ** 0.41 * (air ? 1 : 0.75),
    };
    // drawn largest first; colours are "r,g,b"
    const zones = [
      { id: 'psi1', r: r.psi1, short: '1 PSI', label: 'LIGHT BLAST · 1 PSI', color: '150,200,220', note: 'Windows shatter; flying glass injures people outdoors and at windows.' },
      { id: 'thermal3', r: r.thermal3, short: 'BURNS', label: 'THERMAL · 3RD-DEGREE BURNS', color: '255,170,40', note: 'Exposed skin burns through; fires break out.' },
      { id: 'psi5', r: r.psi5, short: '5 PSI', label: 'MODERATE BLAST · 5 PSI', color: '255,110,40', note: 'Most houses collapse; widespread fatalities.' },
      { id: 'rad500', r: r.rad500, short: '500 REM', label: 'RADIATION · 500 REM', color: '120,255,140', note: 'Without treatment, around half of those exposed die within weeks.' },
      { id: 'psi12', r: r.psi12, short: '12 PSI', label: 'HEAVY BLAST · 12 PSI', color: '255,50,60', note: 'Concrete buildings destroyed; almost no survivors.' },
      { id: 'fireball', r: r.fireball, short: 'FIREBALL', label: 'FIREBALL', color: '255,245,210', note: 'Everything inside is vaporised.' },
    ].sort((a, b) => b.r - a.r);
    return { kt, burst, r, zones };
  }

  // ---------------------------------------------------------------- geometry
  const toVec = (lat, lng) => [Math.cos(lat * rad) * Math.cos(lng * rad), Math.cos(lat * rad) * Math.sin(lng * rad), Math.sin(lat * rad)];
  function distanceKm(a, b) {
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // point `km` away from (lat, lng) on compass bearing `deg`
  function destination(lat, lng, deg, km) {
    const d = km / R_EARTH, b = deg * rad, p1 = lat * rad;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = lng * rad + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 / rad, lng: l2 / rad };
  }
  function circle(lat, lng, km, n = 72) {
    return Array.from({ length: n + 1 }, (_, i) => destination(lat, lng, (i / n) * 360, km));
  }

  // ---------------------------------------------------------------- ballistic flight
  // Rough minimum-energy trajectory: flight time, apogee and speed grow with range.
  function trajectory(a, b, steps = 240) {
    const km = Math.max(1, distanceKm(a, b));
    const cls = km < 1000 ? 'SRBM' : km < 3000 ? 'MRBM' : km < 5500 ? 'IRBM' : 'ICBM';
    const minutes = 4 + km / 350;
    const apogee = Math.min(1300, 50 + 0.22 * km);
    const vmax = Math.min(7.2, 1.6 + km / 1600); // km/s at burnout / re-entry
    const va = toVec(a.lat, a.lng), vb = toVec(b.lat, b.lng);
    const omega = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
    let prevLng = a.lng;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let lat, lng;
      if (omega < 1e-6) { lat = a.lat; lng = a.lng; } else {
        const k1 = Math.sin((1 - t) * omega) / Math.sin(omega), k2 = Math.sin(t * omega) / Math.sin(omega);
        const v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
        lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) / rad;
        lng = Math.atan2(v[1], v[0]) / rad;
      }
      while (lng - prevLng > 180) lng -= 360; // keep longitudes continuous across the antimeridian
      while (lng - prevLng < -180) lng += 360;
      prevLng = lng;
      pts.push({ lat, lng, alt: apogee * Math.sin(Math.PI * t) });
    }
    const at = t => {
      const f = Math.max(0, Math.min(1, t)) * steps, i = Math.min(steps - 1, Math.floor(f)), u = f - i;
      const p = pts[i], q = pts[i + 1];
      return { lat: p.lat + (q.lat - p.lat) * u, lng: p.lng + (q.lng - p.lng) * u, alt: p.alt + (q.alt - p.alt) * u };
    };
    // boost to burnout, slower over the top, fastest again on re-entry
    const speed = t => (t < 0.08 ? vmax * (t / 0.08) : vmax * (1 - 0.18 * Math.sin(Math.PI * t)));
    return { km, cls, minutes, apogee, vmax, pts, at, speed };
  }

  // ---------------------------------------------------------------- population & casualties
  // A city's metro population spread with an exponential (Clark) density profile.
  const cityScale = pop => Math.max(1.2, 2.5 * Math.sqrt(pop / 1e6)); // km
  // OTA 1979: share killed / injured by peak overpressure ring
  const OTA = [
    { key: 'psi12', killed: 0.98, injured: 0.02 },
    { key: 'psi5', killed: 0.5, injured: 0.4 },
    { key: 'psi2', killed: 0.05, injured: 0.45 },
    { key: 'psi1', killed: 0, injured: 0.25 },
  ];

  // gz: {lat, lng}; fx: effects(); cities: [[name, adm0, lat, lng, pop], ...];
  // landAt(lat, lng) -> rural people per km² there (0 at sea)
  function casualties(gz, fx, cities, landAt) {
    const R = Math.max(fx.r.psi1, fx.r.thermal3);
    const kx = 111.32 * Math.cos(gz.lat * rad), ky = 110.57;
    const near = [];
    for (const c of cities) {
      const b = cityScale(c[4]);
      const dx = (c[3] - gz.lng) * kx, dy = (c[2] - gz.lat) * ky;
      if (Math.hypot(dx, dy) < R + 7 * b) near.push({ dx, dy, b, d0: c[4] / (2 * Math.PI * b * b) });
    }
    const NR = 64, NA = 64, dr = R / NR, da = (2 * Math.PI) / NA;
    let killed = 0, injured = 0, exposed = 0;
    for (let i = 0; i < NR; i++) {
      const r = (i + 0.5) * dr, area = r * dr * da;
      const ring = OTA.find(o => r <= fx.r[o.key]);
      const burns = r <= fx.r.thermal3 && r > fx.r.psi5; // burns add to blast casualties outside 5 psi
      let k = ring ? ring.killed : 0, inj = ring ? ring.injured : 0;
      if (burns) { k = Math.min(1, k + 0.1); inj = Math.min(1 - k, inj + 0.2); }
      if (r <= fx.r.fireball || (r <= fx.r.rad500 && k < 0.5)) { k = Math.max(k, r <= fx.r.fireball ? 1 : 0.5); inj = Math.min(inj, 1 - k); }
      for (let j = 0; j < NA; j++) {
        const th = (j + 0.5) * da, x = r * Math.cos(th), y = r * Math.sin(th);
        const rural = landAt(gz.lat + y / ky, gz.lng + x / kx); // null at sea
        let dens = rural ?? 0;
        for (const c of near) {
          const d = Math.hypot(x - c.dx, y - c.dy);
          // the coastline data is coarse (Manhattan is barely there), so a city's core always
          // counts as land; further out its population stops at the water's edge
          if (rural != null || d < 0.5 * c.b) dens += c.d0 * Math.exp(-d / c.b);
        }
        if (!dens) continue;
        const people = dens * area;
        if (r <= fx.r.psi1) exposed += people;
        killed += people * k;
        injured += people * inj;
      }
    }
    return { killed, injured, exposed };
  }

  // nearest city to a point, for naming picked locations
  function nearestCity(p, cities, maxKm = 60) {
    let best = null, bestD = maxKm;
    for (const c of cities) {
      if (Math.abs(c[2] - p.lat) > 1.2) continue;
      const d = distanceKm(p, { lat: c[2], lng: c[3] });
      // prefer bigger cities a little: a metro of 10M "pulls" from further than a town
      const score = d / (1 + Math.log10(Math.max(1e4, c[4]) / 1e4) * 0.35);
      if (score < bestD) { bestD = score; best = { name: c[0], adm0: c[1], lat: c[2], lng: c[3], pop: c[4], km: d }; }
    }
    return best;
  }

  return { effects, trajectory, casualties, distanceKm, destination, circle, nearestCity, R_EARTH };
})();
