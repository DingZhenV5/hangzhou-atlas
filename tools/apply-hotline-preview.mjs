import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const placesFile = path.join(root, 'data/places.json');
const routesFile = path.join(root, 'data/routes.json');
const trackFile = path.join(root, 'data/source-tracks/huanglong-baoshi.txt');
const places = JSON.parse(await readFile(placesFile, 'utf8'));
const routes = JSON.parse(await readFile(routesFile, 'utf8'));
const source = {
  label: 'hangzhou_mountain｜黄龙洞至宝石山原始坐标',
  url: 'https://github.com/smasterfree/hangzhou_mountain/blob/main/%E5%8E%9F%E5%A7%8B%E6%95%B0%E6%8D%AE/%E7%83%AD%E9%97%A8%E8%B7%AF%E7%BA%BF/%E9%BB%84%E9%BE%99%E6%B4%9E%E8%87%B3%E5%AE%9D%E7%9F%B3%E5%B1%B1.txt'
};
const exit = {
  id: 'baoshi-lane-exit', name: '宝石山下一弄出口', category: '登山出入口', stay: '5–10',
  see: '宝石山下山后的街巷出口', why: '为试验轨迹提供清楚的出口定位。',
  coord: [120.15356, 30.260695], coordinateSystem: 'GCJ-02', coordinatePrecision: 'poi',
  coordinateNote: '以“保俶路与宝石山下一弄交叉口”高德 POI 标注出口位置；与来源轨迹末点相距约 17 米。',
  amapId: 'B0FFHVFV0S', sources: [
    { label: '高德地图 POI（出口位置）', url: 'https://ditu.amap.com/place/B0FFHVFV0S' }, source
  ], checkedAt: '2026-09-29', tags: ['自然风景'],
  description: '试验轨迹的下山终点，靠近保俶路与宝石山下一弄交叉口。',
  recommendIndex: 3, district: '西湖区'
};
if (!places.some((place) => place.id === exit.id)) places.push(exit);

const track = (await readFile(trackFile, 'utf8')).trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
if (track.length !== 37 || track.some((point) => point.length !== 2 || point.some((n) => !Number.isFinite(n)))) throw new Error('来源轨迹格式或点数变化，请人工复核');
const route = routes.find((item) => item.id === 'huanglong-baoshi');
if (!route) throw new Error('黄龙洞路线不存在');
const entrance = places.find((place) => place.id === 'huanglong-cave');
route.stops = [entrance.id, exit.id];
route.path = [entrance.coord, ...track, exit.coord];
route.distance = '约 3.1 公里（坐标估算）';
route.distanceLabel = '轨迹长度估算';
route.summary = '从黄龙洞上山，沿曲折山路经过宝石山、保俶塔附近，下至宝石山下一弄。';
route.experience = '从黄龙洞进入山林，经过宝石山和保俶塔附近观湖景，再从宝石山下一弄下山。地图仅标入口和出口，曲线保留来源文件中的弯折。';
route.difficultyNote = '仓库 README 写约 2 公里；按原始坐标逐点计算约 3.1 公里。里程差异、累计爬升和当前路况待复核。';
route.tip = '先按地图查看曲线效果；山路岔口与下山口仍以现场指示为准。';
route.lineAccuracy = 'overview_only';
route.lineLabel = '试用公开仓库的 37 个顺序坐标点绘制曲线；原文件未注明坐标系，按与高德地点落点接近推断为 GCJ-02；非已核验导航轨迹';
route.status = '曲线试验版，线形与通行状况待实地复核';
route.sources = [source, ...route.sources.filter((item) => item.url !== source.url)];
const ratings = route.stops.map((id) => places.find((place) => place.id === id)?.amapRating?.score).filter(Number.isFinite);
route.amapRatingSummary = { average: ratings.length ? Math.round(ratings.reduce((a,b)=>a+b,0)/ratings.length*10)/10 : null, count: ratings.length, checkedAt:'2026-09-29' };
await writeFile(placesFile, JSON.stringify(places, null, 2) + '\n');
await writeFile(routesFile, JSON.stringify(routes, null, 2) + '\n');
console.log(`试验曲线：${track.length} 个来源点；${route.stops.length} 个地图站点`);
