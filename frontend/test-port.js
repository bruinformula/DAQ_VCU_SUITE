const { SerialPort } = require('serialport');

function containsToken(value, token) {
  return String(value ?? '').toLowerCase().includes(token);
}

function isBluetoothLikePort(port) {
  return [port.path, port.manufacturer, port.pnpId, port.serialNumber].some((value) => {
    return containsToken(value, 'bluetooth') || containsToken(value, 'bth');
  });
}

function isUsbBackedPort(port) {
  if (port.vendorId || port.productId || port.locationId) {
    return true;
  }
  return [port.path, port.pnpId].some((value) => {
    return containsToken(value, 'usb') || containsToken(value, 'acm') || containsToken(value, 'modem');
  });
}

function normalizeUsbId(value) {
  if (!value) return null;
  const stripped = String(value).replace(/^0x/i, '').trim().toUpperCase();
  if (!stripped) return null;
  return stripped.padStart(4, '0');
}

function normalizePort(port) {
  const vendorId = normalizeUsbId(port.vendorId);
  const productId = normalizeUsbId(port.productId);
  const TARGET_VID = '0483';
  const TARGET_PID = '5740';
  const bluetoothLike = isBluetoothLikePort(port);
  const usbBacked = isUsbBackedPort({
    ...port,
    vendorId,
    productId,
  });

  return {
    path: port.path,
    manufacturer: port.manufacturer ?? null,
    serialNumber: port.serialNumber ?? null,
    locationId: port.locationId ?? null,
    pnpId: port.pnpId ?? null,
    vendorId,
    productId,
    displayName: port.path,
    usbBacked,
    bluetoothLike,
    matchesTarget: (vendorId === TARGET_VID && productId === TARGET_PID) || String(port.path).includes('usbserial'),
    mirrorEligible: usbBacked && !bluetoothLike,
  };
}

SerialPort.list().then(ports => {
  console.log("Raw Ports:", ports.map(p => p.path));
  console.log("Normalized:", ports.map(normalizePort).filter(p => p.mirrorEligible));
});
