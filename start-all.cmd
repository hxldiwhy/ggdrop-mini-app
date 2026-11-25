@echo off
chcp 65001 >nul
title GGDROP CASINO — всё сразу
cd /d "%~dp0"
echo Запускаю сервер и туннель в отдельных окнах…
start "CASINO SERVER" cmd /k start.cmd
timeout /t 4 >nul
start "CASINO TUNNEL" cmd /k tunnel.cmd
echo Готово. Не закрывай окна, пока играешь.
timeout /t 3 >nul
