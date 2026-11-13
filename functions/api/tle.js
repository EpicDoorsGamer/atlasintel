// Cloudflare Pages Function: GET /api/tle?group=starlink
// Fetches satellite orbit data (TLEs) from CelesTrak once and caches it at Cloudflare's
// edge for 2 hours, so every visitor shares one download. CelesTrak updates the data
// every ~2 h and blocks clients that download the same group more often than that.
const GROUPS = new Set(['stations', 'starlink', 'visual', 'weather']);
const TTL = 2 * 3600;

export async function onRequestGet({ request, waitUntil }) {
  const group = new URL(request.url).searchParams.get('group') || '';
  if (!GROUPS.has(group)) return new Response('unknown group', { status: 400 });

  const cache = caches.default;
  const key = new Request(`https://tle-cache.atlas.invalid/${group}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const upstream = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, {
    headers: { 'User-Agent': 'ATLAS globe (Cloudflare Pages Function, cached 2h)' },
  });
  const text = await upstream.text();
  if (!upstream.ok || !/^1 /m.test(text)) {
    return new Response(text.slice(0, 300), { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const res = new Response(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=${TTL}`,
    },
  });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
