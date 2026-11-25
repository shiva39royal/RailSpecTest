# X-Tractor: Windows Desktop Electron Setup & Packaging Guide

**Application Name:** X-Tractor  
**Full Title:** Indian Railways RDSO KAVACH Table of Control (TOC) Automated Studio  
**Specification:** RDSO/SPN/196/2020 Version 4.0 (Amendment 6, Effective 07.06.2024)  
**Desktop Shortcut Name:** `X-Tractor`  
**Icon:** Aerodynamic High-Speed Train Icon (`icon.ico` & `icon.png`)  
**Welcome Banner:** Dynamic Animated GIF Banner (`banner.gif`)  

---

## 1. Architecture Overview

X-Tractor runs as a unified, high-performance offline desktop application using a three-tier architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Window                     │
│    (Custom Train Icon, Title "X-Tractor", Landing Banner)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌───────────────────────────────┐   ┌─────────────────────────┐
│     React 19 + Vite Frontend  │   │  Local Express Backend  │
│ (Dynamic TOC, CAD Viewer, UI) │   │ (port 3000 / auto-port) │
└───────────────────────────────┘   └─────────────┬───────────┘
                                                  │
                                                  ▼
                                    ┌─────────────────────────┐
                                    │ Native Python OCR & CAD │
                                    │ (PyMuPDF, OCR, ezdxf)   │
                                    └─────────────────────────┘
```

1. **Electron Shell (`Electron/main.cjs`):**
   - Enforces a single instance lock.
   - Sets Windows `AppUserModelId` to `com.railspec.xtractor` so the taskbar and shortcuts display the train icon properly.
   - Automatically starts the local backend server process and monitors readiness.
   - Displays the desktop window maximized with the custom Train Icon.
2. **Landing Banner & Splash View (`src/components/LandingPageModal.tsx`):**
   - Opens automatically on startup with the animated `banner.gif`.
   - Features dynamic status checks for the Express backend, Python PyMuPDF engine, and OCR.
   - Provides quick start shortcuts (Open Layout, Load Sample Chitgidda Station, View Table 1 Control).
3. **Engineering Extraction Engine (`server/cadComponentExtractor.ts` & `server/pdfOcrWorker.py`):**
   - Vector dot product route point analysis ($D = \vec{L} \cdot \vec{T}$) for Normal & Reverse points.
   - Dynamic route corridor & berthing track circuit detection for *Requires Track Circuit "UP" in Route*.
   - RFID tag-to-line identification for *TINs Requires Free (Route & Overlap)*.

---

## 2. Directory Structure of `Electron/`

```text
railspectest/
├── Electron/
│   ├── assets/
│   │   ├── banner.gif          <-- Animated railway signalling banner (800x450)
│   │   ├── icon.ico            <-- Windows multi-size train icon (16, 32, 48, 64, 128, 256)
│   │   └── icon.png            <-- High-res 512x512 train icon
│   ├── scripts/
│   │   ├── install_prerequisites.bat  <-- 1-click batch installer for Python & OCR libraries
│   │   ├── install_prerequisites.ps1  <-- PowerShell version of prerequisites installer
│   │   ├── build_installer.bat        <-- 1-click build script to create Windows Setup .exe
│   │   └── start_desktop.bat          <-- 1-click launcher for desktop test mode
│   ├── electron-builder.json   <-- Packaging configuration (NSIS installer settings)
│   ├── main.cjs                <-- Electron main process & server supervisor
│   ├── preload.cjs             <-- Secure context bridge
│   └── README.md               <-- This documentation file
```

---

## 3. Prerequisites & Requirements Installation

Before building the Windows installer or running the app for the first time on a new workstation, install the required dependencies:

### Automated 1-Click Installation (Recommended)
Simply double-click:
```
Electron\scripts\install_prerequisites.bat
```
*(Or in PowerShell: `.\Electron\scripts\install_prerequisites.ps1`)*

This script automatically:
1. Verifies that **Node.js** (v18+) is available.
2. Locates your **Python 3.10+** interpreter.
3. Automatically installs and upgrades all necessary libraries via pip:
   ```bash
   pip install pymupdf pytesseract pillow ezdxf pypdf
   ```
4. Verifies presence of **Tesseract-OCR** (`C:\Program Files\Tesseract-OCR\tesseract.exe`).
5. Executes a live test import to guarantee 100% functionality before launch.

---

## 4. How to Generate the Windows Setup File (`.exe`)

You have two convenient ways to build the Windows Setup installer:

### Option A: Using the 1-Click Batch Script
Double-click:
```
Electron\scripts\build_installer.bat
```

### Option B: From the Terminal
Run:
```bash
npm run electron:build
```

### What the Build Pipeline Does:
1. **Compiles Vite Frontend:** Bundles the React application into production assets (`dist/`).
2. **Bundles Backend Server:** Uses `esbuild` to compile `server.ts` into a fast, standalone bundle (`dist-server/server.mjs`).
3. **Verifies Assets:** Checks `Electron/assets/icon.ico` and `Electron/assets/banner.gif`.
4. **Packages NSIS Installer:** Runs `electron-builder` to assemble the final installer file:
   ```
   dist-installer\X-Tractor-Setup-1.0.0.exe
   ```

---

## 5. Installing the Application on Windows

1. Run the generated setup file: `dist-installer\X-Tractor-Setup-1.0.0.exe`.
2. Follow the NSIS setup wizard:
   - Choose the destination directory (default: `C:\Users\<User>\AppData\Local\Programs\X-Tractor`).
   - The installer automatically creates:
     - **Desktop Shortcut:** Named `X-Tractor` with the **Train Icon**.
     - **Start Menu Shortcut:** Under `X-Tractor` with the **Train Icon**.
3. Launch `X-Tractor`:
   - The welcome modal opens immediately displaying the **animated signalling banner**.
   - Review system health and click **Enter Studio** to begin.

---

## 6. How to Update & Rebuild After Future Enhancements

Whenever you add new features, update KAVACH calculation rules, or modify UI components:

1. **Make your code edits** in `src/` or `server/`.
2. **Verify TypeScript integrity**:
   ```bash
   npm run lint
   ```
3. **(Optional) Increment version** in `package.json`:
   ```json
   "version": "1.1.0"
   ```
4. **Rebuild the installer**:
   ```bash
   npm run electron:build
   ```
   Or double-click `Electron\scripts\build_installer.bat`.
5. The new installer `X-Tractor-Setup-1.1.0.exe` is generated in `dist-installer/` ready for distribution.

---

## 7. NSIS Installer Configuration Reference

Inside `Electron/electron-builder.json`:
- `"productName": "X-Tractor"`: The display name across Windows.
- `"shortcutName": "X-Tractor"`: Name given to the desktop & start menu shortcuts.
- `"icon": "Electron/assets/icon.ico"`: Source icon for executable, uninstaller, and shortcuts.
- `"oneClick": false`: Enables the friendly standard wizard allowing the user to choose installation directory.
- `"allowElevation": true`: Allows elevated privileges if required by admin policies.
- `"runAfterFinish": true`: Automatically launches X-Tractor upon installation completion.
