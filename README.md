# 杭州去哪儿 · Hangzhou Atlas

一张帮你决定周末去哪儿的杭州旅行地图。路线分为「徒步」和「逛玩」，地点另有博物馆、商场、游玩等标签；可查看沿途地点、看点、建议用时、推荐理由、难度、评分与资料来源。

## 当前版本

**V1 扩充预览，尚未公开部署。** 已收录 148 个地点、41 条路线（徒步 27 条、逛玩 14 条），覆盖杭州 12 个区县；116 个地点有本次查询到的高德 POI 评分。11 条徒步路线使用 [hangzhou_mountain](https://github.com/smasterfree/hangzhou_mountain) 的顺序坐标显示弯折，其余 30 条为人工站点示意线。新轨迹仅标起终点，距离为坐标估算；**所有折线均不是可导航或实走验证的轨迹**。公开发布前还需核对坐标系、通行情况和轨迹资料的再使用许可。

项目目录：`E:\凌睿\vibe coding\杭州去哪儿`。换电脑时，复制整个目录，或日后从 GitHub 克隆仓库；凭据需在新电脑单独配置。

## 本地打开

需要 Node.js 20 或更新版本。首次使用在 `AmapAPI/` 放置以下文件（每个文件只写对应的值，不加引号）：

```text
AmapAPI/js-key.txt            高德 Web 端 JS API Key
AmapAPI/js-security-code.txt  对应安全密钥
AmapAPI/api.txt               Web 服务 Key，仅采集候选 POI 时使用
```

在项目根目录执行：

```powershell
node tools/build.mjs
node tools/preview.mjs
```

浏览器打开 `http://127.0.0.1:4173/`。预览服务器读取本地密钥，并代理高德 JS API 的服务请求；安全密钥不会写进网页或构建目录。缺少 Web 端凭据时，页面会尝试使用 OpenStreetMap 备用底图，并将 GCJ-02 坐标转换为 WGS84 显示。地图均需联网，不能直接双击 `index.html` 使用。

## 目录

```text
site/          HTML、CSS、JavaScript 与本地备用地图依赖
data/          已整理的地点和路线 JSON
tools/         构建与本地预览脚本
docs/          V1 方案及原始长期框架
research/      人工复核用的小红书路线与地点候选 CSV（不进入网页构建）
AmapAPI/       本机凭据，已被 .gitignore 排除
dist/          构建产物，已被 .gitignore 排除
README.md      使用与维护说明
CHANGELOG.md   实际完成记录
```

`node tools/build.mjs` 将 `site/` 与地图所需 JSON 复制到 `dist/`，并检查内容数量、来源链接和路线站点引用。它不会把 `AmapAPI/` 或本地留存的原始轨迹文本复制进去。新增曲线的来源与核对状态见 [登山轨迹说明](docs/MOUNTAIN-TRACKS.md)。

小红书首轮已采集 164 条去重候选，并整理为路线及地点审阅 CSV；尚未核验并加入正式地图。原始 CSV 留在被忽略的 `generated/`，去除临时 URL 查询令牌的审阅副本位于 `research/xhs/2026-09-30/`，可随代码一起提交。流程、采集限制和人工核验门槛见 [小红书采集说明](docs/XHS-PILOT.md)。

## 修改内容

1. 在 `data/places.json` 新增地点：唯一 `id`、名称、所属区县 `district`、分类、独立 `tags`、`coord: [经度, 纬度]`（GCJ-02）、简短介绍、看点、推荐理由、停留时间、1–5 分推荐指数和 `sources`。路段代表点须写明 `coordinateNote`。
2. 在 `data/routes.json` 新增路线：唯一 `id`、类型（`徒步`／`逛玩`）、地区、用时、参考里程或交通提示、难度、沿途看点、推荐理由、顺序 `stops`（引用地点 ID）、`path`（GCJ-02 坐标列表）、来源和线形状态。
3. 运行构建和预览，检查地图落点、站点顺序、来源链接及手机布局。每条路线的折线需与真实道路或可靠轨迹逐段核对后，才能将 `lineAccuracy` 升级为已核验轨迹。
4. 更新 `CHANGELOG.md`，再提交 Git。

当前站内搜索只查已收录的本地数据，不会随输入调用高德搜索。所有地点和路线都有可点击的资料来源。高德 Web 服务 Key 只用于本地 POI 候选采集，不参与网页加载。

「徒步」以步行体验为主，包括西湖沿线及老城街巷步行；「逛玩」以博物馆、商圈、游乐体验等目的地组合为主。地点标签与路线类型互相独立，例如博物馆既可单独查看，也可成为一条逛玩路线的站点。

区域、地点主题和路线类型可以组合筛选。主题或区域选中后，地图只显示匹配的地点；路线列表只保留包含匹配地点的路线。点击地图标点或侧栏地点卡片，都会定位并放大至该地点。地图标点默认按博物馆、商圈、游乐、人文、自然分色。

`amapRating` 是高德 POI 的快照评分（本轮核对日期 2026-09-29），缺失时显示「暂无评分」。路线的「沿途高德评分均值」只对有评分的站点取算术平均，**不是高德对路线的评分**。`recommendIndex` 是本站编辑的主观推荐指数。增改地点时应核对 POI ID、坐标和来源；评分可能变化，更新时须一并复核日期并重算途经路线均值。

## 将来部署到 GitHub Pages

仓库包含 `.github/workflows/pages.yml`，推送至默认分支后可在 GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。工作流只上传 `dist/`。当前尚未初始化 Git 仓库、连接远端或启用 Pages；公开地址要等你看过首版后再确定。

GitHub Pages 只能托管静态网页和 JSON。当前 `site/runtime-config.js` 不含 Key，公开页面默认使用备用底图。若要让公开页使用高德，需要单独部署一个保管 JS 安全密钥的代理，并在构建时配置公开的 JS Key 与代理地址；**不要把安全密钥放入 `runtime-config.js`、GitHub 仓库或 Pages**。访客新增／修改公共数据也需要投稿审核流程或后端，不能由纯静态页直接写回仓库。

详细范围和出版核验标准见 [V1 方案](docs/V1-PLAN.md)，长期构想见 [原始框架](docs/hangzhou-atlas-framework.md)，每轮改动见 [更新日志](CHANGELOG.md)。
