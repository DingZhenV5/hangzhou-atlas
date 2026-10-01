import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(root, 'dist');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const readSecret = async (name) => (await readFile(path.join(root, 'AmapAPI', name), 'utf8')).trim();
let jsKey = '', securityCode = '';
try { [jsKey, securityCode] = await Promise.all([readSecret('js-key.txt'), readSecret('js-security-code.txt')]); }
catch { console.warn('未找到高德 JS Key / 安全密钥，本地预览将使用备用底图。'); }

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  try {
    if (url.pathname === '/runtime-config.js') {
      response.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-store' });
      response.end(`window.HZ_ATLAS_CONFIG = ${JSON.stringify({ amapJsKey: jsKey, amapProxyUrl: jsKey && securityCode ? `http://${host}:${port}/_AMapService` : '', userApiUrl: process.env.USER_API_URL || '' })};`);
      return;
    }
    if (url.pathname.startsWith('/_AMapService/')) {
      if (request.method !== 'GET' || !securityCode) { response.writeHead(403); response.end(); return; }
      const suffix = url.pathname.slice('/_AMapService/'.length);
      const base = suffix.startsWith('v4/map/styles') ? 'https://webapi.amap.com/' : 'https://restapi.amap.com/';
      const upstream = new URL(suffix + url.search, base);
      upstream.searchParams.set('jscode', securityCode);
      const result = await fetch(upstream, { headers: { 'User-Agent': 'HangzhouAtlasPreview/1.0' } });
      const headers = { 'Content-Type': result.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': `http://${host}:${port}` };
      response.writeHead(result.status, headers);
      response.end(Buffer.from(await result.arrayBuffer()));
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.resolve(siteDir, '.' + pathname);
    if (!filePath.startsWith(siteDir + path.sep)) { response.writeHead(403); response.end(); return; }
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not file');
    response.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(filePath));
  } catch (error) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found'); }
}).listen(port, host, () => console.log(`本地预览：http://${host}:${port}/`));
