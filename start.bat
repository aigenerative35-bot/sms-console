@echo off
setlocal
cd /d "%~dp0"
title SMS Console

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js nahi mila.
  echo https://nodejs.org se LTS version install karo, phir ye file dobara chalao.
  echo.
  pause
  exit /b 1
)

echo SMS Console start ho raha hai... browser khud khul jayega.
echo Band karne ke liye is window me Ctrl+C dabao.
echo.
node server.js
pause
