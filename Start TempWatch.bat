@echo off
rem Starts the monitor in this window and opens the dashboard. Close the window to stop it.
cd /d "%~dp0"
node server.js --open
if errorlevel 1 pause
