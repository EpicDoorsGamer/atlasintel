# A.T.L.A.S. — Global Economic Intelligence Matrix

A sci-fi, holographic 3D globe that tracks **news, GDP, imports, exports and other economic indicators for every UN member state** (193 members + the 2 observer states, Palestine and the Holy See).

It is a fully **static site**, so it can be hosted for free on Cloudflare Pages. A daily GitHub Action keeps the data fresh.

---

## How it works

| Part | Where it comes from |
|---|---|
| Economy and trade (GDP, exports, imports, inflation, …) | World Bank WDI. `build_data.py` saves it to `public/api/econ/` and `public/api/global/`. |
| Country news | A daily GDELT snapshot in `public/api/news/` loads instantly. The browser then asks GDELT live for fresher headlines. |
| World ticker | Same approach, using `public/api/news/_world.json`. |
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
build_data.py            downloads World Bank data + GDELT snapshots into public/api/
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
