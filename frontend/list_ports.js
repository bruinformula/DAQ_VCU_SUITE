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
  return stripped ? stripped.padStart(4, '0') : null;
}

function normalizePort(port) {
  const vendorId = normalizeUsbId(port.vendorId);
  const productId = normalizeUsbId(port.productId);
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
    usbBacked,
    bluetoothLike,
    mirrorEligible: usbBacked && !bluetoothLike,
  };
}

SerialPort.list().then(ports => {
  console.log("--- START PORTS ---");
  ports.forEach(p => {
    const norm = normalizePort(p);
    console.log(`Port: ${p.path} | Manufacturer: ${p.manufacturer} | VID: ${p.vendorId} | PID: ${p.productId} | usbBacked: ${norm.usbBacked} | bluetoothLike: ${norm.bluetoothLike} | mirrorEligible: ${norm.mirrorEligible}`);
  });
  console.log("--- END PORTS ---");
});
