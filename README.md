# 杭州去哪儿 · Hangzhou Atlas

一张用于挑选杭州周末去处的地图。路线分为徒步和逛玩，地点可按区域、类型和主题筛选，并查看介绍、建议用时、推荐理由及资料来源。

## V1 内容

- 148 个地点、41 条路线，覆盖杭州 12 个区县。
- 路线可查看沿途地点、难度、参考距离和地图线形；部分线形仍是浏览示意，不作导航使用。
- 地点包含简短介绍、看点、高德 POI 评分（若有）和编辑推荐指数。

## 本地运行

需要 Node.js 20 或更新版本。若使用高德地图，在本机 `AmapAPI/` 下分别放置 JS API Key、安全密钥和 Web 服务 Key，文件名见下方。不要把这些凭据提交到 Git。

```text
AmapAPI/js-key.txt
AmapAPI/js-security-code.txt
AmapAPI/api.txt
```

在项目根目录运行：

```powershell
node tools/build.mjs
node tools/preview.mjs
```

然后打开 `http://127.0.0.1:4173/`。页面需要联网加载地图；没有高德凭据时会尝试使用 OpenStreetMap 备用底图。

## 项目结构

```text
site/       页面、样式、交互和备用地图依赖
data/       地点与路线数据
tools/      构建和本地预览脚本
docs/       V1 数据与维护方案
private/    本地工作资料，不纳入 Git
AmapAPI/    本机地图凭据，不纳入 Git
dist/       构建产物，不纳入 Git
```

## 维护数据

- 地点编辑 `data/places.json`：保持 ID 唯一、坐标使用 GCJ-02，并保留来源链接。
- 路线编辑 `data/routes.json`：路线站点引用地点 ID；示意线不能描述为实走或导航轨迹。
- 运行 `node tools/build.mjs` 检查数据与站点引用，再用本地页面核对地图显示。
- 高德地图与 GitHub Pages 的安全接入步骤见 [高德地图部署说明](docs/AMAP-DEPLOY.md)。

编辑字段和维护约定见 [`docs/V1-PLAN.md`](docs/V1-PLAN.md)。

## 发布状态

网页通过 GitHub Pages 工作流构建：推送 `main` 后，工作流运行 `node tools/build.mjs` 并发布 `dist/`。公开前需复核地点与路线来源、路线真实性和公开范围。API 密钥及本地研究材料不进入网站构建目录或版本库。
