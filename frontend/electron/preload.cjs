const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, protected APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  getSerialPorts: () => ipcRenderer.invoke('get-serial-ports'),
  connectSerial: (path, baudRate) => ipcRenderer.invoke('connect-serial', path, baudRate),
  disconnectSerial: () => ipcRenderer.invoke('disconnect-serial'),
  onSerialData: (callback) => ipcRenderer.on('serial-data', (event, data) => callback(data)),
  onSerialDisconnected: (callback) => ipcRenderer.on('serial-disconnected', callback)
});
