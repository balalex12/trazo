@echo off
rem Starts Trazo from this folder. Needs Node.js (https://nodejs.org): the window stays open while Trazo runs.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and open this file again.
  pause
  exit /b 1
)
cd /d "%~dp0"
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:3000"
node serve.cjs
pause
