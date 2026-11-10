@echo off
rem Starts the monitor in this window and opens the dashboard. Close the window to stop it.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found on this computer.
  echo Install it from https://nodejs.org and then run this file again.
  echo.
  pause
  exit /b 1
)
node server.js
if errorlevel 1 pause
