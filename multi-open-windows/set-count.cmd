@echo off
rem OpenMausBot multi-instance: re-ask client count
del "%USERPROFILE%\.openmausbot\multi-instance\count.txt" >nul 2>&1
node "%USERPROFILE%\.openmausbot\multi-instance\open-multi.mjs"
