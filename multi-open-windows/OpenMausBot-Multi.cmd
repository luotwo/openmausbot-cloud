@echo off
rem OpenMausBot multi-instance launcher:
rem   no arg  = open saved number of clients (asks on first run via popup)
rem   arg N   = open exactly one instance N directly
setlocal
if "%~1"=="" (
  node "%USERPROFILE%\.openmausbot\multi-instance\open-multi.mjs"
) else (
  set "OMB_INSTANCE_ID=%~1"
  node "%USERPROFILE%\.openmausbot\multi-instance\build-multi.mjs"
)
