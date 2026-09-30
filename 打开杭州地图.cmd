@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE (
  echo Node.js was not found. Please install Node.js 20 or newer, then try again.
  pause
  exit /b 1
)

"%NODE_EXE%" tools\build.mjs
if errorlevel 1 (
  echo Build failed. Please send the error shown above for help.
  pause
  exit /b 1
)

rem If the preview is already running, just open it.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4173/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
  start "" "http://127.0.0.1:4173/"
  echo An existing preview was opened in your browser.
  exit /b 0
)

echo Starting the Hangzhou map. Keep this window open while using the site.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "$url = 'http://127.0.0.1:4173/'; for ($i = 0; $i -lt 40; $i++) { try { $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { Start-Process $url; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }"
"%NODE_EXE%" tools\preview.mjs
if errorlevel 1 (
  echo Preview server stopped with an error. Please send the error shown above for help.
  pause
)
