$url = 'http://127.0.0.1:4173'
for ($i = 0; $i -lt 60; $i++) {
  try {
    $runtime = Invoke-WebRequest -Uri "$url/runtime-config.js" -TimeoutSec 1 -UseBasicParsing
    if ($runtime.StatusCode -eq 200 -and $runtime.Content -match '127\.0\.0\.1:8787') { Start-Process $url; exit 0 }
  } catch {}
  Start-Sleep -Milliseconds 500
}