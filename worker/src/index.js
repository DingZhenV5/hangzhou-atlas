const STYLE_PREFIX = '/v4/map/styles';
const REST_LOG_PREFIX = '/v3/log/';
const SERVICE_PREFIX = '/_AMapService';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ALGORITHM = 'pbkdf2-sha256-v1';
const DEFAULT_PASSWORD_ITERATIONS = 100_000;
const MAX_PASSWORD_ITERATIONS = 600_000;
const MAX_BODY_BYTES = 4096;
const USERNAME_PATTERN = /^[\p{L}\p{N}_]{2,24}$/u;
const ENTITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;
const encoder = new TextEncoder();

function allowedOrigins(env) {
  return new Set([env.SITE_ORIGIN].filter(Boolean));
}

function corsHeaders(origin, methods = 'GET, HEAD, OPTIONS') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, status, cors = {}) {
  return Response.json(data, {
    status,
    headers: { ...cors, 'Cache-Control': 'no-store', 'Pragma': 'no-cache' }
  });
}

function fail(message, status, cors) {
  return json({ error: message }, status, cors);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64ToBytes(value) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', value));
}

async function passwordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function passwordIterations(env) {
  const configured = Number(env.PASSWORD_ITERATIONS);
  return Number.isInteger(configured) && configured >= 100_000 && configured <= MAX_PASSWORD_ITERATIONS
    ? configured : DEFAULT_PASSWORD_ITERATIONS;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function normalizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const username = raw.normalize('NFKC').trim();
  const normalized = username.toLowerCase();
  if ([...username].length < 2 || [...username].length > 24 || !USERNAME_PATTERN.test(username)) return null;
  if (/\p{Cc}/u.test(username)) return null;
  return { username, normalized };
}

function validPassword(value) {
  return typeof value === 'string' && [...value].length >= 6 && [...value].length <= 128;
}

async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (encoder.encode(text).length > MAX_BODY_BYTES) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function rateLimited(request, env, action) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!env.AUTH_LIMITER) return true;
  const result = await env.AUTH_LIMITER.limit({ key: `${action}:${ip}` });
  return !result.success;
}

function bearerToken(request) {
  const value = request.headers.get('Authorization') || '';
  const match = value.match(/^Bearer ([A-Za-z0-9_-]{40,60})$/);
  return match?.[1] || null;
}

async function findSession(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = bytesToBase64Url(await sha256(encoder.encode(token)));
  const now = Date.now();
  const result = await env.DB.prepare(`
    SELECT users.id, users.username, sessions.id AS session_id
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).bind(tokenHash, now).first();
  return result || null;
}

async function createSession(env, user) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(bytes);
  const tokenHash = bytesToBase64Url(await sha256(encoder.encode(token)));
  const now = Date.now();
  const expiresAt = now + SESSION_MS;
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.id, tokenHash, now, expiresAt).run();
  return { token, expiresAt };
}

async function handleRegister(request, env, cors) {
  if (await rateLimited(request, env, 'register')) return fail('操作过于频繁，请稍后再试。', 429, cors);
  const body = await readJson(request);
  const normalized = normalizeUsername(body?.username);
  if (!normalized) return fail('用户名需为 2–24 位中文、英文、数字或下划线。', 400, cors);
  if (!validPassword(body?.password)) return fail('密码长度需为 6–128 个字符。', 400, cors);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = passwordIterations(env);
  const digest = await passwordHash(body.password, salt, iterations);
  const encodedHash = `pbkdf2$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(digest)}`;
  const user = { id: crypto.randomUUID(), username: normalized.username };
  try {
    await env.DB.prepare(`INSERT INTO users (id, username, username_normalized, password_hash, password_algorithm, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(user.id, user.username, normalized.normalized, encodedHash, PASSWORD_ALGORITHM, Date.now()).run();
  } catch {
    return fail('无法创建同步账号，请检查用户名是否已使用。', 409, cors);
  }

  const session = await createSession(env, user);
  return json({ token: session.token, expiresAt: session.expiresAt, user }, 201, cors);
}

async function handleLogin(request, env, cors) {
  if (await rateLimited(request, env, 'login')) return fail('操作过于频繁，请稍后再试。', 429, cors);
  const body = await readJson(request);
  const normalized = normalizeUsername(body?.username);
  if (!normalized || !validPassword(body?.password)) return fail('用户名或密码不正确。', 401, cors);

  const row = await env.DB.prepare('SELECT id, username, password_hash, password_algorithm FROM users WHERE username_normalized = ?')
    .bind(normalized.normalized).first();
  const parts = row?.password_hash?.split('$') || [];
  let salt, expected, iterations;
  if (row?.password_algorithm === PASSWORD_ALGORITHM && parts.length === 4 && parts[0] === 'pbkdf2') {
    iterations = Number(parts[1]);
    try { salt = base64ToBytes(parts[2]); expected = base64ToBytes(parts[3]); } catch { salt = null; }
  }
  if (!salt || !expected || !Number.isInteger(iterations) || iterations < 100_000 || iterations > MAX_PASSWORD_ITERATIONS) {
    salt = new Uint8Array(16);
    expected = new Uint8Array(32);
    iterations = DEFAULT_PASSWORD_ITERATIONS;
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(body.password), 'PBKDF2', false, ['deriveBits']);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
  if (!row || row.password_algorithm !== PASSWORD_ALGORITHM || !constantTimeEqual(actual, expected)) {
    return fail('用户名或密码不正确。', 401, cors);
  }

  const session = await createSession(env, row);
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()).run();
  return json({ token: session.token, expiresAt: session.expiresAt, user: { id: row.id, username: row.username } }, 200, cors);
}

async function handleLogout(request, env, cors, user) {
  const token = bearerToken(request);
  if (token && user) {
    const tokenHash = bytesToBase64Url(await sha256(encoder.encode(token)));
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ? AND user_id = ?').bind(tokenHash, user.id).run();
  }
  return json({ ok: true }, 200, cors);
}

async function handleMarks(request, env, cors, user, url) {
  if (request.method === 'GET' && url.pathname === '/api/marks') {
    const result = await env.DB.prepare(`SELECT entity_type, entity_id, favorite, want_to_go, visited, visited_at, updated_at
      FROM user_marks WHERE user_id = ?`).bind(user.id).all();
    return json({ marks: (result.results || []).map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      favorite: Boolean(row.favorite),
      wantToGo: Boolean(row.want_to_go),
      visited: Boolean(row.visited),
      visitedAt: row.visited_at,
      updatedAt: row.updated_at
    })) }, 200, cors);
  }

  const match = url.pathname.match(/^\/api\/marks\/(place|route)\/([^/]+)$/);
  if (request.method !== 'PUT' || !match) return fail('未找到该接口。', 404, cors);
  let entityId;
  try { entityId = decodeURIComponent(match[2]); } catch { return fail('地点或路线编号无效。', 400, cors); }
  if (!ENTITY_ID_PATTERN.test(entityId)) return fail('地点或路线编号无效。', 400, cors);
  const body = await readJson(request);
  if (!body || typeof body.favorite !== 'boolean' || typeof body.wantToGo !== 'boolean' || typeof body.visited !== 'boolean') {
    return fail('状态数据无效。', 400, cors);
  }
  const visited = body.visited;
  const wantToGo = body.wantToGo && !visited;
  const favorite = body.favorite;
  const visitedAt = visited && Number.isSafeInteger(body.visitedAt) ? body.visitedAt : (visited ? Date.now() : null);
  const updatedAt = Date.now();
  if (!favorite && !wantToGo && !visited) {
    await env.DB.prepare('DELETE FROM user_marks WHERE user_id = ? AND entity_type = ? AND entity_id = ?')
      .bind(user.id, match[1], entityId).run();
  } else {
    await env.DB.prepare(`INSERT INTO user_marks (user_id, entity_type, entity_id, favorite, want_to_go, visited, visited_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET
        favorite = excluded.favorite, want_to_go = excluded.want_to_go, visited = excluded.visited,
        visited_at = excluded.visited_at, updated_at = excluded.updated_at`)
      .bind(user.id, match[1], entityId, Number(favorite), Number(wantToGo), Number(visited), visitedAt, updatedAt).run();
  }
  return json({ ok: true, updatedAt }, 200, cors);
}

async function handleApi(request, env, origin, url) {
  const cors = corsHeaders(origin, 'GET, POST, PUT, OPTIONS');
  if (!env.DB) return fail('用户同步数据库尚未配置。', 503, cors);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method === 'POST' && url.pathname === '/api/auth/register') return handleRegister(request, env, cors);
  if (request.method === 'POST' && url.pathname === '/api/auth/login') return handleLogin(request, env, cors);

  const user = await findSession(request, env);
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') return handleLogout(request, env, cors, user);
  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    if (!user) return fail('登录状态已过期，请重新登录。', 401, cors);
    return json({ user: { id: user.id, username: user.username } }, 200, cors);
  }
  if (url.pathname === '/api/marks' || url.pathname.startsWith('/api/marks/')) {
    if (!user) return fail('登录状态已过期，请重新登录。', 401, cors);
    return handleMarks(request, env, cors, user, url);
  }
  return fail('未找到该接口。', 404, cors);
}

async function handleAmap(request, env, origin, url) {
  const cors = { ...corsHeaders(origin), 'Access-Control-Allow-Headers': '*' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: cors });
  if (!env.AMAP_SECURITY_JS_CODE) return new Response('AMap proxy is not configured', { status: 503, headers: cors });
  if (!url.pathname.startsWith(`${SERVICE_PREFIX}/`)) return new Response('Not found', { status: 404, headers: cors });
  const path = url.pathname.slice(SERVICE_PREFIX.length);
  let upstream;
  if (path.startsWith(STYLE_PREFIX)) upstream = new URL(`${path}${url.search}`, 'https://webapi.amap.com');
  else if (path.startsWith(REST_LOG_PREFIX)) upstream = new URL(`${path}${url.search}`, 'https://restapi.amap.com');
  else return new Response('AMap endpoint not allowed', { status: 404, headers: cors });
  upstream.searchParams.set('jscode', env.AMAP_SECURITY_JS_CODE);
  try {
    const result = await fetch(upstream, { method: request.method, headers: { 'User-Agent': 'HangzhouAtlas/1.0' }, redirect: 'follow' });
    const headers = new Headers(result.headers);
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    headers.set('Cache-Control', path.startsWith(STYLE_PREFIX) ? 'public, max-age=3600' : 'no-store');
    headers.delete('Set-Cookie');
    return new Response(result.body, { status: result.status, headers });
  } catch {
    return new Response('AMap upstream unavailable', { status: 502, headers: cors });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'hangzhou-atlas-amap-proxy' });
    }

    const origin = request.headers.get('Origin');
    if (!origin || !allowedOrigins(env).has(origin)) return new Response('Origin not allowed', { status: 403 });
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!['GET', 'POST', 'PUT', 'OPTIONS'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      try { return await handleApi(request, env, origin, url); }
      catch { return fail('服务暂时不可用，请稍后再试。', 503, corsHeaders(origin, 'GET, POST, PUT, OPTIONS')); }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    return handleAmap(request, env, origin, url);
  }
};
