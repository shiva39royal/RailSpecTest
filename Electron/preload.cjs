const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, selected Electron APIs to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  version: process.versions.electron,
});
