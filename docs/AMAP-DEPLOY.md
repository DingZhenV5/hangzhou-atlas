# 高德地图接入 GitHub Pages

网站静态文件由 GitHub Pages 托管，高德 JS API 安全密钥由 Cloudflare Worker 代理保管。Worker 源码在 `worker/`；不要把安全密钥写入仓库或网页。

## 需要配置的值

| 名称 | 存放位置 | 说明 |
| --- | --- | --- |
| Web 端 JS API Key | GitHub 仓库变量 `AMAP_JS_KEY` | 会进入网页请求，属于公开值；在高德控制台限制平台和域名 |
| Worker 代理 URL | GitHub 仓库变量 `AMAP_PROXY_URL` | 公开地址，格式为 `https://<worker>.<account>.workers.dev/_AMapService` |
| JS API 安全密钥 | Cloudflare Worker Secret `AMAP_SECURITY_JS_CODE` | 只在 Worker 服务端读取，不进入 Pages 产物 |

## 部署 Worker

1. 注册或登录 Cloudflare，在 Workers & Pages 中启用账户的 `workers.dev` 子域名。
2. 在项目根目录打开终端，运行：

   ```powershell
   cd worker
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put AMAP_SECURITY_JS_CODE
   ```

   `secret put` 会提示输入安全密钥；直接在终端提示符里粘贴，不要把值写进命令、聊天或仓库。命令会返回 Worker 地址。
3. 打开 `https://<worker>.<account>.workers.dev/health`，确认返回 `{"ok":true,...}`。

## 配置 GitHub Pages

1. 在 GitHub 仓库打开 **Settings → Secrets and variables → Actions → Variables**。
2. 添加仓库变量 `AMAP_JS_KEY`，值为高德 Web 端 JS API Key。
3. 添加仓库变量 `AMAP_PROXY_URL`，值为 Worker 地址并在末尾加 `/_AMapService`。
4. 在高德控制台将此 JS API Key 的服务平台设为 Web 端（JS API），域名白名单加入 Pages 域名 `dingzhenv5.github.io`。
5. 推送 `main` 或在 **Actions → Deploy Hangzhou Atlas → Run workflow** 手动运行部署。

工作流只把 JS API Key 与代理 URL 写入静态站点；它不会读取或发布 `AMAP_SECURITY_JS_CODE`。不要将安全密钥添加到 GitHub Pages 变量，也不要把安全密钥注入 `runtime-config.js`。

当前 Worker 只接受配置的 Pages 来源，并只代理地图样式与 JS API 日志路径。若以后更换 Pages 域名，需要同步更新 `worker/wrangler.toml` 的 `SITE_ORIGIN`，然后重新部署 Worker。

## 本地预览

本机预览继续使用项目根目录 `AmapAPI/` 下的凭据和 `tools/preview.mjs`，不需要访问线上 Worker。不要提交 `AmapAPI/`。
