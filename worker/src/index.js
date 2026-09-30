const STYLE_PREFIX = '/v4/map/styles';
const REST_LOG_PREFIX = '/v3/log/';
const SERVICE_PREFIX = '/_AMapService';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'hangzhou-atlas-amap-proxy' });
    }

    const origin = request.headers.get('Origin');
    if (!origin || origin !== env.SITE_ORIGIN) return new Response('Origin not allowed', { status: 403 });
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: cors });
    if (!env.AMAP_SECURITY_JS_CODE) return new Response('AMap proxy is not configured', { status: 503, headers: cors });

    if (!url.pathname.startsWith(`${SERVICE_PREFIX}/`)) return new Response('Not found', { status: 404, headers: cors });
    const path = url.pathname.slice(SERVICE_PREFIX.length);
    let upstream;
    if (path.startsWith(STYLE_PREFIX)) {
      upstream = new URL(`${path}${url.search}`, 'https://webapi.amap.com');
    } else if (path.startsWith(REST_LOG_PREFIX)) {
      upstream = new URL(`${path}${url.search}`, 'https://restapi.amap.com');
    } else {
      return new Response('AMap endpoint not allowed', { status: 404, headers: cors });
    }
    upstream.searchParams.set('jscode', env.AMAP_SECURITY_JS_CODE);

    try {
      const result = await fetch(upstream, {
        method: request.method,
        headers: { 'User-Agent': 'HangzhouAtlas/1.0' },
        redirect: 'follow'
      });
      const headers = new Headers(result.headers);
      for (const [name, value] of Object.entries(cors)) headers.set(name, value);
      headers.set('Cache-Control', path.startsWith(STYLE_PREFIX) ? 'public, max-age=3600' : 'no-store');
      headers.delete('Set-Cookie');
      return new Response(result.body, { status: result.status, headers });
    } catch {
      return new Response('AMap upstream unavailable', { status: 502, headers: cors });
    }
  }
};
