@echo off
chcp 65001 >nul
title GGDROP CASINO — туннель
cd /d "%~dp0"
set PORT_ARG=8080
if not "%~1"=="" set PORT_ARG=%~1
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\tunnel.ps1" -Port %PORT_ARG%
pause
