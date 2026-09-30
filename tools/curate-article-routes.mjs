import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const placeFile = path.join(root, 'data/places.json');
const routeFile = path.join(root, 'data/routes.json');
const places = JSON.parse(await readFile(placeFile, 'utf8'));
const routes = JSON.parse(await readFile(routeFile, 'utf8'));
const checkedAt = '2026-09-29';
const qianjiang = {label:'浙江在线·钱江晚报｜杭州十大登山徒步线路（2020）',url:'https://zjnews.zjol.com.cn/zjnews/hznews/202001/t20200102_11533749_ext.shtml'};
const zhihu = {label:'知乎｜杭州周边徒步线路（用户提供摘录）',url:'https://zhuanlan.zhihu.com/p/517247486'};

const additions = [
  {id:'lian-temple',name:'理安寺',category:'古迹',stay:'20–40',see:'溪谷旁的寺院与山林',why:'九溪徒步途中可以短暂停留，给茶山路线增加人文看点。',coord:[120.112958,30.207319],coordinateSystem:'GCJ-02',coordinatePrecision:'poi',coordinateNote:'',amapId:'B0FFFDE5LV',sources:[{label:'高德地图 POI（位置与评分）',url:'https://ditu.amap.com/place/B0FFFDE5LV'},qianjiang],checkedAt,tags:['古迹','自然风景'],description:'理安寺位于九溪一带，靠近溪谷和山路，是西湖西南徒步线路的可选停靠点。',recommendIndex:4,amapRating:{score:4.5,checkedAt,poiId:'B0FFFDE5LV'},district:'西湖区'},
  {id:'baita-park',name:'杭州白塔公园',category:'公园',stay:'30–60',see:'白塔、旧铁路与江岸景观',why:'可以在山线结束后继续看白塔和近江城市景观。',coord:[120.141759,30.199481],coordinateSystem:'GCJ-02',coordinatePrecision:'poi',coordinateNote:'',amapId:'B023B08YX1',sources:[{label:'高德地图 POI（位置与评分）',url:'https://ditu.amap.com/place/B023B08YX1'},qianjiang],checkedAt,tags:['古迹','自然风景'],description:'白塔公园将古塔和旧铁路遗存融入江边公园，可作为南线徒步结束后的延伸参观。',recommendIndex:4,amapRating:{score:4.7,checkedAt,poiId:'B023B08YX1'},district:'上城区'}
];
for (const place of additions) if (!places.some((item)=>item.id===place.id)) places.push(place);
const byId = new Map(places.map((place)=>[place.id,place]));
function makeRoute({id,name,order,region,duration,distance,difficulty,difficultyNote,summary,experience,reason,tip,stops,source,season}) {
  const ratings=stops.map((id)=>byId.get(id).amapRating?.score).filter(Number.isFinite);
  return {order,id,name,type:'徒步',region,duration,distance,difficulty,difficultyNote,season,summary,experience,reason,tip,stops,
    path:stops.map((id)=>byId.get(id).coord),coordinateSystem:'GCJ-02',lineAccuracy:'overview_only',lineLabel:'依据文章所述主要节点绘制站点示意连线；并非逐段步道或导航轨迹',status:'文章路线节点已整理，部分中间节点与当下通行情况待复核',sources:[source],checkedAt,recommendIndex:4,
    amapRatingSummary:{average:ratings.length?Math.round(ratings.reduce((a,b)=>a+b,0)/ratings.length*10)/10:null,count:ratings.length,checkedAt}};
}
const newRoutes = [
  makeRoute({id:'jiuxi-guiren-baita',name:'九溪登高看西湖与钱塘江',order:32,region:'西湖南线',duration:'约 3–5 小时',distance:'约 7 公里',difficulty:'中等',difficultyNote:'文章参考里程约 7 公里，需从九溪上山并经山脊下行；难度为编辑估计。',season:'四季',summary:'从九溪经理安寺、贵人阁、六和塔走向白塔公园。',experience:'先走溪谷和茶山，再登贵人阁看西湖与钱塘江，最后到六和塔、白塔公园。',reason:'一条线里可以从溪谷走到山脊，再把湖景、江景和古塔连起来。',tip:'文章发表于 2020 年；理安寺至贵人阁等山路段和景区入口需按现况核查。',stops:['jiuxi-yanshu','lian-temple','guiren-pavilion','liuhe-pagoda','baita-park'],source:qianjiang}),
  makeRoute({id:'jiuxi-yangmeiling-shili',name:'九溪、杨梅岭到十里琅珰',order:33,region:'西湖西南',duration:'约半天',distance:'里程待核对',difficulty:'中等',difficultyNote:'包含溪谷与茶山上坡；来源未给出完整里程与累计爬升，按中等强度暂列。',season:'四季',summary:'沿九溪上行，经理安寺、杨梅岭、龙井村，走向十里琅珰。',experience:'一路从九溪的水声走进茶村，再到龙井茶园与十里琅珰的山景。',reason:'水、茶村和山脊在一条线上连续出现，景观变化丰富。',tip:'岔路较多，十里琅珰段的入口与下撤点须现场核实；这条站点示意线不能用于导航。',stops:['jiuxi-yanshu','lian-temple','yangmeiling','longjing-village','shili'],source:zhihu})
];
for(const route of newRoutes) if(!routes.some((item)=>item.id===route.id)) routes.push(route);
await writeFile(placeFile,JSON.stringify(places,null,2)+'\n');
await writeFile(routeFile,JSON.stringify(routes,null,2)+'\n');
console.log(`${routes.length} routes; ${places.length} places`);
