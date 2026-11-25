const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Set Application User Model ID for Windows Taskbar & Shortcuts
app.setAppUserModelId('com.railspec.xtractor');

let mainWindow = null;
let serverProcess = null;
const SERVER_PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

// Resolve paths
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const ROOT_DIR = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.ico');
const ICON_PNG = path.join(__dirname, 'assets', 'icon.png');

/**
 * Checks if the local Express/Vite backend is responding
 */
function checkServerReady(port, callback, attempts = 40) {
  const req = http.get(`http://localhost:${port}/api/projects`, (res) => {
    callback(true);
  });
  req.on('error', () => {
    if (attempts > 0) {
      setTimeout(() => checkServerReady(port, callback, attempts - 1), 500);
    } else {
      callback(false);
    }
  });
  req.end();
}

/**
 * Spawns the local backend server process if not already running
 */
function startBackendServer(callback) {
  // First check if a server is already listening on this port (e.g. launched externally in dev)
  checkServerReady(SERVER_PORT, (ready) => {
    if (ready) {
      console.log(`Backend server already running at ${SERVER_URL}`);
      return callback();
    }

    console.log(`Starting backend server on port ${SERVER_PORT}...`);
    const serverScript = path.join(ROOT_DIR, 'dist-server', 'server.mjs');
    const tsxScript = path.join(ROOT_DIR, 'server.ts');

    let cmd = 'node';
    let args = [];
    const env = {
      ...process.env,
      PORT: String(SERVER_PORT),
      NODE_ENV: app.isPackaged ? 'production' : 'development',
    };

    if (app.isPackaged) {
      // In packaged desktop mode, execute using Electron's own bundled Node runtime.
      // This guarantees the backend starts even if the user has NOT installed Node.js!
      cmd = process.execPath;
      args = [serverScript];
      env.ELECTRON_RUN_AS_NODE = '1';
    } else if (fs.existsSync(serverScript)) {
      args = [serverScript];
    } else {
      // In development fallback to tsx
      cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      args = ['tsx', tsxScript];
    }

    serverProcess = spawn(cmd, args, {
      cwd: ROOT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`[Server] ${data.toString().trim()}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server Error] ${data.toString().trim()}`);
    });

    serverProcess.on('close', (code) => {
      console.log(`Backend server process exited with code ${code}`);
    });

    checkServerReady(SERVER_PORT, (isReady) => {
      if (isReady) {
        console.log(`Backend server is ready at ${SERVER_URL}`);
        callback();
      } else {
        console.error('Backend server failed to start within timeout. Proceeding to launch window...');
        callback();
      }
    });
  }, 2);
}

function createWindow() {
  const windowIcon = fs.existsSync(ICON_PATH) ? ICON_PATH : ICON_PNG;

  // Remove default File / Edit / View / Window menu bar completely
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: 'X-tractor - KAVACH Table of Control Studio',
    icon: windowIcon,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
    show: false, // Show once ready-to-show to prevent white flash
  });

  mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links safely in system default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load the web app
  mainWindow.loadURL(SERVER_URL).catch((err) => {
    console.error('Failed to load URL:', err);
    // Fallback error page
    mainWindow.loadURL(`data:text/html;charset=utf-8,
      <html style="background:#0f172a;color:#fff;font-family:sans-serif;padding:40px;text-align:center;">
        <h2 style="color:#ef4444;">Connecting to X-Tractor Backend...</h2>
        <p>The local signalling server is initializing. Please wait a moment.</p>
        <button onclick="location.reload()" style="padding:10px 20px;background:#0284c7;color:#fff;border:none;border-radius:6px;cursor:pointer;">
          Retry Connection
        </button>
      </html>
    `);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// React to second instance launch by bringing existing window to focus
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// App Lifecycle
app.whenReady().then(() => {
  startBackendServer(() => {
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Clean up child server process on app exit
function cleanupAndQuit() {
  if (serverProcess) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t']);
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch {
      // ignore kill errors
    }
    serverProcess = null;
  }
}

app.on('before-quit', cleanupAndQuit);
app.on('window-all-closed', () => {
  cleanupAndQuit();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
