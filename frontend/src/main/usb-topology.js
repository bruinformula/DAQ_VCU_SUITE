'use strict';

const { execFile } = require('child_process');

const TARGET_HUB_VID = '0424';
const TARGET_HUB_PID = '2514';
const SYSTEM_PROFILER_TIMEOUT_MS = 5000;
const SYSTEM_PROFILER_MAX_BUFFER = 4 * 1024 * 1024;

function normalizeUsbId(value) {
  if (!value) {
    return null;
  }

  const text = String(value).trim();
  const hexMatch = text.match(/0x([0-9a-fA-F]+)/);
  const stripped = hexMatch ? hexMatch[1] : text.replace(/[^0-9a-fA-F]/g, '');
  if (!stripped) {
    return null;
  }

  return stripped.toUpperCase().padStart(4, '0');
}

function normalizeLocationId(value) {
  if (!value) {
    return null;
  }

  return String(value).trim();
}

function normalizeUsbDevice(device) {
  return {
    name: device._name ?? 'Unknown USB device',
    manufacturer: device.manufacturer ?? null,
    vendorId: normalizeUsbId(device.vendor_id),
    productId: normalizeUsbId(device.product_id),
    locationId: normalizeLocationId(device.location_id),
    serialNumber: device.serial_num ?? null,
    speed: device.device_speed ?? null,
    version: device.bcd_device ?? null,
    currentAvailableMa: device.bus_power ?? null,
    currentRequiredMa: device.bus_power_used ?? null,
    extraOperatingCurrentMa: device.extra_current_used ?? null,
  };
}

function collectUsbDevices(nodes, collected = []) {
  if (!Array.isArray(nodes)) {
    return collected;
  }

  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      continue;
    }

    if (node.vendor_id || node.product_id || node.location_id) {
      collected.push(normalizeUsbDevice(node));
    }

    if (Array.isArray(node._items)) {
      collectUsbDevices(node._items, collected);
    }
  }

  return collected;
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function scanUsbTopology() {
  if (process.platform !== 'darwin') {
    return {
      hub: null,
      devices: [],
      scannedAt: new Date().toISOString(),
      error: 'USB2514 autodetect is implemented with macOS System Information only.',
    };
  }

  const { stdout } = await execFileAsync(
    'system_profiler',
    ['SPUSBDataType', '-json'],
    {
      timeout: SYSTEM_PROFILER_TIMEOUT_MS,
      maxBuffer: SYSTEM_PROFILER_MAX_BUFFER,
    }
  );

  const parsed = JSON.parse(stdout);
  const devices = collectUsbDevices(parsed.SPUSBDataType ?? []);
  const hubs = devices.filter((device) => {
    return device.vendorId === TARGET_HUB_VID && device.productId === TARGET_HUB_PID;
  });
  const hub = hubs[0] ?? null;

  return {
    hub,
    hubs,
    devices,
    scannedAt: new Date().toISOString(),
    error: null,
  };
}

module.exports = {
  TARGET_HUB_PID,
  TARGET_HUB_VID,
  scanUsbTopology,
};
