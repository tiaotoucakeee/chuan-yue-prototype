@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 穿·越 H5 原型

echo.
echo  正在启动本地服务（Unity 博物馆必须这样打开）...
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  [错误] 未检测到 Node.js，请先安装：https://nodejs.org
  pause
  exit /b 1
)

REM 已在运行则直接打开浏览器
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:3456/' -UseBasicParsing -TimeoutSec 2).StatusCode | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo  服务已在运行，正在打开浏览器...
  start "" "http://localhost:3456"
  exit /b 0
)

echo  首次启动需要几秒，请勿关闭弹出的黑色窗口。
start "穿·越-本地服务" cmd /k "npx --yes serve . -p 3456"
start "穿·越-Kimi代理" cmd /k "for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8787 ^| findstr LISTENING') do taskkill /F /PID %%a 2>nul & cd /d "%~dp0kimi-proxy" && npm install --silent && npm start"

:wait
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:3456/' -UseBasicParsing -TimeoutSec 2).StatusCode | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 goto wait

:waitkimi
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://localhost:8787/health' -UseBasicParsing -TimeoutSec 2).StatusCode | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 goto waitkimi

start "" "http://localhost:3456"
echo.
echo  已在浏览器打开 http://localhost:3456
echo  关闭黑色「本地服务」窗口即可停止。
echo.
timeout /t 3 >nul
