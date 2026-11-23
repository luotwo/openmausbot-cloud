@echo off
rem apimart-shim launcher: proxy env only here, not global (global HTTPS_PROXY slows the GLM-backed claude CLI)
rem 代理只在本进程内生效（全局设 HTTPS_PROXY 会拖慢走国内 API 的 claude CLI，切记）
set NODE_USE_ENV_PROXY=1
set HTTPS_PROXY=http://127.0.0.1:7897
set HTTP_PROXY=http://127.0.0.1:7897
set NO_PROXY=127.0.0.1,localhost,::1
node "%USERPROFILE%\.openmausbot\apimart-shim\server.mjs"
