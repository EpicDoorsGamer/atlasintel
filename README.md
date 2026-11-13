# A.T.L.A.S. — Global Economic Intelligence Matrix

A sci-fi, holographic 3D globe that tracks **news, GDP, imports, exports and other economic indicators for every UN member state** (193 members + the 2 observer states, Palestine and the Holy See).

It is a fully **static site**, so it can be hosted for free on Cloudflare Pages. A daily GitHub Action keeps the data fresh.

## Features

- **Globe:** country colours by GDP, GDP per capita, exports, imports or growth. Click a country for a fly-in, a lock-on animation and a dossier with Economy, Trade, News and Archive tabs.
- **Time slider:** drag through 1990 to today, or press ▶ to watch the world economy change year by year. The index list and rankings follow the chosen year. **LIVE** returns to the latest data.
- **Day/night shading:** the live terminator line, with city lights on the night side. It updates every minute.
- **News hotspots:** pulsing dots where the world's news is happening over the last 24 hours, from GDELT event data. Colour shows the share of conflict events: yellow is calm, orange is tense, red is conflict. Hover for details, or click to open that country. Each country's News tab lists its hotspots with a link to the top story.
- **Boot-up intro:** a black screen with a scan line and a wireframe globe that draws itself in, while a log shows the real loading steps. Press **ENGAGE** (or Enter) to fly in.
- **Hologram effects:** panels flicker and glitch in, HUD panels have faint scanlines, and a laser sweep scans the selected country's outline.
- **Command bar:** press **Ctrl + K** (⌘K on a Mac) or click **CTRL K** in the top bar, then type plain-English commands:
  - `go to brazil` or just `brazil`
  - `news japan`, `trade germany`
  - `top 10 exporters`, `bottom 5 growth`, `richest 10 in 2005`
  - `compare germany and france` (up to 4 countries)
  - `play 2000 to 2020`, `year 1998`, `live`
  - `layer imports`
  - `night off`, `hotspots on`, `hands on`
  - `watch netherlands`
  - `reset`, `help`
- **Hand-gesture control (HANDS):** turn it on, allow the camera, then:
  - **Open hand and move:** rotate the globe.
  - **Pinch and move up/down:** zoom.
  - **Point and hold still:** select a country.
  - **Fist and hold:** close the dossier.

  It uses Google MediaPipe hand tracking in the browser. The video is processed on your device and is never uploaded. The model (about 8 MB) downloads only the first time you turn HANDS on.
- **Country profile (first dossier tab):**
  - **Leaders:** the head of state and head of government, with portraits.
  - **Quick facts:** currency, languages, government type, calling code and internet domain.
  - **Memberships:** the alliances the country belongs to.
  - **Briefing:** a short Wikipedia summary.

  Portraits are shown with a holographic tint; hover over one to see the true colours.
- **Alliances (BLOCS tab, or `show nato`):** NATO, EU, BRICS, G20, G7, OPEC, ASEAN, African Union, GCC, SCO, Five Eyes, QUAD and USMCA. The members light up together, and a card shows their combined GDP, population, exports, imports and largest economy. Member lists live in `public/js/alliances.js`; update them when membership changes.
- **Live satellites (SATS):** the space stations, weather satellites, the brightest satellites and the whole Starlink fleet, shown at their real positions and updated twice a second.
  - **Hover** a dot for its name, altitude and speed. **Click** it to follow it with the camera.
  - **TRACK ISS** follows the space station and draws its orbit for the next 95 minutes.
  - **WARP ×60** speeds time up so you can see them move.
- **Antarctica (a joke):** click it, find it at the bottom of the nations index, or type `who leads antarctica`. It isn't a country, so it stays out of every ranking and total, but its dossier has a leader: Emperor Penguin I. The News and Archive tabs are real.
- **Toggles:** top right: **HANDS**, **NIGHT**, **HOTSPOTS** and **SATS**. Your choices are remembered in your browser.

---

## How it works

| Part | Where it comes from |
|---|---|
| Economy and trade (GDP, exports, imports, inflation, …) | World Bank WDI. `build_data.py` saves it to `public/api/econ/` and `public/api/global/`. |
| Country news | A daily GDELT snapshot in `public/api/news/` loads instantly. The browser then asks GDELT live for fresher headlines. |
| World ticker | Same approach, using `public/api/news/_world.json`. |
| Time slider | `public/api/history/<indicator>.json`, built from the economy files. |
| News hotspots | `public/api/hotspots.json`, built from the last 24 hours of GDELT's raw 15-minute event files. These are plain downloads with no rate limit, and the step takes about a minute. |
| Night lights | NASA "Black Marble" image (via the three-globe package on jsDelivr), blended in the browser. |
| Leaders & facts | `public/api/facts.json`, built daily from Wikidata (CC0). Portraits come from Wikimedia Commons. The summary is fetched live from Wikipedia. |
| Satellites | Orbit data (TLEs) from CelesTrak, saved by `build_data.py` to `public/api/tle/`, so it loads instantly from the site itself. Starlink comes from CelesTrak's SpaceX-supplied feed when the main one is busy. The small groups refresh daily and Starlink (1.7 MB) every third day, to keep the git history small. If the snapshot is ever more than a few days old, the browser asks CelesTrak directly. Positions are calculated in the browser with satellite.js, in a Web Worker. |
| Headline archive and watchlist | Saved in each visitor's browser (localStorage). |
| Borders and flags | `world-atlas` (Natural Earth) via jsDelivr, and flagcdn.com. |

GDELT allows about one request per 5 seconds per visitor. If the live feed is busy, the page shows the daily snapshot instead.

## Project layout

```
public/                  ← this folder is the website (Cloudflare Pages output directory)
  index.html
  _headers               cache rules for Cloudflare Pages
  css/style.css
  js/app.js              globe, animations, dossier, charts, news
  js/countries.js        193 UN members + 2 observers
  api/                   generated data (committed to git)
build_data.py            downloads World Bank data, GDELT snapshots, Wikidata facts and satellite orbits into public/api/
.github/workflows/update-data.yml   runs build_data.py daily and commits the result
```

## Run it locally

```bash
python -m http.server 8420 --directory public
```
Then open http://localhost:8420, or double-click `start.bat`. Opening `index.html` directly won't load the data, because browsers block it from `file://`.

To refresh the data yourself (takes about 30–45 minutes because both APIs are slow and rate-limited):
```bash
python build_data.py
```
Add `--no-news` to skip the news snapshot, or `--force` to re-download everything.
To refresh only the news hotspots (about a minute), for example right before uploading:
```bash
python build_data.py --hotspots
```
To refresh only the satellite orbit data (CelesTrak allows one download per group every 2 hours):
```bash
python build_data.py --tle --force
```

---

## Deploy to Cloudflare Pages (free, no watermark)

### 1. Put the project on GitHub
Create a free GitHub account and a new **empty** repository named `atlasintel`. Then, in this folder:
```bash
git init
```
```bash
git add .
```
```bash
git commit -m "ATLAS globe"
```
```bash
git branch -M main
```
```bash
git remote add origin https://github.com/YOUR-USERNAME/atlasintel.git
```
```bash
git push -u origin main
```

### 2. Let the daily data job push
On GitHub, open the repo, then go to **Settings → Actions → General → Workflow permissions**, select **Read and write permissions**, and click **Save**.
Then open the **Actions** tab, choose **Refresh site data → Run workflow**, and run it once to check that it works.

### 3. Create the Cloudflare Pages site
1. Sign up at dash.cloudflare.com (free).
2. Go to **Workers & Pages → Create → Pages → Connect to Git**, and pick the `atlasintel` repo.
3. Use these settings:
   - **Project name:** `atlasintel` (this gives you `atlasintel.pages.dev`)
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `public`
4. Click **Save and Deploy**. The site goes live at **https://atlasintel.pages.dev**.

Every push to `main`, including the daily data job, redeploys the site automatically.

---

## Free domain: `atlasintel.is-a.dev`

is-a.dev gives free subdomains to developer projects. **You must submit the request yourself**: their rules forbid AI-generated pull requests, and they may block accounts that send them. Their docs are at https://docs.is-a.dev.

1. Make sure the site is live at `https://atlasintel.pages.dev`. They need a working link and a screenshot.
2. Fork https://github.com/is-a-dev/register.
3. In your fork, create `domains/atlasintel.json` that points a `CNAME` record at `atlasintel.pages.dev`. Use the format in their docs, with your own GitHub username as the owner, and no `https://`.
4. Open a pull request. **Keep their PR template** and fill it in yourself. Add the link to your live site and a screenshot.
5. Wait for review. They are volunteers, so it may take a few days. Make any changes they ask for.
6. After it's merged, connect the domain to your Pages project at **https://cf-pages.is-a.dev**. The normal Cloudflare "Custom domains" button doesn't work for is-a.dev names.

Root is-a.dev names must relate to software development and be non-commercial. Read their terms before applying.

---

## Credits
- Economic data: World Bank, World Development Indicators (CC BY 4.0)
- News: The GDELT Project
- Borders: Natural Earth via `world-atlas`
- Flags: flagcdn.com
- Globe: globe.gl / three.js
