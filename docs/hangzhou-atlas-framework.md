# Hangzhou Atlas — 杭州探索地图

> 一个以地图为核心，将「地点 → 路线 → 合集 → 行程 → 来源 → 个人记录」串联起来的杭州游玩决策与探索网站。

> **当前执行口径（2026-09-29）**：本文保留长期产品构想，出版第一轮以 [V1-PLAN.md](V1-PLAN.md) 为准。V1 使用高德原生地图，包含 100 个以内、有出处的地点，以及至少 10 条有真实可核对轨迹的徒步／Citywalk 路线；计划以 GitHub Pages 发布前端。合集、个人行程、账户、数据库及小红书导入均列为后续阶段。本文后半部分原有的 V0.1–V1.0、100 个地点／20 条路线以及 Next.js＋Supabase 建议，属于早期设想，已由 V1 方案替代。

---

## 1. 项目定位

Hangzhou Atlas 不只是一个“杭州景点地图”，而是一个帮助用户解决以下问题的地图型网站：

- 今天在杭州，不知道去哪里玩
- 想找适合某种天气、时间、同行对象的地点
- 想找一条完整的 Citywalk / 徒步 / 约会 / 一日游路线
- 想查看某个地点的基础信息、推荐玩法和相关路线
- 想把多个地点组合成自己的行程
- 想记录“想去 / 去过 / 收藏”的地方
- 想从小红书、GitHub、杭州文旅、高德等来源整理和沉淀内容

核心体验：

```text
Discover
发现地点
    ↓
Filter
按需求筛选
    ↓
Decide
决定去哪
    ↓
Route
选择完整玩法
    ↓
Plan
安排自己的行程
    ↓
Go
实际游玩
    ↓
Record
收藏 / 去过 / 记录
```

---

# 2. 核心数据对象

项目中的内容不应该全部混在一个“景点”概念中。

第一版先明确 5 个核心对象：

```text
Place
地点

Route
路线

Collection
合集

Trip
个人行程

Source
内容来源
```

它们之间的关系：

```text
                     Source
         AMap / 小红书 / GitHub / 官方 / 自己
                       │
                       ▼
                 Content Inbox
                       │
                Review / Clean
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
      Place          Route       Collection
        │              │              │
        └───────┬──────┘              │
                ▼                     │
              Planner ◀───────────────┘
                │
                ▼
               Trip
                │
                ▼
              My Map
        Want / Been / Favorite
```

---

# 3. Place — 地点

Place 是整个网站最基础的数据。

例如：

- 九溪烟树
- 龙井村
- 法喜寺
- 浙江省博物馆
- 良渚博物院
- 小河直街
- 天目里
- 宝石山
- 湘湖
- 杭州国家版本馆

---

## 3.1 地点基础信息

地点基础信息可以优先从高德地图 API 获取：

```text
name
amapId
longitude
latitude
address
district
category
openingHours
phone
rating
photos
businessArea
```

高德负责解决：

> 这个地方是什么、在哪里。

Hangzhou Atlas 自己维护：

> 为什么值得去、适合什么时候去、怎么玩。

例如：

```text
introduction
highlights
tips
recommendedDuration
bestSeason
weatherTags
crowdLevel
priceLevel
suitableFor
personalNote
lastVerifiedAt
```

---

# 4. Category 与 Tag

Category 和 Tag 不应该混为一谈。

## Category

Category 表示：

> 这个地方本质上是什么。

例如：

```text
自然风光
户外运动
人文文化
娱乐体验
休闲生活
吃喝
城市空间
杭州周边
```

建议一级分类：

```text
🌿 自然风光
  ├─ 湖泊
  ├─ 山峰
  ├─ 溪流
  ├─ 湿地
  ├─ 森林
  ├─ 花海
  └─ 观景台

🥾 户外运动
  ├─ 徒步
  ├─ 登山
  ├─ 骑行
  ├─ 露营
  └─ 古道

🏛 人文文化
  ├─ 博物馆
  ├─ 美术馆
  ├─ 历史建筑
  ├─ 古迹
  ├─ 寺庙
  └─ 展览空间

🎮 娱乐体验
  ├─ 游乐园
  ├─ 桌游
  ├─ 密室
  ├─ Livehouse
  ├─ 手作
  ├─ 运动体验
  └─ 动物园 / 水族馆

☕ 休闲生活
  ├─ 咖啡
  ├─ 茶馆
  ├─ 书店
  ├─ 市集
  ├─ 商场
  └─ 公园

🍜 吃喝
  ├─ 杭州菜
  ├─ 小吃
  ├─ 早餐
  ├─ 夜宵
  └─ 特色餐厅

🌃 城市空间
  ├─ 街区
  ├─ Citywalk
  ├─ 夜景
  ├─ 日落
  └─ 建筑

🚗 杭州周边
  ├─ 临安
  ├─ 桐庐
  ├─ 富阳
  ├─ 余杭
  ├─ 淳安
  └─ 建德
```

---

## 4.1 Tag

Tag 表示：

> 这个地方具有什么游玩特征。

Tag 应该按维度组织。

### 天气

```text
晴天
雨天
阴天
避暑
室内
```

### 时间

```text
1小时
2小时
半天
一天
周末
```

### 同行

```text
一个人
情侣
朋友
亲子
父母
```

### 体验

```text
拍照
看日落
夜景
徒步
看展
历史
咖啡
放空
浪漫
刺激
```

### 强度

```text
轻松
需要走路
轻徒步
中等徒步
高强度徒步
```

### 季节

```text
春
夏
秋
冬

樱花
荷花
桂花
银杏
红叶
```

### 交通

```text
地铁
公交
自驾
骑行
```

### 预算

```text
免费
¥
¥¥
¥¥¥
```

---

# 5. Route — 路线

Route 是 Hangzhou Atlas 的核心内容之一。

Place 表示：

> 去哪里。

Route 表示：

> 怎么玩。

例如：

```text
九溪
↓
龙井村
↓
十里琅珰
↓
法喜寺
```

---

## 5.1 Route 类型

第一版建议：

```text
🚶 Citywalk
🥾 Hiking
❤️ Date
🚲 Cycling
🍜 Food Walk
📷 Photography
🌃 Night Walk
🚗 Day Trip
```

---

## 5.2 Route 通用信息

```text
name
slug

routeType

description

startPlace
endPlace

stops[]

distance
duration
difficulty

bestSeason
recommendedTime

transport

suitableFor

tags[]

sources[]

routeStatus

lastVerifiedAt
```

---

## 5.3 徒步路线字段

Hiking 可以额外包含：

```text
elevationGain
elevationLoss
surface
supplyPoints
exitPoints
waterSources
shadeLevel
riskLevel
```

例如：

```text
九溪 → 龙井 → 十里琅珰 → 法喜寺

Distance
9 km

Duration
3–5 h

Elevation Gain
500 m

Difficulty
⭐⭐⭐

Best Season
Spring / Autumn
```

---

## 5.4 Citywalk 字段

```text
distance
duration
architecture
history
cafes
photoSpots
toilets
indoorRatio
```

---

## 5.5 Date 路线字段

```text
atmosphere
budget
walkingDistance
reservationRequired
sunsetRelated
dinnerOptions
rainFriendly
```

---

## 5.6 Day Trip 字段

```text
totalDuration
drivingDistance
parking
transportType
mealSuggestion
returnTime
```

---

# 6. Route Status

尤其是徒步路线，必须维护路线状态。

```text
verified
unverified
seasonal
restricted
dangerous
closed
```

每条路线建议显示：

```text
来源
最后核验时间
路线状态
```

避免旧路线、野路或封闭路线继续被当成正常推荐路线。

---

# 7. 地图路线数据

路线轨迹建议采用：

```text
GeoJSON
```

例如：

```json
{
  "type": "Feature",
  "properties": {
    "routeId": "shili-langdang",
    "name": "十里琅珰"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [120.10, 30.20],
      [120.11, 30.21],
      [120.12, 30.22]
    ]
  }
}
```

未来可以支持：

```text
GPX
↓
GeoJSON
↓
Map
```

---

# 8. Collection — 合集

Collection 不等于路线。

它更接近：

> 某一种需求下值得去哪里。

例如：

```text
杭州下雨天地图

杭州看日落的地方

杭州第一次约会去哪里

杭州适合一个人待着的地方

杭州春天赏花地图

杭州秋天地图

杭州夜生活地图

杭州免费博物馆合集

杭州地铁直达徒步

杭州周末懒人玩法
```

Collection 中可以同时包含：

```text
Place
+
Route
```

---

# 9. Trip — 行程

Route 是公共玩法模板。

Trip 是某个人某一天真正准备执行的计划。

例如：

```text
2026-10-05

13:30 小河直街
15:00 咖啡
16:30 拱宸桥
18:00 晚饭
20:00 夜景
```

Trip 未来支持：

```text
添加 Place
添加 Route

拖拽排序

自动路线规划

估算时间

保存行程
```

---

# 10. Source — 内容来源

Source 应该作为正式数据对象保存。

支持：

```text
AMap

Xiaohongshu

GitHub

杭州文旅

其他网页

Personal Visit
```

字段示例：

```text
id
platform

title
url

author
publishedAt

sourceType

retrievedAt

reliability
```

---

# 11. 小红书内容接入

第一版不依赖小红书官方 API。

设计成：

```text
小红书 URL
↓
Content Inbox
↓
人工整理
↓
Place / Route / Collection
```

例如：

```text
Add Source

Platform
Xiaohongshu

URL
https://...

Author
xxx

Title
杭州秋日 Citywalk

Type
Route
```

未来再扩展：

```text
URL
↓
AI Extract
↓
识别地点
↓
识别路线
↓
生成 Tags
↓
人工 Review
↓
入库
```

---

# 12. GitHub 数据来源

可以重点参考：

```text
Hangzhou Mountain
```

用于：

```text
杭州徒步路线
轨迹数据
路线节点
距离
路线分类
```

但所有外部路线进入网站前都需要经过：

```text
Import
↓
Review
↓
Clean
↓
Verify
↓
Publish
```

---

# 13. Content Inbox

后期建议开发一个内容导入工作台：

```text
/admin/import
```

支持：

```text
AMap

Xiaohongshu

GitHub

Web

Manual

GPX

GeoJSON
```

简单流程：

```text
Add Content

Source:
○ AMap
○ Xiaohongshu
○ GitHub
○ Web
○ Manual

URL:
[_____________________]

Import
```

导入后：

```text
发现地点：

☑ 九溪
☑ 龙井村
☑ 法喜寺

发现路线：

九溪 → 龙井 → 法喜寺

[Create Places]

[Create Route]
```

---

# 14. 地图首页

网站首页直接以地图作为核心。

```text
┌───────────────────────────────────────────────────┐
│ Hangzhou Atlas   搜索地点 / 路线       ♡ My Map │
├─────────────┬─────────────────────────────────────┤
│             │                                     │
│ 去哪里？     │                                     │
│             │                                     │
│ 🌿 自然      │                                     │
│ 🥾 徒步      │                                     │
│ 🏛 博物馆    │                                     │
│ 🎮 娱乐      │            HANGZHOU                 │
│ ☕ 休闲      │               MAP                   │
│ 🍜 美食      │                                     │
│ 🌧 雨天      │                                     │
│             │                                     │
│ ─────────   │                                     │
│             │                                     │
│ 筛选         │                                     │
│             │                                     │
│ ☀ 天气      │                                     │
│ ⏱ 时间      │                                     │
│ 👥 同行      │                                     │
│ 💰 预算      │                                     │
│             │                                     │
└─────────────┴─────────────────────────────────────┘
```

---

# 15. 地点详情

点击地图 Marker 后显示：

```text
九溪烟树

🌿 自然
🥾 徒步
📷 摄影

适合：
秋天 · 情侣 · 半天

简介：
...

营业时间：
...

门票：
...

建议游玩：
2–3h

Tips：
...

──────────

经过这里的路线

九溪 → 龙井
九溪 → 十里琅珰
九溪秋日散步

──────────

♡ 想去
✓ 去过
＋ 加入行程
```

---

# 16. 地图 Marker

不同 Category 使用不同 Marker。

```text
🌿 Natural
🥾 Hiking
🏛 Culture
🎮 Entertainment
☕ Cafe
🍜 Food
📷 Photography
🌃 Night
```

地图行为：

```text
Zoom Out
→ Cluster

Zoom In
→ Place Marker

选择 Route
→ ① ② ③ ④ ⑤
→ 显示 Route Polyline
→ 其他 Marker 弱化
```

---

# 17. 页面结构

第一版：

```text
/
地图首页

/explore
地点探索

/place/:slug
地点详情

/routes
路线列表

/route/:slug
路线详情

/collections
主题合集

/collection/:slug
合集详情

/trip/:id
行程详情
```

后续：

```text
/my-map

/planner

/admin

/admin/import
```

---

# 18. 搜索与筛选

网站应支持组合筛选。

例如：

```text
雨天
+
情侣
+
半天
```

得到：

```text
博物馆
美术馆
室内娱乐
天目里
书店
咖啡
手作
```

再例如：

```text
秋天
+
徒步
+
半天
```

得到：

```text
九溪
十里琅珰
宝石山
北高峰
云栖竹径
龙井村
```

---

# 19. 「不知道去哪」

未来可以做一个核心特色功能：

```text
🎲 帮我决定今天去哪
```

用户输入：

```text
时间
半天

天气
晴

同行
情侣

交通
地铁

预算
200

想要
散步 + 拍照 + 吃饭
```

系统返回：

```text
推荐：

运河 Citywalk

14:00 大兜路
↓
15:00 香积寺
↓
16:00 小河直街
↓
17:30 咖啡
↓
19:00 晚餐
```

---

# 20. My Map

后期加入个人地图。

地点状态：

```text
Want to Go
想去

Been
去过

Favorite
收藏

Recommend
推荐

Skip
不推荐
```

最终形成：

```text
My Hangzhou Map
```

---

# 21. 建议技术栈

第一版推荐：

```text
Next.js

React

TypeScript

Tailwind CSS

Zustand

AMap JS API

GeoJSON
```

后端 / 数据：

```text
Supabase
```

部署：

```text
GitHub
↓
Vercel
```

---

# 22. 建议数据库表

```text
places

routes

route_places

route_tracks

collections

collection_items

trips

trip_items

sources

place_sources

route_sources

tags

place_tags

route_tags
```

后期：

```text
users

user_places

reviews

personal_notes
```

---

# 23. MVP

第一版不要做太多。

## V0.1

完成：

```text
杭州地图

Place

Category

Tags

筛选

地点详情
```

初始数据：

```text
约 100 Places
```

---

## V0.2

增加：

```text
Route

Stops

Polyline

Route Detail

GeoJSON
```

目标：

```text
20 Routes
```

推荐分配：

```text
5 Citywalk

5 Hiking

3 Date

2 Half-day

3 Day Trip

2 Seasonal
```

---

## V0.3

增加：

```text
Collections
```

例如：

```text
雨天

约会

Citywalk

秋天

夜景

博物馆
```

---

## V0.4

增加：

```text
Trip Planner

拖拽地点

调整顺序

路线规划
```

---

## V0.5

增加：

```text
Content Inbox

小红书 URL

网页 URL

GitHub

GPX

GeoJSON
```

---

## V1.0

增加：

```text
Account

Want

Been

Favorite

Personal Notes

AI Recommendation
```

---

# 24. 第一版内容目标

```text
Places
100

Routes
20

Collections
6–10
```

路线：

```text
Citywalk
5

Hiking
5

Date
3

Day Trip
3

Seasonal
2

其他
2
```

---

# 25. 第一批 Collection

建议：

```text
杭州下雨天去哪里

杭州秋天地图

杭州约会地图

杭州免费博物馆

杭州看日落

杭州 Citywalk

杭州轻徒步

杭州周边一日游

杭州一个人也适合去的地方

杭州夜游地图
```

---

# 26. 第一批数据来源

```text
高德地图
→ POI 基础数据

Hangzhou Mountain
→ 徒步路线

小红书
→ 路线灵感 / 地点推荐 / 实际体验

杭州文旅
→ 官方线路 / 人文介绍 / 开放信息

个人实走
→ 路线验证 / Tips / 照片 / 体验
```

原则：

```text
第三方内容提供线索

Hangzhou Atlas 做结构化整理

最终形成自己的 Place / Route 数据
```

---

# 27. 核心产品逻辑

整个网站可以总结为：

```text
DATA

高德
小红书
GitHub
官方
个人

↓

PLACE

杭州有什么值得去

↓

ROUTE

这些地方怎么串起来玩

↓

COLLECTION

某一种需求下去哪

↓

TRIP

我这次具体怎么玩

↓

MY MAP

我去过哪些地方
```

---

# 28. 第一阶段暂时不做

为了控制范围，第一阶段不做：

```text
社交社区

评论系统

复杂推荐算法

即时聊天

关注系统

完整 AI Agent

自动抓取全部小红书内容

复杂权限系统
```

先把：

```text
Map
+
Place
+
Route
+
Filter
```

做好。

---

# 29. 第一阶段成功标准

当用户进入网站后，应该能够做到：

```text
1. 打开杭州地图

2. 根据 Category / Tag 找地点

3. 点击地点查看详情

4. 查看经过这个地点的路线

5. 打开路线查看完整轨迹

6. 根据天气、时间、同行对象筛选玩法

7. 找到一个今天真正可以去玩的地点或路线
```

如果以上体验顺畅，第一版就已经有完整产品价值。

---

# 30. 项目关键词

```text
Hangzhou

Map

Travel

Citywalk

Hiking

Date

Day Trip

POI

Routes

GeoJSON

AMap

Xiaohongshu

Trip Planner

Local Discovery
```

---

## Next Step

下一阶段建议按以下顺序进入开发：

```text
01
确定数据库 Schema

02
确定 Place / Route TypeScript 类型

03
设计地图首页 UI

04
设计 Place Detail

05
设计 Route Detail

06
初始化 Next.js 项目

07
接入 AMap

08
导入第一批杭州地点

09
导入第一批徒步 / Citywalk 路线

10
部署到 Vercel
```
