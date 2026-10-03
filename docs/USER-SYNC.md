# 个人记录与可选云同步

地图、地点和路线继续由 GitHub Pages 发布为静态文件。个人状态保存在浏览器 `localStorage`；登录同步后，Cloudflare Worker 验证账号并访问 D1。Worker 不需要常开服务器。

## 部署进度（2026-10-01）

- [x] Cloudflare 账号与 `workers.dev` 已配置；复用现有 Worker `hangzhou-atlas-amap-proxy`。
- [x] D1 `hangzhou-atlas-user-state` 已创建，数据库 ID：`c9c1c4c6-7b4d-4465-8359-6ae68b9f7ba5`。
- [x] 远程迁移 `0001_user_state.sql` 已应用。
- [x] Worker 已部署，绑定 D1 与 `AUTH_LIMITER`；当前 `PASSWORD_ITERATIONS=100000`。
- [x] Worker 健康检查、GitHub Actions 变量 `USER_API_URL` 与 Pages 发布步骤已完成。
- [ ] 待完成最终验证：打开线上网站，测试注册、登录、收藏/想去/去过的云同步，并在 Worker Metrics 检查注册与登录的 CPU 时间。

Worker 地址：<https://hangzhou-atlas-amap-proxy.hangzhou-atlas.workers.dev>

### Windows PowerShell 的 Wrangler 网络设置

本机使用 Clash Verge 时，浏览器能访问 Cloudflare 不代表 PowerShell/Node.js 自动走系统代理。先在 Clash Verge 的“设置 → Clash 设置 → 端口设置”查看 Mixed Port，然后在同一 PowerShell 窗口设置代理。将端口替换为本机实际值：

```powershell
$proxy = "http://127.0.0.1:7897"
$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:NODE_USE_ENV_PROXY = "1"
```

这些变量只对当前 PowerShell 窗口生效；新开窗口需重新设置。若 PowerShell 报错禁止运行 `npx.ps1`，使用 `npx.cmd`，例如：

```powershell
npx.cmd wrangler whoami
npx.cmd wrangler d1 list
```

## 数据与安全

- D1 migration：`worker/migrations/0001_user_state.sql`，创建 `users`、`sessions`、`user_marks`。
- 用户名为 2–24 位中文、英文、数字或下划线；唯一性按 NFKC 规范化并忽略大小写判断。
- 密码长度 6–128 个字符。Worker 使用 PBKDF2-HMAC-SHA-256 和每用户随机 16 字节 salt。初始值为 100,000 次，保存的哈希带有迭代参数；原密码不会写入 D1。个人状态敏感度较低，但仍建议不要复用其他重要账号的密码。
- `worker/wrangler.toml` 的 `PASSWORD_ITERATIONS` 可在 100,000–600,000 间调整。先用 100,000 部署并实测 Free 档的注册、登录 CPU 时间；确认余量后再按 200,000、400,000、600,000 逐步提升。若 100,000 仍超过 Worker Free 每次请求 10 ms 的 CPU 限额，免费档就无法稳定提供这套密码登录；可以继续用本地记录，或启用 Workers Paid。100,000 更省 CPU，但密码哈希强度低于常见现代推荐值，不要复用重要账号密码，并保留注册/登录限流。
- 迭代次数会写入每个账号自己的密码哈希中。调整配置只影响之后注册的账号；要比较不同迭代值，请每个值都创建一个测试账号，再测试注册和登录，避免旧测试账号仍使用旧参数造成误判。
- 登录签发 32 字节随机不透明 token，有效期 30 天。浏览器将其作为 Bearer token 保存在 localStorage；D1 只存 SHA-256 token hash。此方案适合当前 Pages 与 Worker 跨域部署，但若页面发生 XSS，浏览器存储中的 token 可能被读取，因此 UI 必须继续转义外部/用户数据并避免引入不可信脚本。
- Worker 从已验证 session 推导 user ID，不接受客户端指定的 user ID；SQL 使用 D1 prepared statements。
- CORS 仅允许 `SITE_ORIGIN` 指定的站点来源，并允许 Authorization 与 JSON 请求头。CORS 是浏览器来源限制，不代替 session 权限验证。
- `AUTH_LIMITER` 对注册和登录按来源 IP 做每分钟 10 次的边缘限流。Cloudflare 此限流按边缘位置运行且为最终一致，是基础防护，不是精确的全局计数器。
- 没有邮箱/手机号时，丢失密码无法自动找回。不要用真实重要账号的密码。

## 本人需要做的 Cloudflare 配置

1. 在 Cloudflare 登录/注册并启用 `workers.dev` 子域名。若此前已部署地图 Worker，继续使用同一个 Worker。当前默认 100,000 次 PBKDF2，先尝试 Workers Free；如果注册/登录触发 CPU 限额，再降低迭代数（最低 100,000）或为 Worker 启用 Workers Paid。Paid 最低订阅费用为 $5 USD/月，包含用量额度；Worker 仍是按请求运行，不需要常开服务器。
2. 在 `worker/` 目录创建 D1 数据库：

   ```powershell
   npx.cmd wrangler login
   npx.cmd wrangler d1 create hangzhou-atlas-user-state --location apac
   ```

3. 将命令返回的数据库 ID 替换 `worker/wrangler.toml` 的 `database_id`（当前是占位 UUID）。如果 `AUTH_LIMITER` 的 namespace ID `2026100101` 已被同一 Cloudflare 账号的其他 Worker 使用，请将它改为一个未使用的正整数。
4. 应用 migration 并部署 Worker：

   ```powershell
   npx.cmd wrangler d1 migrations apply hangzhou-atlas-user-state --remote
   npx.cmd wrangler deploy
   ```

   如果现有地图 Worker 尚未配置 `AMAP_SECURITY_JS_CODE`，再运行 `npx.cmd wrangler secret put AMAP_SECURITY_JS_CODE` 并按提示输入；若已经配置，部署时保留现有 secret，不要把值写入文件。
5. 记录 Worker 基础地址，例如 `https://hangzhou-atlas-amap-proxy.<account>.workers.dev`。在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 添加 `USER_API_URL`，值填该基础地址（不要带 `/_AMapService`，不要带末尾斜线）。工作流会将它注入公开的 `runtime-config.js`；它不是 secret。
6. 推送 `main` 或手动运行 GitHub Pages 工作流。检查 Worker 的 `/health` 和网站的注册/登录/同步流程，并在 Cloudflare Workers Metrics 中确认注册、登录请求未触发 CPU 限额。

## 中国大陆访问说明

这个方案不需要额外的 Google、Firebase 或 Supabase 服务。Cloudflare 官方将中国大陆内的网络服务能力作为 Enterprise 客户可购买的 China Network 产品提供；普通 `workers.dev` 和 GitHub Pages 部署不能据此承诺中国大陆各运营商网络都稳定可达。由于现有静态站也在 GitHub Pages，云同步还多一次访问 Worker API 的请求。上线前应在目标用户实际使用的中国大陆网络测试页面、Worker API 的连通性和延迟；若网络不可达，未登录的 localStorage 记录仍然能用，但跨设备云同步会暂不可用。

当前 Worker 的 `SITE_ORIGIN` 是 `https://dingzhenv5.github.io`。若站点域名有变化，需要更新 `worker/wrangler.toml` 并重新部署 Worker。

## 本地联调

先在一个终端启动 Worker 本地运行时（migration 会在本地 D1 实例创建表）：

```powershell
cd worker
npx.cmd wrangler d1 migrations apply hangzhou-atlas-user-state --local
npx.cmd wrangler dev --var SITE_ORIGIN:http://127.0.0.1:4173
```

另开终端从项目根目录运行：

```powershell
node tools/build.mjs
$env:USER_API_URL = 'http://127.0.0.1:8787'
node tools/preview.mjs
```

打开 `http://127.0.0.1:4173/`。关闭本地终端后可用 `$env:USER_API_URL = ''` 清除该终端变量。注意本地预览与线上 GitHub Pages 是不同的 localStorage 来源。
