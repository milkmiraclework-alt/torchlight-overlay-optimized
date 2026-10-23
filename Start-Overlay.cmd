@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-overlay.ps1" %*
