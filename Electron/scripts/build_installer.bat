@echo off
setlocal enabledelayedexpansion

echo ===============================================================================
echo     X - T R A C T O R  :  WINDOWS SETUP FILE (INSTALLER) BUILDER
echo     Indian Railways RDSO KAVACH Table of Control Automated Studio
echo ===============================================================================
echo.

cd /d "%~dp0\..\.."

echo [Step 1/4] Building Vite Frontend Application...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed!
    pause
    exit /b 1
)
echo [OK] Frontend built into dist/
echo.

echo [Step 2/4] Bundling Standalone Backend Server...
call npx esbuild server.ts --bundle --platform=node --format=esm --target=node18 --outfile=dist-server/server.mjs --external:vite --external:fsevents --external:esbuild --external:libredwg-web
if %errorlevel% neq 0 (
    echo [ERROR] Backend bundling failed!
    pause
    exit /b 1
)
echo [OK] Backend server bundled into dist-server/server.mjs
echo.

echo [Step 3/4] Verifying Train Icon and Animated Banner...
if not exist "Electron\assets\icon.ico" (
    echo [ERROR] Electron\assets\icon.ico is missing!
    pause
    exit /b 1
)
if not exist "Electron\assets\banner.gif" (
    echo [ERROR] Electron\assets\banner.gif is missing!
    pause
    exit /b 1
)
echo [OK] Train Icon and Banner verified.
echo.

echo [Step 4/4] Generating Windows NSIS Installer (.exe)...
echo Running electron-builder...
call npx electron-builder --config Electron/electron-builder.json
if %errorlevel% neq 0 (
    echo [ERROR] electron-builder encountered an error!
    pause
    exit /b 1
)

echo.
echo ===============================================================================
echo     SUCCESS: Windows Setup File Created Successfully!
echo     Shortcut Name: X-Tractor
echo     Icon: Train Icon (icon.ico)
echo     Output Directory: dist-installer/
echo ===============================================================================
echo.
pause
