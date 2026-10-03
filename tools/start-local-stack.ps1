param([switch]$Worker)
$ErrorActionPreference = 'Stop'
$proxy = "http://127.0.0.1:7897"
$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:NODE_USE_ENV_PROXY = "1"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$workerDir = Join-Path $root 'worker'
$workerUrl = 'http://127.0.0.1:8787'
$siteUrl = 'http://127.0.0.1:4173'
function Test-LocalWorker {
  try { $health = Invoke-RestMethod -Uri "$workerUrl/health" -TimeoutSec 2; return $health.ok -eq $true -and $health.service -eq 'hangzhou-atlas-amap-proxy' } catch { return $false }
}
$npmCache = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
$wranglerFile = Get-ChildItem -Path $npmCache -Filter wrangler.js -File -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if ($Worker) {
  Set-Location -LiteralPath $workerDir
  if ($wranglerFile) {
    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    & $nodeCommand.Source $wranglerFile d1 migrations apply hangzhou-atlas-user-state --local
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $nodeCommand.Source $wranglerFile dev --ip 127.0.0.1 --port 8787 --var 'SITE_ORIGIN:http://127.0.0.1:4173'
  } else {
    $npx = (Get-Command npx.cmd -ErrorAction Stop).Source
    $env:CI = '1'
    & $npx --yes wrangler d1 migrations apply hangzhou-atlas-user-state --local
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $npx --yes wrangler dev --ip 127.0.0.1 --port 8787 --var 'SITE_ORIGIN:http://127.0.0.1:4173'
  }
  exit $LASTEXITCODE
}
Set-Location -LiteralPath $root
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$node = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $node) { $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'; if (Test-Path -LiteralPath $bundledNode) { $node = $bundledNode } }
if (-not $node) { throw '没有找到 Node.js。请安装 Node.js 20 或更新版本后重试。' }
if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) { throw '没有找到 npx.cmd。请重新安装 Node.js（需包含 npm/npx）后重试。' }
$siteAlreadyReady = $false
try { $currentRuntime = Invoke-WebRequest -Uri "$siteUrl/runtime-config.js" -TimeoutSec 2 -UseBasicParsing; $siteAlreadyReady = $currentRuntime.StatusCode -eq 200 -and $currentRuntime.Content -match 'http://127\.0\.0\.1:8787' } catch {}
if (-not $siteAlreadyReady) {
Write-Host '正在构建地图文件…'
& $node (Join-Path $root 'tools\build.mjs')
if ($LASTEXITCODE -ne 0) { throw '地图构建失败；请查看上面的报错。' }
}
if (-not (Test-LocalWorker)) {
  $logDir = Join-Path $root 'private\local-only\logs'
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $stdout = Join-Path $logDir 'local-worker.stdout.log'
  $stderr = Join-Path $logDir 'local-worker.stderr.log'
  Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
  $workerArgs = @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'),'-Worker')
  $workerProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $workerArgs -WorkingDirectory $root -WindowStyle Minimized -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Write-Host '正在启动本地数据库与 API（首次启动可能需要下载 Wrangler）…'
  $ready = $false
  for ($i = 0; $i -lt 150; $i++) { if (Test-LocalWorker) { $ready = $true; break }; if ($workerProcess.HasExited) { break }; Start-Sleep -Seconds 1 }
  if (-not $ready) {
    $details = ''; if (Test-Path -LiteralPath $stderr) { $details = Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue }
    if ($details) { Write-Host $details }
    throw "本地 Worker 没有成功启动。查看日志：$stdout 和 $stderr。首次启动需要网络下载 Wrangler。"
  }
}
try {
  $runtime = Invoke-WebRequest -Uri "$siteUrl/runtime-config.js" -TimeoutSec 2 -UseBasicParsing
  if ($runtime.StatusCode -ne 200 -or $runtime.Content -notmatch 'http://127\.0\.0\.1:8787') { throw '4173 端口已有未连接本地数据库的地图预览。请关闭旧地图启动窗口，再双击本启动器。' }
  Start-Process $siteUrl
  Write-Host "地图已打开：$siteUrl"
  Write-Host '本地 API / D1 已连接。Worker 在最小化窗口中运行。'
  Write-Host "本地 D1 文件保存在：$(Join-Path $workerDir '.wrangler\state\v3\d1')"
  exit 0
} catch [System.Net.WebException] {
  if ($_.Exception.Response) { throw '4173 端口已有服务但不是地图预览；请先关闭占用该端口的程序，再重试。' }
} catch { throw }
$env:USER_API_URL = $workerUrl
$env:PORT = '4173'
Write-Host "本地 API 已就绪：$workerUrl/health"
Write-Host "正在启动地图预览：$siteUrl"
Write-Host '保持这个窗口打开；按 Ctrl+C 可停止地图预览。'
$openerPath = Join-Path $root 'tools\open-local-preview.ps1'
$quotedOpener = [char]34 + $openerPath + [char]34
$openArgs = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File $quotedOpener"
Start-Process -FilePath 'powershell.exe' -ArgumentList $openArgs -WindowStyle Hidden
& $node (Join-Path $root 'tools\preview.mjs')
if ($LASTEXITCODE -ne 0) { throw '地图预览服务器停止并返回错误。' }
