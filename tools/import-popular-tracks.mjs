import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routesFile = path.join(root, 'data/routes.json');
const placesFile = path.join(root, 'data/places.json');
const routes = JSON.parse(await readFile(routesFile, 'utf8'));
const places = JSON.parse(await readFile(placesFile, 'utf8'));
const base = 'https://github.com/smasterfree/hangzhou_mountain/blob/main/原始数据/热门路线/';
const checkedAt = '2026-09-30';

// These names and descriptions are editorial. Source coordinates are retained unmodified.
const entries = [
  { id:'mini-shili', file:'mini-shili.txt', source:'迷你十里琅珰.txt', name:'迷你十里琅珰', start:'龙井村牌坊侧入口', end:'梅家坞牌坊侧出口', region:'西湖西南', duration:'约 1.5–2.5 小时', difficulty:'入门', season:'四季', summary:'从龙井村一侧走到梅家坞，短距离体验山脊与茶乡。', experience:'由龙井村一侧上山，经山林和茶园边的步道，下至梅家坞一侧。', reason:'里程适中，适合初次体验十里琅珰的山景。', tip:'起终点在两个村落方向，返程交通需提前安排。' },
  { id:'beigaofeng-loop', file:'beigaofeng-loop.txt', source:'北高峰小环线.txt', name:'北高峰小环线', start:'灵隐侧登山入口', end:'法云弄侧下山口', region:'西湖北部', duration:'约 2–3 小时', difficulty:'中等', season:'四季', summary:'从灵隐附近登北高峰，走一段山脊后由法云弄方向下山。', experience:'短线里包含持续爬升、山顶视野和山脊步道。', reason:'能用半天体验北高峰周边山路。', tip:'山顶附近可能拥挤，雨后石阶湿滑。' },
  { id:'children-liuhe', file:'children-liuhe.txt', source:'儿童公园至六和塔.txt', name:'儿童公园到六和塔', start:'儿童公园侧登山口', end:'六和塔侧下山口', region:'西湖西南', duration:'约 2.5–3.5 小时', difficulty:'中等', season:'四季', summary:'沿山路从儿童公园方向走到六和塔附近。', experience:'经过西湖南侧的山林与观景地，终点接近六和塔。', reason:'把山路和钱塘江畔的历史地标串在一起。', tip:'来源线在儿童公园和六和塔附近起止，不保证经过园区内部。' },
  { id:'wansong-fantian', file:'wansong-fantian.txt', source:'万松书院至梵天寺.txt', name:'万松书院到梵天寺', start:'万松书院侧登山口', end:'梵天寺侧下山口', region:'凤凰山', duration:'约 2–3 小时', difficulty:'中等', season:'四季', summary:'从万松书院附近入山，沿凤凰山一带走向梵天寺。', experience:'有林间山路，也能顺访书院和寺址一带的人文地点。', reason:'适合想把登山与杭州历史放在同一天的人。', tip:'轨迹终点在梵天寺附近，具体入口和寺址开放情况以现场为准。' },
  { id:'siyanjing-nanping', file:'siyanjing-nanping.txt', source:'四眼井至南屏晚钟.txt', name:'四眼井到南屏晚钟', start:'四眼井侧登山口', end:'南屏山侧下山口', region:'西湖南岸', duration:'约 2–3 小时', difficulty:'中等', season:'四季', summary:'从四眼井方向翻越南屏山一带，下到南屏晚钟附近。', experience:'途经林坡和山脊，逐渐接近南屏山历史景区。', reason:'较短的山线里兼有林地与西湖人文。', tip:'南屏晚钟是景区名称；轨迹出口不等于寺院入口。' },
  { id:'yuquan-laoheshan', file:'yuquan-laoheshan.txt', source:'玉泉山至古荡老和山入口.txt', name:'玉泉山到老和山', start:'玉泉山侧入口', end:'古荡老和山侧出口', region:'西湖北部', duration:'约 2–3 小时', difficulty:'中等', season:'四季', summary:'从玉泉山方向走向老和山，穿行城边山林。', experience:'在植物园以北的山体间走一段起伏步道，由古荡方向出山。', reason:'离城区近，适合半日进山。', tip:'来源端点位置仅按原始坐标标示，先核对现场入口。' },
  { id:'longjing-tea-museum', file:'longjing-tea-museum.txt', source:'龙井寺至茶叶博物馆.txt', name:'龙井寺到茶叶博物馆', start:'龙井寺侧入口', end:'茶叶博物馆侧出口', region:'西湖西南', duration:'约 2–3 小时', difficulty:'中等', season:'四季', summary:'从龙井一侧越山，到茶叶博物馆附近下山。', experience:'经过龙井周边山林与茶区，终点可顺路了解茶文化。', reason:'山路与茶文化主题结合得自然。', tip:'轨迹到博物馆附近，参观需另查馆舍开放安排。' },
  { id:'manjuelong-santaishan', file:'manjuelong-santaishan.txt', source:'上满觉陇至三台山.txt', name:'上满觉陇到三台山', start:'上满觉陇侧入口', end:'三台山侧出口', region:'西湖南岸', duration:'约 1.5–2.5 小时', difficulty:'中等', season:'秋 / 四季', summary:'从满觉陇附近上山，沿山坡走向三台山。', experience:'有起伏山路与林间视野，秋季可顺路感受桂花季。', reason:'短线适合把山路和满觉陇一带串起来。', tip:'桂花季车流人流多；轨迹不表示花期或当前可通行。' },
  { id:'shili-langdang-track', file:'shili-langdang.txt', source:'十里琅珰.txt', name:'十里琅珰纵走', start:'上天竺侧入口', end:'九溪口侧出口', region:'西湖西南', duration:'约 4–5 小时', difficulty:'中等偏难', season:'春 / 秋', summary:'从上天竺方向走较完整的十里琅珰山脊，向九溪一侧下山。', experience:'山脊、茶山与溪谷景观连续变化，是比迷你线更完整的一段。', reason:'适合已有半日徒步经验、想看更多山景的人。', tip:'超过 6 公里且有持续起伏，备足水并预留返程时间。' },
  { id:'xixigu-walk', file:'xixigu.txt', source:'西溪谷慢行道.txt', name:'西溪谷慢行道', start:'古荡双口井侧起点', end:'留下西穆坞侧终点', region:'西湖西部', duration:'约 4–6 小时', difficulty:'中等偏难', season:'四季', summary:'从古荡向留下方向长距离穿行西溪谷沿线。', experience:'路线较长，沿城西山谷串联不同村道与绿道景观。', reason:'适合想走一整段城西山谷的人。', tip:'约 12 公里，部分道路和出口需现场核对；可按体力分段。' }
];

const meters = (a,b) => Math.hypot((a[0]-b[0])*111320*Math.cos((a[1]+b[1])*Math.PI/360), (a[1]-b[1])*111320);
let addedRoutes = 0, updatedRoutes = 0, addedPlaces = 0;
for (const entry of entries) {
  const raw = (await readFile(path.join(root, 'data/source-tracks', entry.file), 'utf8')).trim();
  const pathPoints = raw.split(/\s+/).map((pair) => pair.split(',').map(Number));
  if (pathPoints.length < 25 || pathPoints.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))) throw new Error(`轨迹格式异常：${entry.file}`);
  let distance = 0, maxStep = 0;
  for (let i=1;i<pathPoints.length;i++) { const step = meters(pathPoints[i-1],pathPoints[i]); distance += step; maxStep = Math.max(maxStep,step); }
  if (maxStep > 250 || pathPoints.some(([lon,lat])=>lon<120.04||lon>120.20||lat<30.17||lat>30.31)) throw new Error(`轨迹跳点或范围异常：${entry.file}`);
  const source = { label:`hangzhou_mountain｜${entry.name}原始坐标`, url:base+encodeURIComponent(entry.source) };
  const stopIds = [];
  for (const [index,label] of [[0,entry.start],[1,entry.end]]) {
    const id = `${entry.id}-${index ? 'exit' : 'entrance'}`;
    const coord = index ? pathPoints.at(-1) : pathPoints[0];
    stopIds.push(id);
    if (places.some((place)=>place.id===id)) continue;
    places.push({ id, name:label, category:'登山出入口', stay:'5–10', see:'路线的出入山位置', why:'帮助在地图上辨认这条路线的起终点。', coord, coordinateSystem:'未明确（与高德底图视觉接近）', coordinatePrecision:'source-track-endpoint', coordinateNote:'直接取自公开仓库的轨迹端点；入口名称按来源路线描述整理，尚未实地核验。', amapId:'', sources:[source], checkedAt, tags:['自然风景'], description:`「${entry.name}」公开轨迹的${index?'终':'起'}点，具体出入口和通行情况请以现场指示为准。`, recommendIndex:3, district:'西湖区' });
    addedPlaces++;
  }
  const rounded = Math.round(distance/100)/10;
  const route = routes.find((item)=>item.id===entry.id);
  const next = route ?? { id:entry.id, order:Math.max(...routes.map((r)=>r.order))+1, type:'徒步', recommendIndex:4 };
  Object.assign(next, { name:entry.name, region:entry.region, duration:entry.duration, distance:`约 ${rounded} 公里（坐标估算）`, distanceLabel:'轨迹长度估算', difficulty:entry.difficulty, difficultyNote:`来源轨迹 ${pathPoints.length} 点，逐点相加约 ${rounded} 公里；累计爬升、路面及当前通行待核实。`, season:entry.season, summary:entry.summary, experience:entry.experience, reason:entry.reason, tip:entry.tip, stops:stopIds, path:pathPoints, coordinateSystem:'来源未标明；与高德底图视觉接近', lineAccuracy:'overview_only', lineLabel:`按公开仓库的 ${pathPoints.length} 个顺序坐标点绘制；原文件未标坐标系，未经实地复核，非导航轨迹`, status:'来源曲线已导入，端点与通行状况待实地复核', sources:[source], checkedAt, amapRatingSummary:{average:null,count:0,checkedAt} });
  if (!route) { routes.push(next); addedRoutes++; } else updatedRoutes++;
  console.log(`${entry.name}: ${pathPoints.length} 点，${rounded} 公里，最大相邻间距 ${Math.round(maxStep)} 米`);
}
await writeFile(placesFile,JSON.stringify(places,null,2)+'\n');
await writeFile(routesFile,JSON.stringify(routes,null,2)+'\n');
console.log(`新增 ${addedRoutes} 条路线、${addedPlaces} 个端点；更新 ${updatedRoutes} 条路线`);
