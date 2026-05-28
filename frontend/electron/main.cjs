const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const net = require('net');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// Determine if we are running in dev mode or production
const isDev = !app.isPackaged;

let mainWindow = null;
let activeSerialPort = null;

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

// --- NETWORK AUTO-SCANNER ---
ipcMain.handle('scan-network', async () => {
  return new Promise((resolve) => {
    const interfaces = os.networkInterfaces();
    const subnetsToScan = [];
    
    // 1. Find all active local IPv4 subnets (Wi-Fi, USB Ethernet, etc)
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          subnetsToScan.push(`${parts[0]}.${parts[1]}.${parts[2]}.`);
        }
      }
    }

    if (subnetsToScan.length === 0) {
      resolve(null);
      return;
    }

    // 2. Scan all IPs across all subnets concurrently
    let pending = subnetsToScan.length * 254;
    let foundIp = null;
    let resolved = false;

    for (const subnetPrefix of subnetsToScan) {
      for (let i = 1; i <= 254; i++) {
        const targetIp = `${subnetPrefix}${i}`;
        const socket = new net.Socket();

        socket.setTimeout(500); // 500ms timeout for ultra-fast scan

        socket.on('connect', () => {
          if (!resolved) {
            foundIp = targetIp;
            resolved = true;
            resolve(foundIp);
          }
          socket.destroy();
        });

        socket.on('timeout', () => socket.destroy());
        socket.on('error', () => socket.destroy());
        socket.on('close', () => {
          pending--;
          if (pending === 0 && !resolved) {
            resolve(null);
          }
        });

        socket.connect(8000, targetIp);
      }
    }
  });
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
