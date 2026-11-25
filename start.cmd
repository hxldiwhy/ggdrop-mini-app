@echo off
chcp 65001 >nul
title GGDROP CASINO — сервер
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден. Установи LTS с https://nodejs.org и запусти снова.
  pause
  exit /b 1
)

netstat -ano | findstr /R /C:":8080 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo [i] Порт 8080 уже занят — похоже, казино уже запущено.
  echo     Открой http://127.0.0.1:8080/app
  echo     Если это другой процесс — закрой его или поменяй PORT в .env.
  echo.
  pause
  exit /b 0
)

if not exist .env (
  if exist .env.example (
    copy /y .env.example .env >nul
    echo [i] Создан .env из шаблона.
  )
)

echo.
echo  ██████╗  ██████╗ ██████╗ ██████╗  ██████╗ ██████╗
echo  ██╔══██╗██╔════╝ ██╔══██╗██╔══██╗██╔═══██╗██╔══██╗
echo  ██║  ██║██║  ███╗██║  ██║██████╔╝██║   ██║██████╔╝
echo  ██║  ██║██║   ██║██║  ██║██╔══██╗██║   ██║██╔═══╝
echo  ██████╔╝╚██████╔╝██████╔╝██║  ██║╚██████╔╝██║
echo  ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝   CASINO
echo.
echo  Локально:  http://127.0.0.1:8080/app
echo  Для мини-приложения в Wiftgram запусти в отдельном окне: tunnel.cmd
echo.

node src/server.js

echo.
echo Сервер остановлен.
pause
