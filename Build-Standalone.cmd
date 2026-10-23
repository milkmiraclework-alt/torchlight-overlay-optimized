@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build-standalone.ps1" %*
exit /b %errorlevel%
