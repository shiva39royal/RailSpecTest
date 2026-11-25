@echo off
setlocal enabledelayedexpansion

echo ===============================================================================
echo     X - T R A C T O R  :  PREREQUISITES AND LIBRARIES INSTALLER
echo     Indian Railways RDSO KAVACH Table of Control Automated Studio
echo ===============================================================================
echo.

:: 1. Check Node.js
echo [1/4] Checking Node.js environment...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js detected: %NODE_VER%
echo.

:: 2. Check Python
echo [2/4] Checking Python environment...
set PYTHON_CMD=
where python >nul 2>nul
if %errorlevel% equ 0 (
    set PYTHON_CMD=python
) else (
    if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
        set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" (
        set PYTHON_CMD="%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
    )
)

if "%PYTHON_CMD%"=="" (
    echo [ERROR] Python 3.10+ was not found!
    echo Please install Python 3.10, 3.11, or 3.12 from https://www.python.org/
    echo Ensure you check 'Add Python to PATH' during installation.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('%PYTHON_CMD% --version') do set PY_VER=%%v
echo [OK] Python detected: %PY_VER%
echo.

:: 3. Install Python Dependencies
echo [3/4] Installing / Verifying required Python signalling & OCR libraries...
echo Running: %PYTHON_CMD% -m pip install --upgrade pip
%PYTHON_CMD% -m pip install --upgrade pip --quiet

echo Running: %PYTHON_CMD% -m pip install pymupdf pytesseract pillow ezdxf pypdf
%PYTHON_CMD% -m pip install pymupdf pytesseract pillow ezdxf pypdf

if %errorlevel% neq 0 (
    echo [WARNING] Some pip packages reported warnings or errors.
) else (
    echo [OK] PyMuPDF, pytesseract, Pillow, ezdxf installed successfully.
)
echo.

:: 4. Check Tesseract-OCR
echo [4/4] Checking Tesseract OCR binary...
set TESS_PATH="C:\Program Files\Tesseract-OCR\tesseract.exe"
where tesseract >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Tesseract OCR binary found in system PATH.
) else if exist %TESS_PATH% (
    echo [OK] Tesseract OCR binary found at: %TESS_PATH%
) else (
    echo [NOTICE] Tesseract-OCR binary was not found at standard location (%TESS_PATH%).
    echo PyMuPDF will handle 100%% of digital CAD/PDF vector layouts without Tesseract.
    echo To also enable scanned bitmap OCR, download and install Tesseract from:
    echo https://github.com/UB-Mannheim/tesseract/wiki
)
echo.

:: 5. Verification Test
echo Verifying Python library integration...
%PYTHON_CMD% -c "import pymupdf, pytesseract, PIL, ezdxf; print('--> ALL PYTHON MODULES LOADED SUCCESSFULLY!')"
if %errorlevel% neq 0 (
    echo [ERROR] Module verification failed. Please check Python installation.
    pause
    exit /b 1
)

echo.
echo ===============================================================================
echo     SUCCESS: All prerequisites and libraries are verified for X-Tractor!
echo ===============================================================================
echo.
pause
