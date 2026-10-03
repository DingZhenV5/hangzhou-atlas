@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-local-stack.ps1"
if errorlevel 1 (
  echo.
  echo Local startup failed. Please read the message above.
  pause
)