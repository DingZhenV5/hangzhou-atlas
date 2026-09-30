import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const placeFile = path.join(root, 'data/places.json');
const routeFile = path.join(root, 'data/routes.json');
const places = JSON.parse(await readFile(placeFile, 'utf8'));
const routes = JSON.parse(await readFile(routeFile, 'utf8'));
const checkedAt = '2026-09-29';
const githubSource = { label: 'hangzhou_mountain｜杭州登山路线整理', url: 'https://github.com/smasterfree/hangzhou_mountain' };
const poi = (id, name, category, coord, amapId, score, see, why, description, tags, district = '西湖区') => ({
  id, name, category, stay: '20–40', see, why, coord, coordinateSystem: 'GCJ-02', coordinatePrecision: 'poi', coordinateNote: '', amapId,
  sources: [{ label: '高德地图 POI（位置与评分）', url: `https://ditu.amap.com/place/${amapId}` }, githubSource],
  checkedAt, tags, description, recommendIndex: 4,
  ...(score ? { amapRating: { score, checkedAt, poiId: amapId } } : {}), district
});
const newPlaces = [
  poi('huanglong-cave', '黄龙洞', '山景', [120.138594,30.264511], 'B023B18XEX', 4.6, '山脚入口、林木与石景', '从黄龙洞进入宝石山一带，能把城中山路与西湖视野接起来。', '黄龙洞是宝石山西侧的起步地点，适合从山脚逐渐走向湖边观景点。', ['自然风景']),
  poi('hupao-park', '虎跑公园', '公园', [120.1299,30.208087], 'B023B08Q06', 4.7, '泉水、林荫与山脚园路', '适合作为儿童公园至六和塔路线中的休息点。', '虎跑公园以泉水和林荫见长，可在长一些的山路中途放慢脚步。', ['自然风景']),
  poi('guiren-pavilion', '贵人阁', '山顶观景', [120.125755,30.211098], 'B0FFJEV3II', 4.5, '山脊视野与阁楼', '这段登高提供路线里最鲜明的山景变化。', '贵人阁位于西湖南部群山，登高后可在山脊上看周边山林。', ['自然风景']),
  poi('liuhe-pagoda', '六和塔文化公园', '古迹', [120.131487,30.196338], 'B023B08SQK', 4.7, '古塔与钱塘江景', '可以用历史建筑和江景为山路收尾。', '六和塔临近钱塘江，古塔与江面视野是南线登山的终点亮点。', ['古迹','自然风景']),
  poi('wansong-academy', '万松书院', '古迹', [120.160498,30.226809], 'B023B015D9', 4.7, '书院建筑与山脚林荫', '短线起点有清晰的人文主题，也方便观察附近山体。', '万松书院位于凤凰山一带，书院景观和山路可以串成一段短途步行。', ['古迹','自然风景'], '上城区'),
  poi('fantian-pagodas', '梵天寺经幢', '古迹', [120.167159,30.21764], 'B0FFF342AY', 4.3, '历史经幢与山麓街巷', '短线终点有具体的历史遗迹可看。', '梵天寺经幢是凤凰山南侧的人文节点；地图定位的是经幢，不是临平区同名寺院。', ['古迹'], '上城区')
];
for (const place of newPlaces) if (!places.some((item) => item.id === place.id)) places.push(place);

const retiredTags = new Set(['植物园','动物园','游乐园','主题乐园']);
for (const place of places) {
  if (place.tags.some((tag) => retiredTags.has(tag))) place.tags = [...new Set(place.tags.map((tag) => retiredTags.has(tag) ? '游玩' : tag))];
}

const byId = new Map(places.map((place) => [place.id, place]));
function route(id, name, order, duration, distance, difficulty, difficultyNote, summary, experience, reason, tip, stops, season = '四季') {
  const ratings = stops.map((stop) => byId.get(stop).amapRating?.score).filter(Number.isFinite);
  return { order, id, name, type:'徒步', region:'西湖群山', duration, distance, difficulty, difficultyNote, season,
    summary, experience, reason, tip, stops,
    path: stops.map((stop) => byId.get(stop).coord), coordinateSystem:'GCJ-02', lineAccuracy:'overview_only',
    lineLabel:'仅按公开路线所述节点绘制顺序连线；山路转弯与岔路未逐段核实，非导航轨迹',
    status:'路线节点已核对，线形与通行状况待实地复核', sources:[githubSource], checkedAt, recommendIndex:4,
    amapRatingSummary:{ average:ratings.length ? Math.round(ratings.reduce((a,b)=>a+b,0)/ratings.length*10)/10 : null, count:ratings.length, checkedAt }
  };
}
const newRoutes = [
  route('huanglong-baoshi', '黄龙洞到宝石山', 29, '约 1.5–2.5 小时', '约 2 公里', '轻松上坡', '短线但有连续石阶；雨后石面湿滑。', '从黄龙洞上山，走到宝石山观湖景。', '从黄龙洞进入山林，经过葛岭一带，向保俶塔方向看西湖。', '路线短、登高回报快，适合半天临时决定去爬山。', '实际山路和入口以现场指示为准。', ['huanglong-cave','geling','baochuta']),
  route('children-liuhe', '儿童公园到六和塔', 30, '约 3–4 小时', '约 4 公里', '中等', '山脊有连续上下坡，里程为公开资料概数。', '从儿童公园附近登高，串起贵人阁、虎跑与六和塔。', '在南部群山看林间山脊，再到虎跑歇脚，以六和塔和钱塘江景收尾。', '山景、泉水和古塔集中在一条半日线路中。', '各景区入口和开放情况需临行核对；站点顺序为浏览安排。', ['children-park','guiren-pavilion','hupao-park','liuhe-pagoda']),
  route('wansong-fantian', '万松书院到梵天寺经幢', 31, '约 1–2 小时', '约 2 公里', '轻松上坡', '短线有山坡与台阶；可按体力折返。', '从书院走到凤凰山南侧的历史经幢。', '先看书院，再走近山麓和经幢，用一段短线认识凤凰山附近的人文。', '距离短，适合想走山路又不想占满一天的时候。', '导航终点选“梵天寺经幢”，避免误到临平区同名寺院。', ['wansong-academy','fantian-pagodas'])
];
for (const item of newRoutes) if (!routes.some((route) => route.id === item.id)) routes.push(item);
await writeFile(placeFile, JSON.stringify(places, null, 2) + '\n');
await writeFile(routeFile, JSON.stringify(routes, null, 2) + '\n');
console.log(`${routes.length} routes; ${places.length} places`);
