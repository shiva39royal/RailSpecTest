@echo off
echo Starting X-Tractor in Desktop Window Mode...
cd /d "%~dp0\..\.."
npx electron Electron/main.cjs
