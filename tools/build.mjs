import { cp, mkdir, rm, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const site = path.join(root, 'site');
const data = path.join(root, 'data');
const names = ['index.html', 'styles.css', 'app.js', 'user-state.js', 'runtime-config.js', 'logo.png', 'vendor'];
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of names) await cp(path.join(site, name), path.join(out, name), { recursive: true });
// The JS API key and proxy URL are public runtime configuration; never put the AMap security code in the static artifact.
const runtimeConfig = {
  amapJsKey: process.env.AMAP_JS_KEY || '',
  amapProxyUrl: process.env.AMAP_PROXY_URL || '',
  userApiUrl: process.env.USER_API_URL || ''
};
await writeFile(path.join(out, 'runtime-config.js'), `window.HZ_ATLAS_CONFIG = ${JSON.stringify(runtimeConfig)};\n`);
await cp(data, path.join(out, 'data'), { recursive: true });
// Raw third-party track files are kept for local review, never shipped as public assets.
await rm(path.join(out, 'data/source-tracks'), { recursive: true, force: true });
await rm(path.join(out, 'data/xhs-candidates.json'), { force: true });
const routes = JSON.parse(await readFile(path.join(data, 'routes.json'), 'utf8'));
const places = JSON.parse(await readFile(path.join(data, 'places.json'), 'utf8'));
if (routes.length < 10 || places.length < 50) throw new Error('地图数据量低于预期');
if (routes.filter((r) => r.type === '徒步').length < 5 || routes.filter((r) => r.type === '逛玩').length < 3) throw new Error('路线类型数量不足');
if (routes.some((r) => !['徒步', '逛玩'].includes(r.type))) throw new Error('存在未知路线类型');
const ids = [...routes, ...places].map((item) => item.id);
if (new Set(ids).size !== ids.length) throw new Error('地点或路线 ID 重复');
for (const item of [...routes, ...places]) {
  if (!item.sources?.length || !item.sources.every((source) => /^https:\/\//.test(source.url))) throw new Error(`缺少来源: ${item.id}`);
  if (!Number.isInteger(item.recommendIndex) || item.recommendIndex < 1 || item.recommendIndex > 5) throw new Error(`推荐指数异常: ${item.id}`);
}
for (const place of places) {
  if (!place.tags?.length || !place.district || !place.description || !place.why) throw new Error(`地点说明、区域或标签缺失: ${place.id}`);
  const score = place.amapRating?.score;
  if (score != null && (!Number.isFinite(score) || score <= 0 || score > 5 || place.amapRating.poiId !== place.amapId)) throw new Error(`高德评分异常: ${place.id}`);
}
const stopIds = new Set(places.map((p) => p.id));
for (const route of routes) if (!route.stops.every((id) => stopIds.has(id))) throw new Error(`站点未定义: ${route.id}`);
const placeById = new Map(places.map((place) => [place.id, place]));
function pointToLineMeters(point, path) {
  const latitude = point[1] * Math.PI / 180;
  const xy = (coord) => [(coord[0] - point[0]) * 111320 * Math.cos(latitude), (coord[1] - point[1]) * 111320];
  let nearest = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = xy(path[i - 1]);
    const [bx, by] = xy(path[i]);
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return nearest;
}
for (const route of routes) {
  if (route.path.length < 2) throw new Error(`路线缺少线形: ${route.id}`);
  if (!route.experience || !route.reason) throw new Error(`路线说明缺失: ${route.id}`);
  const scoredStops = route.stops.map((id) => placeById.get(id).amapRating).filter((rating) => Number.isFinite(rating?.score));
  const expectedAverage = scoredStops.length ? Math.round(scoredStops.reduce((sum, rating) => sum + rating.score, 0) / scoredStops.length * 10) / 10 : null;
  if (route.amapRatingSummary?.count !== scoredStops.length || route.amapRatingSummary?.average !== expectedAverage) throw new Error(`路线沿途评分未更新: ${route.id}`);
  for (const id of route.stops) {
    const gap = pointToLineMeters(placeById.get(id).coord, route.path);
    if (gap > 20) throw new Error(`路线与地点偏离 ${Math.round(gap)} 米: ${route.id} / ${id}`);
  }
}
const secretNames = ['api.txt', 'js-key.txt', 'js-security-code.txt'];
async function checkNoSecrets(dir) {
  for (const entry of await readdir(dir)) {
    if (secretNames.includes(entry)) throw new Error(`构建目录包含凭据: ${entry}`);
    const full = path.join(dir, entry);
    if ((await stat(full)).isDirectory()) await checkNoSecrets(full);
  }
}
await checkNoSecrets(out);
console.log(`构建完成：${routes.length} 条路线，${places.length} 个地点 → ${out}`);
