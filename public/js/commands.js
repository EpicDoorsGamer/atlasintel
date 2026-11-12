/* ==========================================================================
   CommandBar — Ctrl+K (⌘K) command palette.
   Understands plain-English commands such as:
     go to brazil · news japan · top 10 exporters · bottom 5 growth in 2009
     richest 10 · play 2000 to 2020 · year 1998 · live · layer imports
     compare germany and france · night off · hotspots on · hands on
     watch netherlands · reset · help
   The app passes in an `api` object (see app.js) so this file has no globals.
   ========================================================================== */
window.CommandBar = (() => {
  'use strict';
  let api = null;
  const root = document.getElementById('cmd');
  const input = document.getElementById('cmdInput');
  const list = document.getElementById('cmdList');
  const out = document.getElementById('cmdOut');
  let suggestions = [], active = 0;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // ---------------------------------------------------------------- vocabulary
  const ALIASES = {
    'us': 'USA', 'usa': 'USA', 'america': 'USA', 'united states of america': 'USA', 'the states': 'USA',
    'uk': 'GBR', 'britain': 'GBR', 'great britain': 'GBR', 'england': 'GBR',
    'south korea': 'KOR', 'korea': 'KOR', 'north korea': 'PRK', 'dprk': 'PRK',
    'drc': 'COD', 'congo kinshasa': 'COD', 'congo brazzaville': 'COG',
    'uae': 'ARE', 'emirates': 'ARE', 'holland': 'NLD', 'czech republic': 'CZE',
    'ivory coast': 'CIV', 'turkey': 'TUR', 'burma': 'MMR', 'vatican': 'VAT', 'holy see': 'VAT',
    'swaziland': 'SWZ', 'macedonia': 'MKD', 'east timor': 'TLS', 'cape verde': 'CPV',
    'bahamas': 'BHS', 'gambia': 'GMB', 'russia': 'RUS', 'iran': 'IRN', 'syria': 'SYR',
    'vietnam': 'VNM', 'laos': 'LAO', 'palestine': 'PSE', 'taiwan': null, 'kosovo': null,
  };
  const METRICS = [
    { re: /per[\s-]?capita|richest|wealthiest|poorest|income/, ind: 'NY.GDP.PCAP.CD' },
    { re: /export/, ind: 'NE.EXP.GNFS.CD' },
    { re: /import/, ind: 'NE.IMP.GNFS.CD' },
    { re: /growth|growing|fastest|slowest/, ind: 'NY.GDP.MKTP.KD.ZG' },
    { re: /gdp|econom|largest|biggest|smallest|nation|countr/, ind: 'NY.GDP.MKTP.CD' },
  ];
  const metricOf = text => METRICS.find(m => m.re.test(text))?.ind || null;
  const TOGGLES = { night: 'night', 'day night': 'night', shading: 'night', hotspot: 'hot', hotspots: 'hot', hand: 'hands', hands: 'hands', gesture: 'hands', gestures: 'hands', camera: 'hands', webcam: 'hands' };

  function norm(t) {
    return t.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^the /, '');
  }

  // best country for a free-text name, or null
  function findCountry(text) {
    const q = norm(text);
    if (!q) return null;
    if (q in ALIASES) return ALIASES[q] ? api.byIso3(ALIASES[q]) : null;
    let best = null, bestScore = 9;
    for (const c of api.countries) {
      const n = norm(c.name);
      const s = c.iso3.toLowerCase() === q ? 0 : n === q ? 0 : n.startsWith(q) ? 1 : (c.capital && norm(c.capital) === q) ? 2 : n.includes(q) ? 3 : 9;
      if (s < bestScore) { bestScore = s; best = c; }
    }
    return q.length >= 3 || bestScore === 0 ? best : null;
  }
  function findCountries(text) {
    const q = norm(text);
    if (q.length < 2) return [];
    return api.countries
      .map(c => {
        const n = norm(c.name);
        return [n.startsWith(q) ? 0 : n.includes(q) ? 1 : (c.capital && norm(c.capital).startsWith(q)) ? 2 : 9, c];
      })
      .filter(x => x[0] < 9)
      .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
      .slice(0, 5)
      .map(x => x[1]);
  }

  // ---------------------------------------------------------------- command parsing
  // Each parser returns a suggestion { icon, title, sub, run } or null.
  // run() returns a string of HTML to show in the output pane (palette stays open),
  // or nothing (palette closes).
  const PARSERS = [
    // help
    q => /^(help|\?|commands)$/.test(q) && { icon: '?', title: 'Show all commands', run: () => HELP },

    // reset
    q => /^(reset|home|close|exit|back|zoom out|clear)$/.test(q) && {
      icon: '⟲', title: 'Reset view', sub: 'Close the dossier and return to the latest data', run: () => { api.reset(); },
    },

    // live
    q => /^(live|now|latest|present|today)$/.test(q) && { icon: '●', title: 'Back to live data', run: () => { api.setYear(null); } },

    // play 2000 to 2020
    q => {
      const m = q.match(/^play(?:\s+(?:from\s+)?(\d{4}))?(?:\s*(?:to|-|until|through)\s*(\d{4}))?$/);
      if (!m) return null;
      const [min, max] = api.years();
      const from = clampYear(+m[1] || min, min, max), to = clampYear(+m[2] || max, min, max);
      return { icon: '▶', title: `Play ${Math.min(from, to)} → ${Math.max(from, to)}`, sub: `${api.layerLabel()} through time`, run: () => { api.play(Math.min(from, to), Math.max(from, to)); } };
    },

    // year 1998
    q => {
      const m = q.match(/^(?:year|show|go to|goto|jump to|in)?\s*((?:19|20)\d\d)$/);
      if (!m) return null;
      const [min, max] = api.years(), y = clampYear(+m[1], min, max);
      return { icon: '⏱', title: `Jump to ${y}`, sub: 'Time slider', run: () => { api.setYear(y); } };
    },

    // top / bottom N <metric> [in YEAR]
    q => {
      const m = q.match(/^(top|bottom|largest|biggest|smallest|richest|poorest|fastest|slowest)\b\s*(\d+)?\s*(.*)$/);
      if (!m) return null;
      const word = m[1], n = Math.max(1, Math.min(50, +m[2] || 10));
      let rest = m[3] || '';
      const ym = rest.match(/\b(?:in|for|of)?\s*((?:19|20)\d\d)\b/);
      const year = ym ? +ym[1] : null;
      if (ym) rest = rest.replace(ym[0], ' ');
      const ind = metricOf(rest) || metricOf(word) || 'NY.GDP.MKTP.CD';
      const asc = /bottom|smallest|poorest|slowest/.test(word);
      const label = `${asc ? 'Bottom' : 'Top'} ${n} · ${api.layerLabel(ind)}${year ? ' · ' + year : ''}`;
      return {
        icon: '≡', title: label, sub: 'Ranked list · click a row to open it',
        run: async () => {
          const rows = await api.top(ind, n, asc, year);
          if (!rows.length) return `<div class="cmd-empty">NO DATA FOR THAT YEAR</div>`;
          return `<div class="cmd-title">${esc(label.toUpperCase())}</div><ol class="cmd-rank">${rows.map((r, i) =>
            `<li data-iso="${r.c.iso3}"><span class="rk">${i + 1}</span>${api.flag(r.c)}<span class="nm">${esc(r.c.name)}</span><span class="vl">${esc(api.fmt(ind, r.v))}</span></li>`).join('')}</ol>`;
        },
      };
    },

    // layer exports / colour by growth
    q => {
      const m = q.match(/^(?:layer|colou?r by|show|map)\s+(.+)$/);
      const ind = m && metricOf(m[1]);
      if (!ind || findCountry(m[1])) return null;
      return { icon: '◐', title: `Colour globe by ${api.layerLabel(ind)}`, run: () => { api.setLayer(ind); } };
    },

    // toggles: night off / hotspots on / hands on / enable gestures
    q => {
      let m = q.match(/^(?:turn |switch )?(on|off|enable|disable|show|hide|start|stop)\s+(.+)$/);
      let word, on;
      if (m) { word = m[2]; on = /on|enable|show|start/.test(m[1]); }
      else {
        m = q.match(/^(.+?)\s+(on|off)$/) || q.match(/^(night|hotspots?|hands?|gestures?|camera|webcam)$/);
        if (!m) return null;
        word = m[1]; on = m[2] ? m[2] === 'on' : undefined;
      }
      const key = TOGGLES[norm(word)];
      if (!key) return null;
      const names = { night: 'Day/night shading', hot: 'News hotspots', hands: 'Hand-gesture control' };
      return { icon: '⏻', title: `${names[key]} ${on === undefined ? 'on/off' : on ? 'on' : 'off'}`, run: () => { api.toggle(key, on); } };
    },

    // compare a and b (and c)
    q => {
      const m = q.match(/^(?:compare|vs)\s+(.+)$/);
      if (!m) return null;
      const cs = m[1].split(/\s*(?:,|\band\b|\bvs\.?\b|\bversus\b|&|\bwith\b)\s*/).map(findCountry).filter(Boolean);
      const uniq = [...new Set(cs)].slice(0, 4);
      if (uniq.length < 2) return { icon: '⇄', title: 'Compare…', sub: 'Name two to four countries, e.g. "compare germany and france"', run: () => '' };
      return { icon: '⇄', title: `Compare ${uniq.map(c => c.name).join(' · ')}`, sub: 'Side-by-side table', run: () => api.compare(uniq) };
    },

    // watch netherlands
    q => {
      const m = q.match(/^(?:watch|track|star|unwatch|untrack)\s+(.+)$/);
      const c = m && findCountry(m[1]);
      if (!c) return null;
      return { icon: '★', title: `Toggle watchlist: ${c.name}`, run: () => { const added = api.watch(c); return `<div class="cmd-empty">${esc(c.name.toUpperCase())} ${added ? 'ADDED TO' : 'REMOVED FROM'} WATCHLIST</div>`; } };
    },

    // news japan / trade germany / economy brazil
    q => {
      const m = q.match(/^(news|headlines|trade|economy|archive)\s+(?:for |of |on |about |in )?(.+)$/);
      const c = m && findCountry(m[2]);
      if (!c) return null;
      const tab = { news: 'news', headlines: 'news', trade: 'trade', economy: 'economy', archive: 'archive' }[m[1]];
      return { icon: '◎', title: `${c.name} · ${tab.toUpperCase()}`, sub: 'Open dossier tab', run: () => { api.select(c, tab); } };
    },

    // go to brazil
    q => {
      const m = q.match(/^(?:go to|goto|fly to|show|open|find|locate|zoom to|target|select|take me to)\s+(.+)$/);
      const c = m && findCountry(m[1]);
      if (!c) return null;
      return { icon: '⌖', title: `Go to ${c.name}`, sub: c.capital ? `Capital ${c.capital}` : '', run: () => { api.select(c); } };
    },
  ];

  function clampYear(y, min, max) { return Math.max(min, Math.min(max, y)); }

  const HELP = `<div class="cmd-title">COMMANDS</div><dl class="cmd-help">
    <dt>go to brazil</dt><dd>fly to a country (or just type its name)</dd>
    <dt>news japan · trade germany</dt><dd>open a dossier tab</dd>
    <dt>top 10 exporters</dt><dd>also: bottom 5 growth · richest 10 · largest 20 in 2000</dd>
    <dt>compare germany and france</dt><dd>side-by-side table, up to 4 countries</dd>
    <dt>play 2000 to 2020</dt><dd>animate the time slider · <i>year 1998</i> · <i>live</i></dd>
    <dt>layer exports</dt><dd>colour the globe by gdp, per capita, exports, imports or growth</dd>
    <dt>night off · hotspots on · hands on</dt><dd>switch display features</dd>
    <dt>watch netherlands</dt><dd>add / remove from your watchlist</dd>
    <dt>reset</dt><dd>close the dossier and go home</dd>
  </dl>`;

  function suggest(text) {
    const q = norm(text);
    if (!q) {
      return ['top 10 exporters', 'go to brazil', 'play 2000 to 2020', 'compare germany and france', 'richest 10 in 2005', 'hotspots off', 'help']
        .map(ex => ({ icon: '›', title: ex, sub: 'Example', fill: ex }));
    }
    const res = [];
    for (const p of PARSERS) {
      const s = p(q);
      if (s) res.push(s);
    }
    const exact = findCountry(q); // catches aliases like "uk", "turkey", "holland"
    for (const c of exact ? [exact, ...findCountries(q).filter(x => x !== exact)] : findCountries(q)) {
      if (!res.some(r => r.title === `Go to ${c.name}`)) {
        res.push({ icon: '⌖', title: `Go to ${c.name}`, sub: c.capital ? `Capital ${c.capital}` : '', run: () => { api.select(c); } });
      }
    }
    if (!res.length) res.push({ icon: '?', title: `No command matches "${text.trim()}"`, sub: 'Type "help" to see what ATLAS understands', run: () => HELP });
    return res.slice(0, 7);
  }

  // ---------------------------------------------------------------- UI
  function render() {
    suggestions = suggest(input.value);
    active = Math.min(active, suggestions.length - 1);
    list.innerHTML = suggestions.map((s, i) => `<li class="${i === active ? 'on' : ''}" data-i="${i}">
      <span class="ic">${esc(s.icon)}</span><span class="tt">${esc(s.title)}</span>${s.sub ? `<span class="sb">${esc(s.sub)}</span>` : ''}</li>`).join('');
  }

  async function runActive(i = active) {
    const s = suggestions[i];
    if (!s) return;
    if (s.fill) { input.value = s.fill; active = 0; render(); input.focus(); return; }
    let html;
    try { html = await s.run(); } catch (e) { html = `<div class="cmd-empty">ERROR · ${esc(e.message || e)}</div>`; }
    if (typeof html === 'string' && html) {
      out.innerHTML = html;
      out.classList.remove('holo-in');
      void out.offsetWidth;
      out.classList.add('holo-in');
    } else close();
  }

  function open(prefill = '') {
    root.hidden = false;
    input.value = prefill;
    out.innerHTML = '';
    active = 0;
    render();
    requestAnimationFrame(() => input.focus());
  }
  function close() {
    root.hidden = true;
    input.blur();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', e => {
    e.stopPropagation(); // keep global shortcuts (Esc, /) from firing while typing
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      render();
    } else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab' && suggestions[active]?.fill) { e.preventDefault(); runActive(); }
  });
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); runActive(+li.dataset.i); }
  });
  out.addEventListener('click', e => {
    const li = e.target.closest('li[data-iso]');
    if (li) { api.select(api.byIso3(li.dataset.iso)); close(); }
  });
  root.addEventListener('mousedown', e => { if (e.target === root) close(); });
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!document.body.classList.contains('engaged')) return;
      root.hidden ? open() : close();
    }
  });

  return {
    init(a) { api = a; },
    open, close,
    get isOpen() { return !root.hidden; },
  };
})();
