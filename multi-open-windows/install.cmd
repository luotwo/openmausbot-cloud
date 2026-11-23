@echo off
rem OpenMausBot multi-open one-click installer (requires: OpenMausBot installed + Node.js)
where node >nul 2>&1 || (
  echo [install] Node.js not found. Installing via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
)
node "%~dp0install.mjs"
pause
