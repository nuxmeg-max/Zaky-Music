// api/proxy.js — jembatan antara website dan Kyzz API.
// API key disimpan di Environment Variables Vercel (KYZZZ_API_KEY), jadi tidak pernah terlihat di browser.
const BASE = 'https://api.kyzzz.xyz';

// Hanya endpoint berawalan ini yang boleh dipanggil (supaya kuota key tidak dipakai orang lain).
const ALLOW = ['/api/music/'];

module.exports = async (req, res) => {
  // res.setHeader('access-control-allow-origin', '*'); // aktifkan jika nanti dipanggil dari APK / file lokal
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method tidak diizinkan' });

  const key = process.env.KYZZZ_API_KEY;
  if (!key) return res.status(500).json({ error: 'KYZZZ_API_KEY belum diisi di Environment Variables Vercel' });

  const { path, ...params } = req.query || {};
  let url;
  try {
    url = new URL(BASE + String((Array.isArray(path) ? path[0] : path) || ''));
  } catch (e) {
    return res.status(400).json({ error: 'Parameter path tidak valid' });
  }
  if (url.origin !== BASE || !ALLOW.some((p) => url.pathname.startsWith(p))) {
    return res.status(400).json({ error: 'Endpoint tidak diizinkan oleh proxy' });
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, Array.isArray(v) ? v[0] : v);
  url.searchParams.set('apikey', key); // kunci dari server selalu menang

  try {
    const r = await fetch(url, {
      headers: { 'x-api-key': key, accept: 'application/json', 'user-agent': 'MEG-Music/1.0' },
      signal: AbortSignal.timeout(25000)
    });
    const body = await r.text();
    // Cache 5 menit supaya kuota API hemat — kecuali link download (bertoken) dan respons error
    const bad = /"status"\s*:\s*false/.test(body.slice(0, 300));
    const cacheable = r.ok && !bad && !url.pathname.endsWith('/download');
    res.setHeader('cache-control', cacheable ? 's-maxage=300, stale-while-revalidate=600' : 'no-store');
    res.setHeader('content-type', r.headers.get('content-type') || 'application/json');
    return res.status(r.status).send(body);
  } catch (e) {
    const msg = String((e && e.message) || e).split(key).join('***');
    return res.status(502).json({ error: 'Gagal menghubungi API: ' + msg });
  }
};
