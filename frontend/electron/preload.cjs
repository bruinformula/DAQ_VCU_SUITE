const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, protected APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Add safe IPC calls here as needed
  // For example: getAppVersion: () => ipcRenderer.invoke('get-app-version')
});
