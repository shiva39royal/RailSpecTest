# X-Tractor Prerequisites and Requirements Installer (PowerShell)
# Indian Railways RDSO KAVACH Table of Control Automated Studio

Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "    X - T R A C T O R  :  PREREQUISITES AND LIBRARIES INSTALLER" -ForegroundColor Yellow
Write-Host "    Indian Railways RDSO KAVACH Table of Control Automated Studio" -ForegroundColor Cyan
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Node.js Check
Write-Host "[1/4] Checking Node.js environment..." -ForegroundColor White
try {
    $nodeVer = & node -v
    Write-Host "  [OK] Node.js detected: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Node.js is not found in PATH! Please install Node.js 18+ from https://nodejs.org/" -ForegroundColor Red
    pause
    exit 1
}

# 2. Python Check
Write-Host "`n[2/4] Checking Python environment..." -ForegroundColor White
$pythonCmd = $null
if (Get-Command "python" -ErrorAction SilentlyContinue) {
    $pythonCmd = "python"
} elseif (Test-Path "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe") {
    $pythonCmd = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
} elseif (Test-Path "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe") {
    $pythonCmd = "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
} elseif (Test-Path "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe") {
    $pythonCmd = "$env:LOCALAPPDATA\Programs\Python\Python310\python.exe"
}

if (-not $pythonCmd) {
    Write-Host "  [ERROR] Python 3.10+ was not found! Please install Python 3.10+ and enable 'Add to PATH'." -ForegroundColor Red
    pause
    exit 1
}

$pyVer = & $pythonCmd --version
Write-Host "  [OK] Python detected: $pyVer" -ForegroundColor Green

# 3. Pip Packages
Write-Host "`n[3/4] Installing / Verifying required Python signalling & OCR libraries..." -ForegroundColor White
& $pythonCmd -m pip install --upgrade pip --quiet
& $pythonCmd -m pip install pymupdf pytesseract pillow ezdxf pypdf

# 4. Tesseract OCR
Write-Host "`n[4/4] Checking Tesseract OCR binary..." -ForegroundColor White
$tessPath = "C:\Program Files\Tesseract-OCR\tesseract.exe"
if (Get-Command "tesseract" -ErrorAction SilentlyContinue) {
    Write-Host "  [OK] Tesseract OCR binary found in system PATH." -ForegroundColor Green
} elseif (Test-Path $tessPath) {
    Write-Host "  [OK] Tesseract OCR binary found at: $tessPath" -ForegroundColor Green
} else {
    Write-Host "  [NOTICE] Tesseract-OCR binary not found at $tessPath." -ForegroundColor Yellow
    Write-Host "  PyMuPDF handles 100% of digital vector CAD/PDF layouts natively." -ForegroundColor Gray
    Write-Host "  For scanned bitmaps, install Tesseract from: https://github.com/UB-Mannheim/tesseract/wiki" -ForegroundColor Gray
}

# 5. Verification
Write-Host "`nVerifying Python library integration..." -ForegroundColor White
& $pythonCmd -c "import pymupdf, pytesseract, PIL, ezdxf; print('--> ALL PYTHON MODULES LOADED SUCCESSFULLY!')"
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n===============================================================================" -ForegroundColor Green
    Write-Host "    SUCCESS: All prerequisites and libraries are verified for X-Tractor!" -ForegroundColor Green
    Write-Host "===============================================================================" -ForegroundColor Green
} else {
    Write-Host "`n[ERROR] Python module verification encountered an issue." -ForegroundColor Red
}

Write-Host ""
pause
