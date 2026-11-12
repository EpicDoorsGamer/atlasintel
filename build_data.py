"""
Build the site's static data in public/api/.

    python build_data.py              # refresh anything stale
    python build_data.py --force      # refresh everything
    python build_data.py --no-news    # skip the (slow) per-country news snapshot
    python build_data.py --hotspots   # only refresh the news hotspots (fast, ~1 minute)

Writes:
    public/api/econ/<ISO3>.json      World Bank time series per country (GDP, trade, prices, ...)
    public/api/global/<IND>.json     latest value of one indicator for every country (globe colours, ranks)
    public/api/news/<ISO3>.json      daily GDELT headline snapshot per country (the site shows it
    public/api/news/_world.json      instantly, then tries a live GDELT refresh in the browser)
    public/api/history/<IND>.json    every country's value for every year (time slider), built from econ/
    public/api/hotspots.json         where the world's news is happening over the last 24 h, aggregated
                                     from GDELT's raw 15-minute event files (no API rate limit)

Runs daily on GitHub Actions (.github/workflows/update-data.yml). Standard library only.
The World Bank API is slow (often 20s+ per request) and GDELT allows one request per 5 s,
so a full run takes roughly 30-45 minutes.
"""

import csv
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "public", "api")
FORCE = "--force" in sys.argv
ECON_MAX_AGE = 7 * 86400      # series change a few times a year
GLOBAL_MAX_AGE = 86400        # globe colours / ranks: daily
NEWS_MAX_AGE = 20 * 3600      # news snapshot: daily
WORLD_QUERY = "sourcelang:english (economy OR markets OR trade OR election OR summit)"  # keep in sync with app.js

INDICATORS = {
    "NY.GDP.MKTP.CD": "gdp",
    "NY.GDP.MKTP.KD.ZG": "gdpGrowth",
    "NY.GDP.PCAP.CD": "gdpPerCapita",
    "NE.EXP.GNFS.CD": "exports",
    "NE.IMP.GNFS.CD": "imports",
    "NE.EXP.GNFS.ZS": "exportsPct",
    "NE.IMP.GNFS.ZS": "importsPct",
    "SP.POP.TOTL": "population",
    "FP.CPI.TOTL.ZG": "inflation",
    "SL.UEM.TOTL.ZS": "unemployment",
    "BX.KLT.DINV.CD.WD": "fdi",
    "BN.CAB.XOKA.GD.ZS": "currentAccount",
    "GC.DOD.TOTL.GD.ZS": "debt",
    "FI.RES.TOTL.CD": "reserves",
}
GLOBAL = ["NY.GDP.MKTP.CD", "NY.GDP.PCAP.CD", "NY.GDP.MKTP.KD.ZG", "NE.EXP.GNFS.CD", "NE.IMP.GNFS.CD"]
NO_WORLD_BANK_DATA = {"VAT"}  # Holy See is not covered by the World Bank
HISTORY = {  # time-slider layers -> key in econ/<ISO3>.json
    "NY.GDP.MKTP.CD": "gdp",
    "NY.GDP.PCAP.CD": "gdpPerCapita",
    "NY.GDP.MKTP.KD.ZG": "gdpGrowth",
    "NE.EXP.GNFS.CD": "exports",
    "NE.IMP.GNFS.CD": "imports",
}
HOTSPOT_MAX_AGE = 3 * 3600
HOTSPOT_HOURS = 24
HOTSPOT_TOP = 90
HOTSPOT_PER_COUNTRY = 4  # GDELT is English-heavy; cap so one country can't fill the map


def fetch(url, tries=4, retry_wait=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "atlas-data-build"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(retry_wait * (i + 1))


def fresh(path, max_age):
    if FORCE:
        return False
    try:
        with open(path, encoding="utf-8") as f:
            return time.time() - json.load(f).get("updated", 0) < max_age
    except Exception:
        return False


def save(path, obj):
    obj["updated"] = int(time.time())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)


def econ(iso3):
    path = os.path.join(OUT, "econ", f"{iso3}.json")
    if fresh(path, ECON_MAX_AGE):
        return "cached"
    url = (f"https://api.worldbank.org/v2/country/{iso3}/indicator/{';'.join(INDICATORS)}"
           "?source=2&format=json&date=1990:2030&per_page=2000")
    payload = fetch(url)
    series = {k: [] for k in INDICATORS.values()}
    rows = payload[1] if len(payload) > 1 and payload[1] else []
    for row in rows:
        key = INDICATORS.get(row["indicator"]["id"])
        if key and row["value"] is not None:
            series[key].append([int(row["date"]), row["value"]])
    for v in series.values():
        v.sort()
    if not any(series.values()):
        raise RuntimeError("World Bank returned no data")
    save(path, {"iso3": iso3, "series": series, "source": "World Bank WDI"})
    return "updated"


def global_layer(ind):
    path = os.path.join(OUT, "global", f"{ind}.json")
    if fresh(path, GLOBAL_MAX_AGE):
        return "cached"
    payload = fetch(f"https://api.worldbank.org/v2/country/all/indicator/{ind}"
                    "?format=json&per_page=20000&mrnev=1")
    values = {r["countryiso3code"]: [int(r["date"]), r["value"]]
              for r in (payload[1] or []) if r.get("countryiso3code") and r["value"] is not None}
    if len(values) < 100:
        raise RuntimeError(f"only {len(values)} values")
    save(path, {"indicator": ind, "values": values})
    return "updated"


def gdelt(query, timespan, max_records, sort):
    url = ("https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json"
           f"&sort={sort}&maxrecords={max_records}&timespan={timespan}&query={urllib.parse.quote(query)}")
    time.sleep(6)  # GDELT: max one request every 5 seconds
    data = fetch(url, tries=3, retry_wait=20)
    items = []
    for a in data.get("articles", []):
        sd = a.get("seendate", "")
        published = (f"{sd[0:4]}-{sd[4:6]}-{sd[6:8]}T{sd[9:11]}:{sd[11:13]}:{sd[13:15]}Z"
                     if re.fullmatch(r"\d{8}T\d{6}Z", sd) else None)
        items.append({"title": a.get("title", ""), "url": a.get("url", ""),
                      "source": a.get("domain", ""), "published": published})
    return items


def news(job):
    key, query, timespan, max_records, sort = job
    path = os.path.join(OUT, "news", f"{key}.json")
    if fresh(path, NEWS_MAX_AGE):
        return "cached"
    items = gdelt(query, timespan, max_records, sort)
    if not items:
        raise RuntimeError("no articles")
    save(path, {"items": items, "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    return "updated"


def build_history(_):
    """Re-shape the per-country series into one file per indicator for the time slider."""
    econ_dir = os.path.join(OUT, "econ")
    series = {}
    for name in os.listdir(econ_dir):
        if name.endswith(".json"):
            with open(os.path.join(econ_dir, name), encoding="utf-8") as f:
                series[name[:-5]] = json.load(f)["series"]
    for ind, key in HISTORY.items():
        years = sorted({y for s in series.values() for y, _ in s.get(key, [])})
        values = {}
        for iso3, s in series.items():
            by_year = dict((y, v) for y, v in s.get(key, []))
            if by_year:
                rnd = (lambda v: round(v, 2)) if key == "gdpGrowth" else (lambda v: round(v))
                values[iso3] = [rnd(by_year[y]) if y in by_year else None for y in years]
        save(os.path.join(OUT, "history", f"{ind}.json"), {"indicator": ind, "years": years, "values": values})
    return "updated"


def _gdelt_export(stamp):
    """One GDELT 2.0 15-minute event export -> list of rows (or [] if missing)."""
    url = f"https://data.gdeltproject.org/gdeltv2/{stamp}.export.CSV.zip"
    req = urllib.request.Request(url, headers={"User-Agent": "atlas-data-build"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
    except Exception:
        return []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        text = io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8", errors="replace")
        return [row for row in csv.reader(text, delimiter="\t", quoting=csv.QUOTE_NONE) if len(row) >= 61]


def hotspots(_):
    path = os.path.join(OUT, "hotspots.json")
    if fresh(path, HOTSPOT_MAX_AGE):
        return "cached"
    req = urllib.request.Request("https://data.gdeltproject.org/gdeltv2/lastupdate.txt",
                                 headers={"User-Agent": "atlas-data-build"})
    with urllib.request.urlopen(req, timeout=60) as r:
        last = re.search(r"/(\d{14})\.export", r.read().decode()).group(1)
    end = datetime.strptime(last, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    stamps = [(end - timedelta(minutes=15 * i)).strftime("%Y%m%d%H%M%S") for i in range(HOTSPOT_HOURS * 4)]
    with ThreadPoolExecutor(8) as ex:
        batches = list(ex.map(_gdelt_export, stamps))
    if sum(1 for b in batches if b) < len(stamps) // 2:
        raise RuntimeError("too many GDELT event files missing")

    # Column layout: http://data.gdeltproject.org/documentation/GDELT-Event_Codebook-V2.0.pdf
    spots = defaultdict(lambda: {"articles": 0, "events": 0, "conflict": 0, "tone": 0.0, "best": (0, "")})
    for rows in batches:
        for r in rows:
            name, lat, lng = r[52], r[56], r[57]
            if not name or not lat or not lng:
                continue
            try:
                lat_f, lng_f, arts = float(lat), float(lng), int(r[33] or 0)
                quad, tone = int(r[29] or 0), float(r[34] or 0)
            except ValueError:
                continue
            s = spots[(name, round(lat_f, 1), round(lng_f, 1), r[53])]
            s["articles"] += arts
            s["events"] += 1
            s["tone"] += tone * arts
            if quad in (3, 4):  # verbal / material conflict
                s["conflict"] += arts
            if arts > s["best"][0] and r[60].startswith("http"):
                s["best"] = (arts, r[60])
    per_country = defaultdict(int)
    top = []
    for key, s in sorted(spots.items(), key=lambda kv: kv[1]["articles"], reverse=True):
        if per_country[key[3]] < HOTSPOT_PER_COUNTRY:
            per_country[key[3]] += 1
            top.append((key, s))
        if len(top) >= HOTSPOT_TOP:
            break
    out = []
    for (name, lat, lng, _cc), s in top:
        a = max(1, s["articles"])
        url = s["best"][1]
        out.append({
            "name": name, "lat": lat, "lng": lng,
            "articles": s["articles"], "events": s["events"],
            "conflict": round(s["conflict"] / a, 2), "tone": round(s["tone"] / a, 2),
            "url": url, "source": urllib.parse.urlparse(url).netloc.removeprefix("www.") if url else "",
        })
    save(path, {"from": stamps[-1], "to": last, "hours": HOTSPOT_HOURS, "spots": out})
    return "updated"


def run(fn, arg):
    try:
        print(f"{fn(arg):8} {arg if isinstance(arg, str) else arg[0]}", flush=True)
        return True
    except Exception as e:
        print(f"FAILED   {arg if isinstance(arg, str) else arg[0]}: {e}", file=sys.stderr, flush=True)
        return False


if __name__ == "__main__":
    countries = []
    with open(os.path.join(ROOT, "public", "js", "countries.js"), encoding="utf-8") as f:
        for line in f:
            line = line.strip().rstrip(",")
            if line.startswith("{"):
                countries.append(json.loads(line))
    codes = [c["iso3"] for c in countries if c["iso3"] not in NO_WORLD_BANK_DATA]

    if "--hotspots" in sys.argv:
        sys.exit(0 if run(hotspots, "hotspots") else 1)

    # World Bank: parallel (slow responses, no strict rate limit)
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(lambda job: run(*job),
                              [(global_layer, i) for i in GLOBAL] + [(econ, c) for c in codes]))
    results.append(run(build_history, "history"))
    results.append(run(hotspots, "hotspots"))

    # GDELT: strictly one request at a time
    if "--no-news" not in sys.argv:
        jobs = [("_world", WORLD_QUERY, "24h", 50, "datedesc")]
        jobs += [(c["iso3"], f'"{c["name"]}" sourcelang:english', "7d", 75, "hybridrel") for c in countries]
        news_results = [run(news, job) for job in jobs]
        print(f"news: {news_results.count(True)} ok, {news_results.count(False)} failed (old snapshots are kept)")

    failed = results.count(False)
    print(f"economic data: {len(results) - failed} ok, {failed} failed")
    # A few failures shouldn't block the deploy: the site keeps the last good files.
    sys.exit(1 if failed > len(results) // 4 else 0)
