'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const Papa = require('papaparse');
const readline = require('readline');
const net = require('net');

const { DeviceMonitor } = require('./device-monitor');
const { parseMduLine, parseSlcanToBoard } = require('./mdu-frame');

let mainWindow = null;
let monitor = null;
let activeDeployProcess = null;

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function buildDefaultLogFilePath() {
  const now = new Date();
  const compact = now.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
  return path.join(app.getPath('documents'), `mdu-debug-${compact}.jsonl`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    backgroundColor: '#f4efe3',
    title: 'MDU Debug GUI',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

function registerMonitorEvents() {
  monitor.on('ports', (ports) => broadcast('device:ports', ports));
  monitor.on('connection', (connection) => broadcast('device:connection', connection));
  monitor.on('diagnostics', (diagnostics) => broadcast('device:diagnostics', diagnostics));
  monitor.on('frame', (frame) => broadcast('device:frame', frame));
  monitor.on('frames', (frames) => broadcast('device:frames', frames));
  monitor.on('runtime', (runtime) => broadcast('device:runtime', runtime));
  monitor.on('log-status', (status) => broadcast('device:log-status', status));
}

const NETWORK_SCAN_PORT = 8000;
const NETWORK_SCAN_TIMEOUT_MS = 250;
const NETWORK_SCAN_CONCURRENCY = 32;
const COMMON_PI_HOSTS = ['10.42.0.1', '192.168.4.1', '192.168.137.1'];

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

function registerIpcHandlers() {
  ipcMain.handle('dialog:select-data-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Run Data Folder',
      properties: ['openDirectory'],
    });

    if (result.canceled || !result.filePaths?.length) {
      return null;
    }

    return result.filePaths[0];
  });

  async function scanDirectory(dir) {
    let results = [];
    try {
      const list = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const file of list) {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
          if (file.name !== 'node_modules' && !file.name.startsWith('.')) {
            try {
              const res = await scanDirectory(filePath);
              results = results.concat(res);
            } catch (e) {
              // Ignore sub-directory read errors
            }
          }
        } else if (file.isFile()) {
          const ext = path.extname(file.name).toLowerCase();
          if (ext === '.csv' || ext === '.jsonl') {
            const stats = await fs.promises.stat(filePath);
            results.push({
              name: file.name,
              path: filePath,
              size: stats.size,
              mtime: stats.mtimeMs,
            });
          }
        }
      }
    } catch (e) {
      // Ignore directory read errors
    }
    return results;
  }

  ipcMain.handle('folder:scan', async (_event, folderPath) => {
    if (!folderPath) return [];
    try {
      const results = await scanDirectory(folderPath);
      // Sort by modified time descending (newest runs first)
      return results.sort((a, b) => b.mtime - a.mtime);
    } catch (e) {
      console.error('Error scanning folder:', e);
      return [];
    }
  });

  ipcMain.handle('file:read', async (_event, filePath) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return content;
    } catch (e) {
      console.error('Error reading file:', e);
      throw e;
    }
  });

  ipcMain.handle('file:write', async (_event, filePath, content) => {
    try {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content, 'utf8');
      return { success: true };
    } catch (e) {
      console.error('Error writing file:', e);
      return { success: false, error: e.message };
    }
  });

  function decodeStandardCan(id, dataBytes) {
    if (!dataBytes || dataBytes.length === 0) return null;
    
    function toSigned16(value) {
      return value > 32767 ? value - 65536 : value;
    }
    
    if (id === 1712) { // BMS Voltages
      return {
        'bms.avg_cv': (dataBytes[0] | (dataBytes[1] << 8)) / 100,
        'bms.lo_cv': (dataBytes[2] | (dataBytes[3] << 8)) / 100,
        'bms.hi_cv': (dataBytes[4] | (dataBytes[5] << 8)) / 100,
      };
    }
    if (id === 1713) { // BMS Temperatures
      return {
        'bms.avg_t': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 100,
        'bms.hi_t': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
        'bms.lo_t': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 100,
      };
    }
    if (id === 1714) { // BMS SOC, Current, Voltage
      return {
        'bms.soc': (dataBytes[0] | (dataBytes[1] << 8)) / 100,
        'bms.i': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
        'bms.v': (dataBytes[4] | (dataBytes[5] << 8)) / 100,
      };
    }
    if (id === 160) { // Inverter IGBT temps
      return {
        'inv.all.module_a_temp': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
        'inv.all.module_b_temp': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
        'inv.all.module_c_temp': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
        'inv.all.gate_driver_board_temp': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
      };
    }
    if (id === 162) { // Inverter coolant & motor temp
      return {
        'inv.cool_t': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
        'inv.mot_t': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      };
    }
    if (id === 165) { // Inverter motor speed
      return {
        'inv.rpm': toSigned16(dataBytes[2] | (dataBytes[3] << 8)),
      };
    }
    if (id === 166) { // Inverter phase currents
      return {
        'inv.all.phase_a_current': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
        'inv.all.phase_b_current': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
        'inv.all.phase_c_current': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
        'inv.idc': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
      };
    }
    if (id === 167) { // Inverter DC bus voltage
      return {
        'inv.vdc': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      };
    }
    if (id === 170) { // Inverter VSM state
      return {
        'inv.all.vsm_state': dataBytes[0] | (dataBytes[1] << 8),
        'inv.all.inverter_state': dataBytes[2] | (dataBytes[3] << 8),
      };
    }
    if (id === 172) { // Inverter torque CMD & feedback
      return {
        'inv.tq_cmd': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
        'inv.tq_fb': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      };
    }
    if (id === 176) { // Inverter fast info
      return {
        'inv.rpm': toSigned16(dataBytes[0] | (dataBytes[1] << 8)),
        'inv.vdc': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
        'inv.tq_cmd': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
        'inv.tq_fb': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
      };
    }

    // --- NEW SIGNALS FROM BFR_DRIVE_BUS ---

    if (id === 161) {
      return {
        'inv.all.control_board_temp': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
        'inv.all.rtd1_temperature': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
        'inv.all.rtd2_temperature': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
        'inv.all.stall_burst_model_temp': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
      };
    }
    if (id === 163) {
      const a1 = ((dataBytes[0] | (dataBytes[1] << 8)) & 0x3FF) / 100;
      const a2 = (((dataBytes[1] >> 2) | (dataBytes[2] << 6)) & 0x3FF) / 100;
      const a3 = (((dataBytes[2] >> 4) | (dataBytes[3] << 4)) & 0x3FF) / 100;
      const a4 = ((dataBytes[4] | (dataBytes[5] << 8)) & 0x3FF) / 100;
      const a5 = (((dataBytes[5] >> 2) | (dataBytes[6] << 6)) & 0x3FF) / 100;
      const a6 = (((dataBytes[6] >> 4) | (dataBytes[7] << 4)) & 0x3FF) / 100;
      return {
        'inv.all.analog_input_1': a1, 'inv.all.analog_input_2': a2, 'inv.all.analog_input_3': a3,
        'inv.all.analog_input_4': a4, 'inv.all.analog_input_5': a5, 'inv.all.analog_input_6': a6,
      };
    }
    if (id === 164) {
      return {
        'inv.all.digital_input_1': dataBytes[0] & 1, 'inv.all.digital_input_2': dataBytes[1] & 1,
        'inv.all.digital_input_3': dataBytes[2] & 1, 'inv.all.digital_input_4': dataBytes[3] & 1,
        'inv.all.digital_input_5': dataBytes[4] & 1, 'inv.all.digital_input_6': dataBytes[5] & 1,
        'inv.all.digital_input_7': dataBytes[6] & 1, 'inv.all.digital_input_8': dataBytes[7] & 1,
      };
    }
    if (id === 168) {
      return {
        'inv.all.vd_ff': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
        'inv.all.vq_ff': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
        'inv.all.id': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
        'inv.all.iq': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
      };
    }
    if (id === 169) {
      return {
        'inv.all.ref_voltage_1_5': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 100,
        'inv.all.ref_voltage_2_5': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
        'inv.all.ref_voltage_5_0': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 100,
        'inv.all.ref_voltage_12_0': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 100,
      };
    }
    if (id === 171) {
      return {
        'inv.all.post_fault_lo': dataBytes[0] | (dataBytes[1] << 8),
        'inv.all.post_fault_hi': dataBytes[2] | (dataBytes[3] << 8),
        'inv.all.run_fault_lo': dataBytes[4] | (dataBytes[5] << 8),
        'inv.all.run_fault_hi': dataBytes[6] | (dataBytes[7] << 8),
      };
    }
    if (id === 173) {
      return {
        'inv.all.modulation_index': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10000,
        'inv.all.flux_weakening_output': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
        'inv.all.id_command': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
        'inv.all.iq_command': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
      };
    }
    if (id === 174) {
      return {
        'inv.all.eeprom_ver': dataBytes[0] | (dataBytes[1] << 8),
        'inv.all.sw_ver': dataBytes[2] | (dataBytes[3] << 8),
        'inv.all.date_mmdd': dataBytes[4] | (dataBytes[5] << 8),
        'inv.all.date_yyyy': dataBytes[6] | (dataBytes[7] << 8),
      };
    }
    if (id === 175) {
      return { 'inv.all.diag_record': dataBytes[0] };
    }
    if (id === 177) {
      return {
        'inv.all.torque_cap_motor': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
        'inv.all.torque_cap_regen': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      };
    }
    if (id === 192) {
      return {
        'inv.cmd.torque_command': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
        'inv.cmd.speed_command': toSigned16(dataBytes[2] | (dataBytes[3] << 8)),
        'inv.cmd.direction_command': dataBytes[4] & 1,
        'inv.cmd.inverter_enable': (dataBytes[5] & 1),
        'inv.cmd.inverter_discharge': (dataBytes[5] >> 1) & 1,
        'inv.cmd.speed_mode': (dataBytes[5] >> 2) & 1,
        'inv.cmd.torque_limit_command': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
      };
    }
    if (id === 514) {
      return {
        'bms.max_discharge': (dataBytes[0] | (dataBytes[1] << 8)),
        'bms.max_charge': (dataBytes[2] | (dataBytes[3] << 8)),
      };
    }
    if (id === 1715) {
      return { 'bms.precharge_complete': dataBytes[0] & 1 };
    }
    if (id === 1280) {
      return {
        'vcu.all.calc_vehicle_speed': toSigned16(dataBytes[0] | (dataBytes[1] << 8)),
        'vcu.all.requested_torque': toSigned16(dataBytes[2] | (dataBytes[3] << 8)),
        'vcu.all.apps1_as_percent': (dataBytes[4] > 127 ? dataBytes[4] - 256 : dataBytes[4]),
        'vcu.all.apps2_as_percent': (dataBytes[5] > 127 ? dataBytes[5] - 256 : dataBytes[5]),
        'vcu.all.bse_as_percent': (dataBytes[6] > 127 ? dataBytes[6] - 256 : dataBytes[6]),
        'vcu.all.imd_fault': dataBytes[7] & 1,
        'vcu.all.rtd_state': (dataBytes[7] >> 1) & 1,
        'vcu.all.precharge_relay_state': (dataBytes[7] >> 2) & 1,
        'vcu.all.air_pos_relay_state': (dataBytes[7] >> 3) & 1,
        'vcu.all.air_neg_relay_state': (dataBytes[7] >> 4) & 1,
      };
    }
    if (id === 1281) {
      return {
        'vcu.all.cooling_enable': dataBytes[0],
        'vcu.all.tractive_fan_pwm': dataBytes[1],
        'vcu.all.tractive_pump_pwm': dataBytes[2],
        'vcu.all.accy_fan_pwm': dataBytes[3],
      };
    }
    if (id === 1282) {
      return { 'vcu.all.precharge_cmd': dataBytes[0] };
    }
    if (id === 1264) {
      return {
        'fusebox.all.fusebox_state': dataBytes[0],
        'fusebox.all.dcdc_voltage': (dataBytes[1] | (dataBytes[2] << 8)),
        'fusebox.all.battery_voltage': (dataBytes[3] | (dataBytes[4] << 8)),
        'fusebox.all.lvb_soc': dataBytes[5],
        'fusebox.all.dcdc_temp': dataBytes[6] * 10,
      };
    }
    if (id === 1265) {
      return {
        'fusebox.all.accy_fan_power': (dataBytes[0] | (dataBytes[1] << 8)) * 100,
        'fusebox.all.tractive_fan_power': (dataBytes[2] | (dataBytes[3] << 8)) * 100,
        'fusebox.all.tractive_pumps_power': (dataBytes[4] | (dataBytes[5] << 8)) * 100,
        'fusebox.all.charging_power': (dataBytes[6] | (dataBytes[7] << 8)) * 100,
      };
    }
    if (id === 1266) {
      return { 'fusebox.all.ambient_temp': dataBytes[0] };
    }
  }

  function updateStateFromBoard(state, board, id, dataBytes) {
    if (board) {
      if (board.signals) {
        Object.assign(state, board.signals);
        return;
      }
      const bt = board.boardType;
      const bid = board.boardId;
      
      if (bt === 2) { // SDU
        if (board.shockMm !== undefined) state[`sdu[${bid}].shock`] = board.shockMm;
        if (board.brakeC !== undefined) state[`sdu[${bid}].brake`] = board.brakeC;
        if (board.rpm !== undefined) state[`sdu[${bid}].wrpm`] = board.rpm;
        if (board.tireC !== undefined) {
          state[`sdu[${bid}].tire[0]`] = board.tireC.max;
          state[`sdu[${bid}].tire[1]`] = board.tireC.min;
          state[`sdu[${bid}].tire[2]`] = board.tireC.center;
          state[`sdu[${bid}].tire[3]`] = board.tireC.ambient;
        }
      } else if (bt === 4) { // TSHMU
        if (board.flow1 !== undefined) state['tshmu.flow1'] = board.flow1;
        if (board.flow2 !== undefined) state['tshmu.flow2'] = board.flow2;
        if (board.jitter !== undefined) state['tshmu.jitter_us'] = board.jitter;
        if (board.errorFlags !== undefined) state['tshmu.error_flags'] = board.errorFlags;
      } else if (bt === 6) { // TSPMU
        if (board.pressure1 !== undefined) state[`tspmu[${bid}].p1`] = board.pressure1;
        if (board.pressure2 !== undefined) state[`tspmu[${bid}].p2`] = board.pressure2;
        if (board.tempBlocks && board.tempBlocks[0]) {
          state[`tspmu[${bid}].temps[0]`] = board.tempBlocks[0].temp1;
          state[`tspmu[${bid}].temps[1]`] = board.tempBlocks[0].temp2;
          state[`tspmu[${bid}].temps[2]`] = board.tempBlocks[0].temp3;
          state[`tspmu[${bid}].temps[3]`] = board.tempBlocks[0].temp4;
        } else if (board.tspmuTemp1 !== undefined) {
          state[`tspmu[${bid}].temps[0]`] = board.tspmuTemp1;
          state[`tspmu[${bid}].temps[1]`] = board.tspmuTemp2;
          state[`tspmu[${bid}].temps[2]`] = board.tspmuTemp3;
          state[`tspmu[${bid}].temps[3]`] = board.tspmuTemp4;
        }
      } else if (bt === 7 || bt === 1) { // GPS / SMU
        if (board.gpsPos) {
          state['gps.lat'] = board.gpsPos.latDeg;
          state['gps.lon'] = board.gpsPos.lonDeg;
          state['gps.alt'] = board.gpsPos.altM;
          state['gps.fix'] = board.gpsPos.fixValid;
          state['gps.fix_quality'] = board.gpsPos.fixQuality;
          state['gps.sats'] = board.gpsPos.satellites;
          state['gps.hdop'] = board.gpsPos.hdop;
          state['gps.error_flags'] = board.gpsPos.errorFlags;
        } else if (board.gpsNav) {
          state['gps.vel'] = board.gpsNav.velMps;
          state['gps.hdg'] = board.gpsNav.headingDeg;
          state['gps.heading_valid'] = board.gpsNav.headingValid;
          state['gps.heading_quality'] = board.gpsNav.headingQuality;
          state['gps.baseline_m'] = board.gpsNav.baselineM;
          state['gps.pitch_deg'] = board.gpsNav.pitchDeg;
          state['gps.error_flags'] = board.gpsNav.errorFlags;
        } else if (board.latitude_deg !== undefined) {
          state['gps.lat'] = board.latitude_deg;
          state['gps.lon'] = board.longitude_deg;
          state['gps.alt'] = board.altitude_m;
          state['gps.fix'] = board.fix_valid;
          state['gps.fix_quality'] = board.fix_quality;
          state['gps.sats'] = board.satellites;
          state['gps.hdop'] = board.hdop;
        } else if (board.velocity_mps !== undefined) {
          state['gps.vel'] = board.velocity_mps;
          state['gps.hdg'] = board.course_deg;
          state['gps.heading_valid'] = board.heading_valid;
          state['gps.heading_quality'] = board.heading_quality;
        }
        
        if (board.accelX !== undefined) {
          state['imu.ax'] = board.accelX / 1000.0;
          state['imu.ay'] = board.accelY / 1000.0;
          state['imu.az'] = board.accelZ / 1000.0;
          
          const stateIdx = `imu[${bid}]`;
          state[`${stateIdx}.ax`] = board.accelX / 1000.0;
          state[`${stateIdx}.ay`] = board.accelY / 1000.0;
          state[`${stateIdx}.az`] = board.accelZ / 1000.0;
          state[`${stateIdx}.pitch`] = board.veloX / 100.0;
          state[`${stateIdx}.roll`] = board.veloY / 100.0;
          state[`${stateIdx}.yaw`] = board.veloZ / 100.0;
        }
      }
    } else if (id !== undefined && dataBytes) {
      const dec = decodeStandardCan(id, dataBytes);
      if (dec) {
        for (const [k, v] of Object.entries(dec)) {
          state[k] = v;
        }
      }
    }
  }

  function createInitialSignalState() {
    return {
      'gps.lat': 0.0, 'gps.lon': 0.0, 'gps.alt': 0.0, 'gps.vel': 0.0, 'gps.hdg': 0.0,
      'gps.fix': 0, 'gps.fix_quality': 0, 'gps.rtk_state': 'no_fix', 'gps.sats': 0, 'gps.hdop': 99.99,
      'gps.heading_valid': 0, 'gps.heading_quality': 0, 'gps.heading_source': 'course_over_ground',
      'gps.heading_accuracy_deg': 0.0, 'gps.baseline_m': 0.0, 'gps.pitch_deg': 0.0, 'gps.error_flags': 0,
      'imu.ax': 0.0, 'imu.ay': 0.0, 'imu.az': 1.0,
      'imu.pitch': 0.0, 'imu.roll': 0.0, 'imu.yaw': 0.0,
      'imu[0].ax': 0.0, 'imu[0].ay': 0.0, 'imu[0].az': 1.0, 'imu[0].pitch': 0.0, 'imu[0].roll': 0.0, 'imu[0].yaw': 0.0,
      'imu[1].ax': 0.0, 'imu[1].ay': 0.0, 'imu[1].az': 1.0, 'imu[1].pitch': 0.0, 'imu[1].roll': 0.0, 'imu[1].yaw': 0.0,
      'imu[2].ax': 0.0, 'imu[2].ay': 0.0, 'imu[2].az': 1.0, 'imu[2].pitch': 0.0, 'imu[2].roll': 0.0, 'imu[2].yaw': 0.0,
      'sdu[0].shock': 0.0, 'sdu[0].brake': 0.0, 'sdu[0].wrpm': 0.0,
      'sdu[0].tire[0]': 0.0, 'sdu[0].tire[1]': 0.0, 'sdu[0].tire[2]': 0.0, 'sdu[0].tire[3]': 0.0,
      'sdu[1].shock': 0.0, 'sdu[1].brake': 0.0, 'sdu[1].wrpm': 0.0,
      'sdu[1].tire[0]': 0.0, 'sdu[1].tire[1]': 0.0, 'sdu[1].tire[2]': 0.0, 'sdu[1].tire[3]': 0.0,
      'sdu[2].shock': 0.0, 'sdu[2].brake': 0.0, 'sdu[2].wrpm': 0.0,
      'sdu[2].tire[0]': 0.0, 'sdu[2].tire[1]': 0.0, 'sdu[2].tire[2]': 0.0, 'sdu[2].tire[3]': 0.0,
      'sdu[3].shock': 0.0, 'sdu[3].brake': 0.0, 'sdu[3].wrpm': 0.0,
      'sdu[3].tire[0]': 0.0, 'sdu[3].tire[1]': 0.0, 'sdu[3].tire[2]': 0.0, 'sdu[3].tire[3]': 0.0,
      'tspmu[0].p1': 0.0, 'tspmu[0].p2': 0.0,
      'tspmu[0].temps[0]': 0.0, 'tspmu[0].temps[1]': 0.0, 'tspmu[0].temps[2]': 0.0, 'tspmu[0].temps[3]': 0.0,
      'tspmu[1].p1': 0.0, 'tspmu[1].p2': 0.0,
      'tspmu[1].temps[0]': 0.0, 'tspmu[1].temps[1]': 0.0, 'tspmu[1].temps[2]': 0.0, 'tspmu[1].temps[3]': 0.0,
      'tshmu.flow1': 0.0, 'tshmu.flow2': 0.0, 'tshmu.jitter_us': 0, 'tshmu.error_flags': 0,
      'bms.v': 0.0, 'bms.i': 0.0, 'bms.soc': 0.0, 'bms.avg_t': 0.0, 'bms.hi_t': 0.0, 'bms.lo_t': 0.0,
      'bms.avg_cv': 0.0, 'bms.hi_cv': 0.0, 'bms.lo_cv': 0.0,
      'inv.mot_t': 0.0, 'inv.cool_t': 0.0, 'inv.tq_cmd': 0.0, 'inv.tq_fb': 0.0, 'inv.idc': 0.0, 'inv.rpm': 0.0,
      'inv.vdc': 0.0,

      // Inverter New Signals
      'inv.all.control_board_temp': 0.0, 'inv.all.rtd1_temp': 0.0, 'inv.all.rtd2_temp': 0.0, 'inv.all.stall_burst_model_temp': 0.0,
      'inv.all.analog1': 0.0, 'inv.all.analog2': 0.0, 'inv.all.analog3': 0.0, 'inv.all.analog4': 0.0, 'inv.all.analog5': 0.0, 'inv.all.analog6': 0.0,
      'inv.all.dig1': 0, 'inv.all.dig2': 0, 'inv.all.dig3': 0, 'inv.all.dig4': 0, 'inv.all.dig5': 0, 'inv.all.dig6': 0, 'inv.all.dig7': 0, 'inv.all.dig8': 0,
      'inv.all.vd_ff': 0.0, 'inv.all.vq_ff': 0.0, 'inv.all.id': 0.0, 'inv.all.iq': 0.0,
      'inv.all.ref_voltage_1_5': 0.0, 'inv.all.ref_voltage_2_5': 0.0, 'inv.all.ref_voltage_5_0': 0.0, 'inv.all.ref_voltage_12_0': 0.0,
      'inv.all.post_fault_lo': 0, 'inv.all.post_fault_hi': 0, 'inv.all.run_fault_lo': 0, 'inv.all.run_fault_hi': 0,
      'inv.all.modulation_index': 0.0, 'inv.all.flux_weakening_output': 0.0, 'inv.all.id_command': 0.0, 'inv.all.iq_command': 0.0,
      'inv.all.eeprom_ver': 0, 'inv.all.sw_ver': 0, 'inv.all.date_mmdd': 0, 'inv.all.date_yyyy': 0,
      'inv.all.diag_record': 0,
      'inv.all.torque_cap_motor': 0.0, 'inv.all.torque_cap_regen': 0.0,
      'inv.cmd.torque': 0.0, 'inv.cmd.speed': 0.0, 'inv.cmd.direction': 0, 'inv.cmd.enable': 0, 'inv.cmd.discharge': 0, 'inv.cmd.speed_mode': 0, 'inv.cmd.torque_limit': 0.0,

      // BMS New
      'bms.max_discharge': 0.0, 'bms.max_charge': 0.0, 'bms.precharge_complete': 0,

      // VCU New
      'vcu.calc_vehicle_speed': 0, 'vcu.requested_torque': 0, 'vcu.apps1': 0, 'vcu.apps2': 0, 'vcu.bse': 0,
      'vcu.imd_fault': 0, 'vcu.rtd_state': 0, 'vcu.precharge_relay_state': 0, 'vcu.air_pos_relay_state': 0, 'vcu.air_neg_relay_state': 0,
      'vcu.cooling_enable': 0, 'vcu.tractive_fan_pwm': 0, 'vcu.tractive_pump_pwm': 0, 'vcu.accy_fan_pwm': 0, 'vcu.precharge_cmd': 0,

      // Fusebox New
      'fusebox.state': 0, 'fusebox.dcdc_v': 0.0, 'fusebox.batt_v': 0.0, 'fusebox.lvb_soc': 0, 'fusebox.dcdc_temp': 0.0,
      'fusebox.accy_fan_power': 0.0, 'fusebox.tractive_fan_power': 0.0, 'fusebox.tractive_pumps_power': 0.0, 'fusebox.charging_power': 0.0,
      'fusebox.ambient_temp': 0.0,
    };
  }

  class StreamTelemetryParser {
    constructor() {
      this.startMs = null;
      this.currentBinIdx = -1;
      this.latestState = createInitialSignalState();
      this.rows = [];
    }

    addFrame(tsMs, board, id, dataBytes) {
      if (this.startMs === null) {
        this.startMs = tsMs;
      }

      const binIdx = Math.floor((tsMs - this.startMs) / 100);

      if (binIdx > this.currentBinIdx) {
        if (this.currentBinIdx !== -1) {
          for (let b = this.currentBinIdx; b < binIdx; b++) {
            const tsSeconds = (this.startMs + b * 100) / 1000;
            this.rows.push({
              ts: tsSeconds.toFixed(3),
              ...this.latestState
            });
          }
        }
        this.currentBinIdx = binIdx;
      }

      updateStateFromBoard(this.latestState, board, id, dataBytes);
    }

    finish() {
      if (this.currentBinIdx !== -1) {
        const tsSeconds = (this.startMs + this.currentBinIdx * 100) / 1000;
        this.rows.push({
          ts: tsSeconds.toFixed(3),
          ...this.latestState
        });
      }
      return this.rows;
    }
  }

  function binFramesTo10Hz(frames) {
    if (frames.length === 0) return [];
    frames.sort((a, b) => a.timestampMs - b.timestampMs);
    const startMs = frames[0].timestampMs;
    
    const latestState = createInitialSignalState();
    
    const bins = new Map();
    for (const frame of frames) {
      const binIdx = Math.floor((frame.timestampMs - startMs) / 100);
      if (!bins.has(binIdx)) {
        bins.set(binIdx, []);
      }
      bins.get(binIdx).push(frame);
    }
    
    let maxBin = 0;
    for (const binIdx of bins.keys()) {
      if (binIdx > maxBin) maxBin = binIdx;
    }
    
    const rows = [];
    for (let b = 0; b <= maxBin; b++) {
      const binFrames = bins.get(b) || [];
      for (const frame of binFrames) {
        updateStateFromBoard(latestState, frame.board, frame.id, frame.dataBytes);
      }
      
      const tsSeconds = (startMs + b * 100) / 1000;
      rows.push({
        ts: tsSeconds.toFixed(3),
        ...latestState
      });
    }
    return rows;
  }

  function decimateRows(rows, maxRows = 20000) {
    if (!rows || rows.length <= maxRows) return rows;
    const step = Math.ceil(rows.length / maxRows);
    console.log(`Decimating rows from ${rows.length} to ${Math.ceil(rows.length / step)} (step: ${step}) to prevent OOM/UI lag.`);
    const decimated = [];
    for (let i = 0; i < rows.length; i += step) {
      decimated.push(rows[i]);
    }
    return decimated;
  }

  async function parseTelemetryFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.csv') {
      const inStreamHeader = fs.createReadStream(filePath);
      const rlHeader = readline.createInterface({ input: inStreamHeader });
      let firstLine = '';
      for await (const line of rlHeader) {
        firstLine = line;
        break;
      }
      rlHeader.close();
      inStreamHeader.destroy();
      
      if (!firstLine) return [];
      
      const headers = firstLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
      
      const isRawCanCsv = headers.includes('id_hex') && headers.includes('data_hex');
      const rawColName = headers.find(h => h === 'raw' || h === 'message');
      
      if (isRawCanCsv) {
        const timeColIdx = headers.indexOf('ts');
        const idDecColIdx = headers.indexOf('id_dec');
        const idHexColIdx = headers.indexOf('id_hex');
        const dataHexColIdx = headers.indexOf('data_hex');
        const dlcColIdx = headers.indexOf('dlc');
        
        const parser = new StreamTelemetryParser();
        
        const inStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: inStream });
        let isFirst = true;
        
        for await (const line of rl) {
          if (isFirst) {
            isFirst = false;
            continue;
          }
          if (!line.trim()) continue;
          
          const parts = line.split(',');
          const idHexStr = parts[idHexColIdx];
          const dataHexStr = parts[dataHexColIdx];
          if (!idHexStr || !dataHexStr) continue;
          
          let tsMs = parseFloat(parts[timeColIdx]);
          if (isNaN(tsMs)) {
            tsMs = Date.now();
          } else {
            tsMs = tsMs * 1000;
          }
          
          const identifier = idDecColIdx !== -1 ? parseInt(parts[idDecColIdx], 10) : parseInt(idHexStr, 16);
          const identifierHex = idHexStr.replace(/^0x/i, '').toUpperCase();
          const idText = '0x' + identifierHex;
          const idType = identifier > 0x7FF ? 'extended' : 'standard';
          
          const dlcVal = dlcColIdx !== -1 ? parseInt(parts[dlcColIdx], 10) : dataHexStr.length / 2;
          
          const dataBytes = [];
          for (let i = 0; i < dataHexStr.length; i += 2) {
            dataBytes.push(parseInt(dataHexStr.substring(i, i + 2), 16));
          }
          
          const slcan = {
            ok: true,
            identifier,
            identifierHex,
            idText,
            idType,
            dataLength: dlcVal,
            dataHex: dataHexStr,
            dataBytes,
          };
          
          const rawLine = `t${identifierHex.padStart(3, '0')}${dlcVal}${dataHexStr}`;
          const parsedFrame = parseSlcanToBoard(slcan, rawLine);
          
          if (parsedFrame.ok) {
            parser.addFrame(tsMs, parsedFrame.board, parsedFrame.identifier, parsedFrame.dataBytes);
          }
        }
        return decimateRows(parser.finish());
      }
      
      if (rawColName) {
        const rawColIdx = headers.indexOf(rawColName);
        const timeColIdx = headers.findIndex(h => h === 'ts' || h.toLowerCase().includes('time'));
        
        const parser = new StreamTelemetryParser();
        
        const inStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: inStream });
        let isFirst = true;
        
        for await (const line of rl) {
          if (isFirst) {
            isFirst = false;
            continue;
          }
          if (!line.trim()) continue;
          
          const parts = line.split(',');
          const rawStr = parts[rawColIdx];
          if (!rawStr) continue;
          
          let tsMs = timeColIdx !== -1 ? parseFloat(parts[timeColIdx]) : NaN;
          if (isNaN(tsMs)) {
            tsMs = Date.now();
          } else if (tsMs < 1000000000) {
            tsMs = tsMs * 1000;
          }
          
          const parsedFrame = parseMduLine(rawStr);
          if (parsedFrame.ok) {
            parser.addFrame(tsMs, parsedFrame.board, parsedFrame.identifier, parsedFrame.dataBytes);
          }
        }
        return decimateRows(parser.finish());
      }
      
      // Pre-parsed telemetry CSV file - stream-based parsing with on-the-fly decimation
      const stats = await fs.promises.stat(filePath);
      const fileSize = stats.size;
      
      const inStream = fs.createReadStream(filePath);
      const isRawCan = filePath.toUpperCase().includes('_CAN.CSV') || (headers.includes('id_dec') && headers.includes('data_hex'));
      const rl = readline.createInterface({ input: inStream });
      let step = 1;
      let lineIndex = 0;
      let isFirst = true;
      const rows = [];
      
      for await (const line of rl) {
        if (isFirst) {
          isFirst = false;
          continue;
        }
        if (!line.trim()) continue;
        
        if (lineIndex === 0 && !isRawCan) {
          const avgLineSize = line.length + 1;
          const estimatedLines = Math.ceil(fileSize / avgLineSize);
          step = Math.ceil(estimatedLines / 20000);
          if (step < 1) step = 1;
          if (step > 1) {
            console.log(`Pre-parsed CSV: estimated lines: ${estimatedLines}, step: ${step} (maxRows: 20000)`);
          }
        }
        
        if (isRawCan || lineIndex % step === 0) {
          const parts = line.split(',');
          const rowObj = {};
          for (let i = 0; i < headers.length; i++) {
            rowObj[headers[i]] = parts[i];
          }
          rows.push(rowObj);
        }
        lineIndex++;
      }
      
      return isRawCan ? rows : decimateRows(rows);
    }
    
    if (ext === '.jsonl') {
      const inStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({ input: inStream });
      const parser = new StreamTelemetryParser();
      
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          let tsMs = Date.now();
          if (data.timestamp) {
            tsMs = new Date(data.timestamp).getTime();
          }
          
          if (data.type === 'frame' && data.board) {
            parser.addFrame(
              tsMs,
              data.board,
              data.frame?.identifier || data.board?.identifier,
              data.frame?.dataBytes || data.board?.dataBytes
            );
          } else if (data.raw) {
            const parsedFrame = parseMduLine(data.raw);
            if (parsedFrame.ok) {
              parser.addFrame(tsMs, parsedFrame.board, parsedFrame.identifier, parsedFrame.dataBytes);
            }
          }
        } catch (e) {
          // ignore
        }
      }
      return decimateRows(parser.finish());
    }
    return [];
  }

  ipcMain.handle('file:parse-telemetry', async (_event, filePath) => {
    try {
      return await parseTelemetryFile(filePath);
    } catch (e) {
      console.error('Error parsing telemetry file:', e);
      throw e;
    }
  });

  ipcMain.handle('file:parse-can-log-python', async (_event, inputPath) => {
    try {
      const suiteDir = app.isPackaged 
        ? path.dirname(app.getAppPath()) 
        : path.resolve(__dirname, '../../..');
      
      const parsedLogsDir = path.join(suiteDir, 'parsed_logs');
      await fs.promises.mkdir(parsedLogsDir, { recursive: true });
      
      const baseName = path.basename(inputPath, path.extname(inputPath));
      const outputPath = path.join(parsedLogsDir, `${baseName}_DECODED.csv`);
      
      const scriptPath = path.join(suiteDir, 'backend', 'parse_can_log.py');
      
      return new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        const child = spawn(pythonCmd, [scriptPath, inputPath, outputPath]);
        let stderr = '';
        
        child.stdout.on('data', data => {
          const str = data.toString();
          const match = str.match(/PROGRESS:\s*([0-9.]+)/);
          if (match) {
            _event.sender.send('parse-progress', parseFloat(match[1]));
          }
        });
        
        child.stderr.on('data', data => stderr += data.toString());
        child.on('close', code => {
          if (code === 0) resolve(outputPath);
          else reject(new Error(`Parser failed (code ${code}): ${stderr}`));
        });
        child.on('error', reject);
      });
    } catch (e) {
      console.error('Error invoking python parser:', e);
      throw e;
    }
  });

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

  ipcMain.handle('wifi:parse-frame', (_event, { id, dataHex }) => {
    // Build a minimal slcan-compatible object from the WiFi JSON frame fields,
    // then run it through the same parseSlcanToBoard used by the USB binary path.
    if (!Number.isFinite(id) || typeof dataHex !== 'string') {
      return { ok: false, reason: 'invalid-wifi-frame' };
    }
    const upperHex = dataHex.toUpperCase();
    const dataBytes = [];
    for (let i = 0; i < upperHex.length; i += 2) {
      dataBytes.push(parseInt(upperHex.substring(i, i + 2), 16));
    }
    const identifierHex = id.toString(16).toUpperCase().padStart(3, '0');
    const idType = id > 0x7FF ? 'extended' : 'standard';
    const slcan = {
      ok: true,
      raw: `t${identifierHex}${(dataBytes.length).toString(16).padStart(2, '0')}${upperHex}`,
      frameType: idType === 'standard' ? 't' : 'T',
      idType,
      identifier: id,
      identifierHex,
      idText: `0x${identifierHex}`,
      dataLength: dataBytes.length,
      dataHex: upperHex,
      dataBytes,
    };
    return parseSlcanToBoard(slcan, slcan.raw);
  });

  ipcMain.handle('wifi:parse-frames', (_event, frames) => {
    const results = [];
    for (const frame of frames) {
      if (!Number.isFinite(frame.id) || typeof frame.d !== 'string') {
        continue;
      }
      const upperHex = frame.d.trim().toUpperCase();
      const dataBytes = [];
      for (let i = 0; i < upperHex.length; i += 2) {
        const byteStr = upperHex.substring(i, i + 2);
        if (byteStr.length === 2) {
          const byteVal = parseInt(byteStr, 16);
          if (!isNaN(byteVal)) dataBytes.push(byteVal);
        }
      }
      const identifierHex = frame.id.toString(16).toUpperCase().padStart(3, '0');
      const idType = frame.id > 0x7FF ? 'extended' : 'standard';
      const slcan = {
        ok: true,
        raw: `t${identifierHex}${(dataBytes.length).toString(16).padStart(2, '0')}${upperHex}`,
        frameType: idType === 'standard' ? 't' : 'T',
        idType,
        identifier: frame.id,
        identifierHex,
        idText: `0x${identifierHex}`,
        dataLength: dataBytes.length,
        dataHex: upperHex,
        dataBytes,
      };
      
      const parsed = parseSlcanToBoard(slcan, slcan.raw);
      if (parsed && parsed.ok) {
        if (monitor) {
          monitor.stats.recordLine(parsed);
          monitor.boardStates.record(parsed.board);
        }
        results.push({
          ok: true,
          board: parsed.board,
          identifier: frame.id,
          dataBytes: slcan.dataBytes,
          raw: parsed.raw,
          source: 'wifi',
          idText: parsed.idText,
          idType: parsed.idType,
          dataLength: parsed.dataLength,
          dataHex: parsed.dataHex
        });
      }
    }
    if (results.length > 0) {
      broadcast('device:frames', results);
    }
    return results;
  });

  ipcMain.handle('app:get-initial-state', async () => monitor.getInitialState());
  ipcMain.handle('serial:list-ports', async () => monitor.listPorts());
  ipcMain.handle('serial:connect', async (_event, options) => monitor.connect(options));
  ipcMain.handle('serial:set-preferred-port', async (_event, path) => monitor.setPreferredPort(path));
  ipcMain.handle('serial:disconnect', async () => monitor.disconnect());
  ipcMain.handle('serial:set-auto-connect', async (_event, enabled) => monitor.setAutoConnect(enabled));
  ipcMain.handle('session:clear', async () => monitor.clearSession());
  ipcMain.handle('log:pick-file', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Choose a log file',
      defaultPath: buildDefaultLogFilePath(),
      filters: [
        { name: 'JSON Lines', extensions: ['jsonl'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (result.canceled) {
      return null;
    }

    return result.filePath;
  });
  ipcMain.handle('log:start', async (_event, filePath) => monitor.startLogging(filePath));
  ipcMain.handle('log:stop', async () => monitor.stopLogging());
  ipcMain.handle('log:write-entry', async (_event, entry) => {
    if (monitor.logWriter.getStatus().active) {
      return monitor.logWriter.write(entry);
    }
    return false;
  });
  ipcMain.handle('dialog:open-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select File',
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths?.length) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('log:open-file', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open saved log file',
      properties: ['openFile'],
      filters: [
        { name: 'JSON Lines', extensions: ['jsonl'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePaths?.length) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = await fs.promises.readFile(filePath, 'utf8');
    const entries = content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));

    return { filePath, entries };
  });
  ipcMain.handle('log:export-filtered-log', async (_event, rows) => {
    const result = await dialog.showSaveDialog({
      title: 'Export filtered log rows',
      defaultPath: buildDefaultLogFilePath(),
      filters: [
        { name: 'JSON Lines', extensions: ['jsonl'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    const filePath = result.filePath;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const data = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await fs.promises.writeFile(filePath, data, 'utf8');
    return filePath;
  });

  function locateBfr() {
    const home = os.homedir();
    const searchPaths = [
      path.join(home, 'bfr-cli', 'bfr'),
      path.join(home, 'workspace', 'bfr-cli', 'bfr'),
      '/Users/larry/bfr-cli/bfr'
    ];
    
    try {
      const zshrcPath = path.join(home, '.zshrc');
      if (fs.existsSync(zshrcPath)) {
        const content = fs.readFileSync(zshrcPath, 'utf8');
        const match = content.match(/alias\s+bfr=['"]([^'"]+)['"]/);
        if (match && match[1]) {
          searchPaths.push(match[1]);
        }
      }
    } catch (e) {
      // Ignore
    }
    
    for (const p of searchPaths) {
      const resolved = p.replace(/^~/, home);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
    
    return 'bfr';
  }

  function getSpawnConfig(bfrPath, args) {
    if (process.platform === 'win32') {
      return {
        command: 'python',
        args: [bfrPath, ...args]
      };
    }
    return {
      command: bfrPath,
      args: args
    };
  }

  ipcMain.handle('bfr:get-config', async () => {
    const bfrPath = locateBfr();
    const detected = bfrPath !== 'bfr' && fs.existsSync(bfrPath);
    const home = os.homedir();
    
    const boards = {
      sdu: { name: 'SDU (Sensor Data Unit)', board_id_var: 'SDU_BOARD_ID', ids: ['FL', 'FR', 'RL', 'RR'], path: path.join(home, 'mk11-sdu') },
      mdu: { name: 'MDU (Master Data Unit)', path: path.join(home, 'mk11-mdu-code') },
      tspmu: { name: 'TSPMU (Tire System Pressure Monitoring Unit)', board_id_var: 'TSPMU_BOARD_ID', ids: ['0', '1'], path: path.join(home, 'mk11-daq-TSPMU-CODE') },
      smu: { name: 'SMU (Sensor Measurement Unit / IMU)', board_id_var: 'SMU_BOARD_ID', ids: ['GPS', 'Mid IMU', 'Rear IMU'], path: path.join(home, 'mk11-smu') }
    };
    
    try {
      const configPath = path.join(home, '.bfr_config.json');
      if (fs.existsSync(configPath)) {
        const data = await fs.promises.readFile(configPath, 'utf8');
        const parsed = JSON.parse(data);
        
        if (parsed.paths) {
          for (const [key, p] of Object.entries(parsed.paths)) {
            if (boards[key]) {
              boards[key].path = p;
            }
          }
        }
        
        if (parsed.custom_boards) {
          for (const [key, info] of Object.entries(parsed.custom_boards)) {
            boards[key] = {
              name: info.name || key.toUpperCase(),
              board_id_var: info.board_id_var,
              ids: info.ids || [],
              path: parsed.paths?.[key] || ''
            };
          }
        }
      }
    } catch (e) {
      // Ignore
    }
    
    return { bfrPath, detected, boards };
  });

  ipcMain.handle('bfr:run-setup', async () => {
    const bfrPath = locateBfr();
    let scriptPath = '';
    if (bfrPath !== 'bfr') {
      scriptPath = path.join(path.dirname(bfrPath), 'setup.sh');
    } else {
      scriptPath = '/Users/larry/bfr-cli/setup.sh';
    }
    
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Setup script not found at ${scriptPath}`);
    }
    
    return new Promise((resolve, reject) => {
      const child = spawn(scriptPath, [], { shell: true });
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        broadcast('board:deploy-log', { type: 'stdout', text });
      });
      
      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        broadcast('board:deploy-log', { type: 'stderr', text });
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, stdout });
        } else {
          reject(new Error(`Setup script exited with code ${code}. Stderr: ${stderr}`));
        }
      });
    });
  });

  ipcMain.handle('dialog:select-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Board Repository Directory',
      properties: ['openDirectory', 'createDirectory']
    });
    
    if (result.canceled || !result.filePaths?.length) {
      return null;
    }
    
    return result.filePaths[0];
  });

  ipcMain.handle('bfr:register-board', async (_event, boardKey, elf, name, aliases, boardIdVar, dirPath) => {
    const bfrPath = locateBfr();
    const args = ['register', boardKey];
    if (elf) args.push('--elf', elf);
    if (name) args.push('--name', name);
    if (aliases) args.push('--alias', aliases);
    if (boardIdVar) args.push('--board-id-var', boardIdVar);
    
    const spawnConf = getSpawnConfig(bfrPath, args);
    
    return new Promise((resolve, reject) => {
      const child = spawn(spawnConf.command, spawnConf.args, { cwd: dirPath, env: process.env });
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, stdout });
        } else {
          reject(new Error(`bfr register failed with code ${code}. Stderr: ${stderr}`));
        }
      });
    });
  });

  ipcMain.handle('board:deploy', async (_event, action, boardKey, boardId) => {
    if (monitor && typeof monitor.disconnect === 'function') {
      try {
        const state = monitor.getInitialState ? monitor.getInitialState() : {};
        const isConnected = state.connected || (monitor.serial && monitor.serial.isOpen);
        if (isConnected) {
          broadcast('board:deploy-log', { type: 'stdout', text: `\x1B[1;33m[GUI] Auto-disconnecting serial port before ${action} to free SWD interface...\x1B[0m\n` });
          await monitor.disconnect();
        }
      } catch (e) {
        broadcast('board:deploy-log', { type: 'stderr', text: `[GUI] Warning: Failed to disconnect serial port: ${e.message}\n` });
      }
    }
    
    const bfrPath = locateBfr();
    const args = [action, boardKey];
    if (boardId) {
      args.push(boardId);
    }
    
    const spawnConf = getSpawnConfig(bfrPath, args);
    const cmdStr = process.platform === 'win32' ? `python ${bfrPath} ${args.join(' ')}` : `${bfrPath} ${args.join(' ')}`;
    broadcast('board:deploy-log', { type: 'stdout', text: `\x1B[1;36m>>> Executing: ${cmdStr}\x1B[0m\n` });
    
    return new Promise((resolve) => {
      const child = spawn(spawnConf.command, spawnConf.args, { env: process.env });
      activeDeployProcess = child;
      
      child.on('error', (err) => {
        broadcast('board:deploy-log', { type: 'stderr', text: `[GUI] Failed to start process: ${err.message}\n` });
        activeDeployProcess = null;
        resolve({ success: false, code: -1 });
      });

      child.stdout.on('data', (data) => {
        broadcast('board:deploy-log', { type: 'stdout', text: data.toString() });
      });
      
      child.stderr.on('data', (data) => {
        broadcast('board:deploy-log', { type: 'stderr', text: data.toString() });
      });
      
      child.on('close', (code) => {
        activeDeployProcess = null;
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, code });
        }
      });
    });
  });

  ipcMain.handle('board:deploy-kill', async () => {
    if (activeDeployProcess) {
      broadcast('board:deploy-log', { type: 'stdout', text: `\n\x1B[1;31m[GUI] Stop button clicked. Terminating build/flash process (PID ${activeDeployProcess.pid})...\x1B[0m\n` });
      activeDeployProcess.kill('SIGINT');
      const proc = activeDeployProcess;
      setTimeout(() => {
        try {
          if (proc) proc.kill('SIGKILL');
        } catch (e) {
          // ignore
        }
      }, 1000);
      return true;
    }
    return false;
  });
}

app.whenReady().then(async () => {
  monitor = new DeviceMonitor();
  registerMonitorEvents();
  registerIpcHandlers();
  await monitor.start();
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

app.on('before-quit', async () => {
  if (monitor) {
    await monitor.dispose();
  }
});
