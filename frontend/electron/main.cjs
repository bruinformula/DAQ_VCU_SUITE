const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const net = require('net');
const fs = require('fs/promises');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// Determine if we are running in dev mode or production
const isDev = !app.isPackaged;
const NETWORK_SCAN_PORT = 8000;
const NETWORK_SCAN_TIMEOUT_MS = 250;
const NETWORK_SCAN_CONCURRENCY = 32;
const COMMON_PI_HOSTS = ['10.42.0.1', '192.168.4.1', '192.168.137.1'];

let mainWindow = null;
let activeSerialPort = null;

function isIpv4Family(family) {
  return family === 'IPv4' || family === 4;
}

function buildHostOrder(localOctet) {
  const seen = new Set();
  const ordered = [];
  const preferred = [1, localOctet - 1, localOctet + 1, 100];

  for (const octet of preferred) {
    if (octet >= 1 && octet <= 254 && !seen.has(octet)) {
      seen.add(octet);
      ordered.push(octet);
    }
  }

  for (let octet = 1; octet <= 254; octet++) {
    if (!seen.has(octet)) {
      seen.add(octet);
      ordered.push(octet);
    }
  }

  return ordered;
}

function getScanTargets() {
  const interfaces = os.networkInterfaces();
  const seenPrefixes = new Set();
  const targets = [];

  for (const ifaceList of Object.values(interfaces)) {
    for (const iface of ifaceList || []) {
      if (!isIpv4Family(iface.family) || iface.internal) {
        continue;
      }

      const parts = iface.address.split('.');
      if (parts.length !== 4) {
        continue;
      }

      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}.`;
      if (seenPrefixes.has(prefix)) {
        continue;
      }

      seenPrefixes.add(prefix);
      targets.push({
        prefix,
        localOctet: Number(parts[3]),
      });
    }
  }

  return targets;
}

function probePort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (connected) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(connected);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

async function verifyTelemetryHub(ip) {
  const portOpen = await probePort(ip, NETWORK_SCAN_PORT, NETWORK_SCAN_TIMEOUT_MS);
  if (!portOpen) {
    return false;
  }

  if (typeof fetch !== 'function') {
    return true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NETWORK_SCAN_TIMEOUT_MS);

  try {
    const response = await fetch(`http://${ip}:${NETWORK_SCAN_PORT}/api/status`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }

    const status = await response.json();
    return Boolean(
      status &&
      typeof status === 'object' &&
      'is_logging' in status &&
      'frames_parsed' in status
    );
  } catch (err) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function scanSubnet(prefix, localOctet) {
  const queue = buildHostOrder(localOctet).map((octet) => `${prefix}${octet}`);
  let cursor = 0;
  let foundIp = null;

  const worker = async () => {
    while (!foundIp && cursor < queue.length) {
      const targetIp = queue[cursor++];
      if (await verifyTelemetryHub(targetIp)) {
        foundIp = targetIp;
        return;
      }
    }
  };

  const workerCount = Math.min(NETWORK_SCAN_CONCURRENCY, queue.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return foundIp;
}

// --- SERIAL BACKUP BRIDGE ---
ipcMain.handle('get-serial-ports', async () => {
  try {
    const ports = await SerialPort.list();
    return ports;
  } catch (err) {
    console.error("Error listing serial ports:", err);
    return [];
  }
});

ipcMain.handle('connect-serial', async (event, portPath, baudRate) => {
  return new Promise((resolve, reject) => {
    if (activeSerialPort) {
      activeSerialPort.close();
    }

    activeSerialPort = new SerialPort({ path: portPath, baudRate: parseInt(baudRate, 10) }, (err) => {
      if (err) {
        console.error("Serial connection error:", err);
        resolve({ success: false, error: err.message });
        return;
      }

      const parser = activeSerialPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      
      parser.on('data', (data) => {
        if (mainWindow) {
          mainWindow.webContents.send('serial-data', data);
        }
      });

      resolve({ success: true });
    });

    activeSerialPort.on('close', () => {
      if (mainWindow) {
        mainWindow.webContents.send('serial-disconnected');
      }
      activeSerialPort = null;
    });
  });
});

ipcMain.handle('disconnect-serial', async () => {
  if (activeSerialPort) {
    activeSerialPort.close();
    activeSerialPort = null;
  }
  return true;
});

ipcMain.handle('open-log-file', async () => {
  if (!mainWindow) {
    return { canceled: true };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Telemetry Log',
    properties: ['openFile'],
    filters: [
      { name: 'Telemetry Logs', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePaths?.length) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, 'utf8');
  return {
    canceled: false,
    filePath,
    filename: path.basename(filePath),
    content,
  };
});

// --- NETWORK AUTO-SCANNER ---
ipcMain.handle('scan-network', async () => {
  for (const ip of COMMON_PI_HOSTS) {
    if (await verifyTelemetryHub(ip)) {
      return ip;
    }
  }

  const scanTargets = getScanTargets();
  for (const target of scanTargets) {
    const foundIp = await scanSubnet(target.prefix, target.localOctet);
    if (foundIp) {
      return foundIp;
    }
  }

  return null;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Bruin Formula Racing Telemetry Hub",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow = win;

  // Remove the default menu bar for a cleaner "app" look
  win.setMenuBarVisibility(false);

  if (isDev) {
    // In development, load the Vite dev server
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, load the built React app from the dist folder
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
