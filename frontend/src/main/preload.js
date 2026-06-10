'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('mduDebug', {
  getInitialState: () => ipcRenderer.invoke('app:get-initial-state'),
  listPorts: () => ipcRenderer.invoke('serial:list-ports'),
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  connect: (options) => ipcRenderer.invoke('serial:connect', options),
  setPreferredPort: (path) => ipcRenderer.invoke('serial:set-preferred-port', path),
  disconnect: () => ipcRenderer.invoke('serial:disconnect'),
  setAutoConnect: (enabled) => ipcRenderer.invoke('serial:set-auto-connect', enabled),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  pickLogFile: () => ipcRenderer.invoke('log:pick-file'),
  startLogging: (filePath) => ipcRenderer.invoke('log:start', filePath),
  stopLogging: () => ipcRenderer.invoke('log:stop'),
  logWiFiFrame: (entry) => ipcRenderer.invoke('log:write-entry', entry),
  openLogFile: () => ipcRenderer.invoke('log:open-file'),
  exportFilteredLog: (rows) => ipcRenderer.invoke('log:export-filtered-log', rows),
  selectDataFolder: () => ipcRenderer.invoke('dialog:select-data-folder'),
  openFile: () => ipcRenderer.invoke('dialog:open-file'),
  scanFolder: (folderPath) => ipcRenderer.invoke('folder:scan', folderPath),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('file:write', filePath, content),
  parseTelemetryFile: (filePath) => ipcRenderer.invoke('file:parse-telemetry', filePath),
  parseCanLogPython: (filePath) => ipcRenderer.invoke('file:parse-can-log-python', filePath),
  onParseProgress: (callback) => subscribe('parse-progress', callback),
  parseWifiFrame: (id, dataHex) => ipcRenderer.invoke('wifi:parse-frame', { id, dataHex }),
  parseWifiFrames: (frames) => ipcRenderer.invoke('wifi:parse-frames', frames),
  onPorts: (callback) => subscribe('device:ports', callback),
  onConnection: (callback) => subscribe('device:connection', callback),
  onDiagnostics: (callback) => subscribe('device:diagnostics', callback),
  onFrame: (callback) => subscribe('device:frame', callback),
  onFrames: (callback) => subscribe('device:frames', callback),
  onWifiSnapshot: (callback) => subscribe('device:wifi_snapshot', callback),
  onRuntime: (callback) => subscribe('device:runtime', callback),
  onLogStatus: (callback) => subscribe('device:log-status', callback),
  getBfrConfig: () => ipcRenderer.invoke('bfr:get-config'),
  runSetupScript: () => ipcRenderer.invoke('bfr:run-setup'),
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory'),
  registerBoard: (boardKey, elf, name, aliases, boardIdVar, dirPath) => 
    ipcRenderer.invoke('bfr:register-board', boardKey, elf, name, aliases, boardIdVar, dirPath),
  deployBoard: (action, boardKey, boardId) => ipcRenderer.invoke('board:deploy', action, boardKey, boardId),
  stopDeploy: () => ipcRenderer.invoke('board:deploy-kill'),
  onDeployLog: (callback) => subscribe('board:deploy-log', callback),
});
