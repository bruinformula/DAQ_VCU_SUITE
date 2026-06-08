/**
 * canDecoder.js — ES-module port of the CAN frame parsing logic from mdu-frame.js.
 *
 * Decodes raw CAN frames `{ id, dataBytes }` received over WiFi into the same
 * board/signal objects produced by the USB serial path.
 *
 * Main export:  parseRawCanFrame(id, dataBytes) → { board }
 * The returned board is identical in shape to what mdu-frame.js returns so that
 * updateStateFromBoard() in TelemetryContext.jsx works unchanged.
 */

// ---------------------------------------------------------------------------
// Signed helpers
// ---------------------------------------------------------------------------

function toSigned8(v) { return v > 127 ? v - 256 : v; }
function toSigned16(v) { return v > 32767 ? v - 65536 : v; }

function getSigned32LE(data, offset) {
  const u = (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  return u > 0x7FFFFFFF ? u - 0x100000000 : u;
}

function getUnsigned16LE(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

function getUnsigned32LE(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function idMeta(id) {
  const hex = id.toString(16).toUpperCase().padStart(3, '0');
  return { identifier: id, identifierHex: hex, idText: `0x${hex}` };
}

// ---------------------------------------------------------------------------
// SDU payload decoders (ported from mdu-frame.js)
// ---------------------------------------------------------------------------

function decodeStrainGaugeBlocks(data) {
  const blocks = [];
  for (let i = 0; i < 5; i++) {
    const o = 6 + i * 10;
    if (o + 9 >= data.length) break;
    const v1 = (data[o] << 4) | (data[o + 2] >> 4);
    const v2 = (data[o + 1] << 4) | (data[o + 2] & 0x0F);
    const v3 = (data[o + 3] << 4) | (data[o + 5] >> 4);
    const v4 = (data[o + 4] << 4) | (data[o + 5] & 0x0F);
    const v5 = (data[o + 6] << 4) | (data[o + 8] >> 4);
    const v6 = (data[o + 7] << 4) | (data[o + 8] & 0x0F);
    blocks.push({
      index: i,
      strainGaugesMv: [v1, v2, v3, v4, v5, v6].map(v => Math.round((v / 4095.0) * 6600.0 - 3300.0)),
      jitterUs: toSigned8(data[o + 9]),
    });
  }
  return blocks;
}

function decodeSensorSamples(data, sampleCount, scaleFactor) {
  const samples = [];
  for (let i = 0; i < sampleCount; i++) {
    const o = 6 + i * 3;
    if (o + 2 >= data.length) break;
    const rawVal = data[o] | (data[o + 1] << 8);
    samples.push({ index: i, value: rawVal / scaleFactor, jitterUs: toSigned8(data[o + 2]) });
  }
  return samples;
}

function decodeTireHistoryBlocks(data) {
  const blocks = [];
  for (let i = 0; i < 11; i++) {
    const o = 6 + i * 5;
    if (o + 4 >= data.length) break;
    blocks.push({
      index: i,
      max: data[o],
      min: data[o + 1],
      center: data[o + 2],
      ambient: data[o + 3],
      jitterMs: toSigned8(data[o + 4]),
    });
  }
  return blocks;
}

function decodeTspmuPressureBlocks(data) {
  const blocks = [];
  for (let i = 0; i < 11; i++) {
    const o = 4 + i * 5;
    if (o + 4 >= data.length) break;
    blocks.push({
      index: i,
      pressure1: toSigned16(data[o] | (data[o + 1] << 8)) / 100.0,
      pressure2: toSigned16(data[o + 2] | (data[o + 3] << 8)) / 100.0,
      jitter: data[o + 4],
    });
  }
  return blocks;
}

function decodeTshmuTempBlocks(data) {
  const blocks = [];
  for (let i = 0; i < 4; i++) {
    const o = 6 + i * 13;
    if (o + 12 >= data.length) break;
    blocks.push({
      index: i,
      temp1: toSigned16(data[o] | (data[o + 1] << 8)) / 1000.0,
      temp2: toSigned16(data[o + 2] | (data[o + 3] << 8)) / 1000.0,
      temp3: toSigned16(data[o + 4] | (data[o + 5] << 8)) / 1000.0,
      temp4: toSigned16(data[o + 6] | (data[o + 7] << 8)) / 1000.0,
      temp5: toSigned16(data[o + 8] | (data[o + 9] << 8)) / 1000.0,
      temp6: toSigned16(data[o + 10] | (data[o + 11] << 8)) / 1000.0,
      jitterMs: toSigned8(data[o + 12]),
    });
  }
  return blocks;
}

function decodeFlowBlocks(data) {
  const blocks = [];
  for (let i = 0; i < 6; i++) {
    const o = 6 + i * 9;
    if (o + 8 >= data.length) break;
    blocks.push({
      index: i,
      raw1: data[o] | (data[o + 1] << 8),
      flow1: (data[o + 2] | (data[o + 3] << 8)) / 10.0,
      raw2: data[o + 4] | (data[o + 5] << 8),
      flow2: (data[o + 6] | (data[o + 7] << 8)) / 10.0,
      jitter: toSigned8(data[o + 8]),
    });
  }
  return blocks;
}

function decodeTspmuTempBlocks(data) {
  const blocks = [];
  for (let i = 0; i < 6; i++) {
    const o = 4 + i * 9;
    if (o + 8 >= data.length) break;
    blocks.push({
      index: i,
      temp1: toSigned16(data[o] | (data[o + 1] << 8)) / 10.0,
      temp2: toSigned16(data[o + 2] | (data[o + 3] << 8)) / 10.0,
      temp3: toSigned16(data[o + 4] | (data[o + 5] << 8)) / 10.0,
      temp4: toSigned16(data[o + 6] | (data[o + 7] << 8)) / 10.0,
      jitterMs: toSigned8(data[o + 8]),
    });
  }
  return blocks;
}

function decodeImuSamples(data) {
  const baseTimestamp = getUnsigned32LE(data, 0);
  const expectedPeriod = data[4];
  const errorFlags = data[5] | (data[6] << 8);
  function s16(o) { return toSigned16(data[o] | (data[o + 1] << 8)); }
  function u16(o) { return data[o] | (data[o + 1] << 8); }
  const sample1 = {
    index: 0,
    accelX: s16(7), accelY: s16(9), accelZ: s16(11),
    accelA: s16(13), accelB: s16(15), accelC: s16(17),
    veloX: s16(19), veloY: s16(21), veloZ: s16(23),
    veloA: s16(25), veloB: s16(27), veloC: s16(29),
    jitter: u16(31),
  };
  const sample2 = {
    index: 1,
    accelX: s16(33), accelY: s16(35), accelZ: s16(37),
    accelA: s16(39), accelB: s16(41), accelC: s16(43),
    veloX: s16(45), veloY: s16(47), veloZ: s16(49),
    veloA: s16(51), veloB: s16(53), veloC: s16(55),
  };
  return { baseTimestamp, expectedPeriod, errorFlags, samples: [sample1, sample2] };
}

function decodeGpsTimesync(data) {
  return {
    timestampUs: getUnsigned32LE(data, 0),
    utcMsOfDay: getUnsigned32LE(data, 4),
    utcDate: getUnsigned32LE(data, 8),
    fixValid: data[12],
    fixQuality: data[13],
    satellites: data[14],
    headingValid: data[15],
    sentenceCount: getUnsigned32LE(data, 16),
    rmcCount: getUnsigned32LE(data, 20),
    ggaCount: getUnsigned32LE(data, 24),
    pqtmtarCount: getUnsigned32LE(data, 28),
    errorFlags: data[63],
  };
}

function decodeGpsPos(data) {
  return {
    timestampUs: getUnsigned32LE(data, 0),
    latDeg: getSigned32LE(data, 4) / 1e7,
    lonDeg: getSigned32LE(data, 8) / 1e7,
    altM: getSigned32LE(data, 12) / 1000.0,
    hdop: getUnsigned16LE(data, 16) / 100.0,
    fixValid: data[18],
    fixQuality: data[19],
    satellites: data[20],
    errorFlags: data[63],
  };
}

function decodeGpsNav(data) {
  return {
    timestampUs: getUnsigned32LE(data, 0),
    velMps: getUnsigned32LE(data, 4) / 100.0,
    courseDeg: getSigned32LE(data, 8) / 100.0,
    headingDeg: getSigned32LE(data, 12) / 100.0,
    headingAccDeg: getUnsigned16LE(data, 16) / 100.0,
    headingValid: data[18],
    headingQuality: data[19],
    baselineM: getUnsigned32LE(data, 20) / 1000.0,
    pitchDeg: getSigned32LE(data, 24) / 100.0,
    errorFlags: data[63],
  };
}

// ---------------------------------------------------------------------------
// IMU simple frames (0x4F5-0x4FA) — 6-byte accel / attitude frames
// These are separate from the 64-byte IMU FD frames.
// ---------------------------------------------------------------------------

function decodeImuSimpleFrame(id, data) {
  if (data.length < 6) return null;
  const boardIdx = (id - 0x4F5) >> 1;      // 0, 1, 2
  const isAccel  = ((id - 0x4F5) & 1) === 0; // even = accel, odd = attitude
  const meta = idMeta(id);
  if (isAccel) {
    return {
      boardType: 'imu_accel',
      boardId: boardIdx,
      ...meta,
      accelX: toSigned16(data[0] | (data[1] << 8)),
      accelY: toSigned16(data[2] | (data[3] << 8)),
      accelZ: toSigned16(data[4] | (data[5] << 8)),
      cal:    data.length >= 7 ? data[6] : 0,
    };
  } else {
    return {
      boardType: 'imu_att',
      boardId: boardIdx,
      ...meta,
      pitch: toSigned16(data[0] | (data[1] << 8)) / 100.0,
      roll:  toSigned16(data[2] | (data[3] << 8)) / 100.0,
      yaw:   toSigned16(data[4] | (data[5] << 8)) / 100.0,
    };
  }
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a raw CAN frame into a board object identical to what mdu-frame.js
 * produces.  Returns { board } where board may be null if the frame is
 * unrecognised (caller should fall through to decodeStandardCan).
 */
export function parseRawCanFrame(id, dataBytes) {
  // IMU simple frames (0x4F5-0x4FA) are handled by decodeStandardCan in
  // TelemetryContext — return board:null so that path is taken.

  // ----- GPS / SMU legacy 64-byte path (boardType 7) -----------------------
  if ((id === 0x040 || id === 0x041 || id === 0x042) && dataBytes.length >= 64) {
    const data = dataBytes;
    const meta = idMeta(id);
    const board = { boardType: 7, boardId: 0, kind: 'fast', ...meta, timeSinceLastMs: 100, errorFlags: data[63] };
    if (id === 0x040) {
      board.fix_valid    = data[12]; board.fix_quality = data[13];
      board.satellites   = data[14]; board.heading_valid = data[15];
      board.sentence_count = getUnsigned32LE(data, 16);
      board.rmc_count      = getUnsigned32LE(data, 20);
      board.gga_count      = getUnsigned32LE(data, 24);
    } else if (id === 0x041) {
      board.latitude_deg  = getSigned32LE(data, 4) / 1e7;
      board.longitude_deg = getSigned32LE(data, 8) / 1e7;
      board.altitude_m    = getSigned32LE(data, 12) / 1000;
      board.hdop          = getUnsigned16LE(data, 16) / 100;
      board.fix_valid     = data[18]; board.fix_quality = data[19]; board.satellites = data[20];
    } else if (id === 0x042) {
      board.velocity_mps  = getUnsigned32LE(data, 4) / 100;
      board.course_deg    = getSigned32LE(data, 8) / 100;
      board.heading_deg   = getSigned32LE(data, 12) / 100;
      board.heading_accuracy_deg = getUnsigned16LE(data, 16) / 100;
      board.heading_valid = data[18]; board.heading_quality = data[19];
    }
    return { board };
  }

  // ----- Bit-packed 11-bit ID scheme ---------------------------------------
  const boardType = (id >> 6) & 0x0F;
  const boardId   = (id >> 3) & 0x07;
  const sensorNum = id & 0x07;
  const meta = idMeta(id);

  // SDU (boardType 2)
  if (boardType === 2 && boardId <= 3 && dataBytes.length >= 64) {
    const data = dataBytes;
    const err = data[4] | (data[5] << 8);
    const base = { boardType, boardId, kind: 'fast', ...meta, timeSinceLastMs: 5, errorFlags: err };

    if (sensorNum === 0) {
      const strainBlocks = decodeStrainGaugeBlocks(data);
      return { board: { ...base, strainGaugesMv: strainBlocks[0]?.strainGaugesMv ?? [], strainBlocks } };
    }
    if (sensorNum === 1) {
      const shockSamples = decodeSensorSamples(data, 19, 100);
      return { board: { ...base, shockMm: shockSamples[0]?.value ?? 0, shockSamples } };
    }
    if (sensorNum === 2) {
      const brakeSamples = decodeSensorSamples(data, 19, 10);
      return { board: { ...base, kind: 'slow', timeSinceLastMs: 100, brakeC: brakeSamples[0]?.value ?? 0, brakeAmbientC: 25.0, brakeSamples } };
    }
    if (sensorNum === 3) {
      const tireBlocks = decodeTireHistoryBlocks(data);
      const t = tireBlocks[0] ?? { max: 0, min: 0, center: 0, ambient: 0 };
      return { board: { ...base, kind: 'slow', timeSinceLastMs: 100, tireC: { max: t.max, min: t.min, center: t.center, ambient: t.ambient }, tireBlocks } };
    }
    if (sensorNum === 4) {
      const wheelSamples = decodeSensorSamples(data, 19, 10);
      return { board: { ...base, kind: 'slow', timeSinceLastMs: 100, rpm: wheelSamples[0]?.value ?? 0, wheelSamples } };
    }
  }

  // TSHMU (boardType 4)
  if (boardType === 4 && dataBytes.length >= 64) {
    const data = dataBytes;
    const err = data[4] | (data[5] << 8);
    const base = { boardType, boardId, ...meta, errorFlags: err };

    if (sensorNum === 2) {
      const flowBlocks = decodeFlowBlocks(data);
      return { board: { ...base, kind: 'slow', timeSinceLastMs: 600,
        raw1:  flowBlocks[0]?.raw1  ?? 0, flow1: flowBlocks[0]?.flow1 ?? 0,
        raw2:  flowBlocks[0]?.raw2  ?? 0, flow2: flowBlocks[0]?.flow2 ?? 0,
        jitter: flowBlocks[0]?.jitter ?? 0, flowBlocks } };
    }
    if (sensorNum === 3) {
      const tempBlocks = decodeTshmuTempBlocks(data);
      const l = tempBlocks[0] ?? {};
      return { board: { ...base, kind: 'fast', timeSinceLastMs: 600,
        temp1: l.temp1 ?? 0, temp2: l.temp2 ?? 0, temp3: l.temp3 ?? 0,
        temp4: l.temp4 ?? 0, temp5: l.temp5 ?? 0, temp6: l.temp6 ?? 0,
        jitterMs: l.jitterMs ?? 0, tempBlocks } };
    }
  }

  // TSPMU (boardType 6)
  if (boardType === 6 && dataBytes.length >= 64) {
    const data = dataBytes;
    const err = data[62] | (data[63] << 8);
    const base = { boardType, boardId, ...meta, errorFlags: err };

    if (sensorNum === 0) {
      const pressureBlocks = decodeTspmuPressureBlocks(data);
      return { board: { ...base, kind: 'fast', timeSinceLastMs: 45,
        pressure1: pressureBlocks[0]?.pressure1 ?? 0, pressure2: pressureBlocks[0]?.pressure2 ?? 0,
        jitter: pressureBlocks[0]?.jitter ?? 0, pressureBlocks } };
    }
    if (sensorNum === 1) {
      const tempBlocks = decodeTspmuTempBlocks(data);
      return { board: { ...base, kind: 'slow', timeSinceLastMs: 1333,
        tspmuTemp1: tempBlocks[0]?.temp1 ?? 0, tspmuTemp2: tempBlocks[0]?.temp2 ?? 0,
        tspmuTemp3: tempBlocks[0]?.temp3 ?? 0, tspmuTemp4: tempBlocks[0]?.temp4 ?? 0,
        jitterMs: tempBlocks[0]?.jitterMs ?? 0, tempBlocks } };
    }
  }

  // GPS/SMU bit-packed (boardType 1) — same IDs as 0x040-0x07F range
  if (boardType === 1 && dataBytes.length >= 64) {
    const data = dataBytes;
    const base = { boardType, boardId, ...meta, timeSinceLastMs: 100 };

    if (sensorNum === 0) {
      const ts = decodeGpsTimesync(data);
      return { board: { ...base, kind: 'slow', errorFlags: ts.errorFlags, gpsTimesync: ts } };
    }
    if (sensorNum === 1) {
      const pos = decodeGpsPos(data);
      return { board: { ...base, kind: 'slow', timeSinceLastMs: 50, errorFlags: pos.errorFlags, gpsPos: pos } };
    }
    if (sensorNum === 2) {
      const nav = decodeGpsNav(data);
      return { board: { ...base, kind: 'slow', timeSinceLastMs: 50, errorFlags: nav.errorFlags, gpsNav: nav } };
    }
    if (sensorNum === 3) {
      const imuData = decodeImuSamples(data);
      const s = imuData.samples[1];
      return { board: { ...base, kind: 'fast', timeSinceLastMs: 50, errorFlags: imuData.errorFlags,
        baseTimestamp: imuData.baseTimestamp, expectedPeriod: imuData.expectedPeriod,
        samples: imuData.samples,
        accelX: s.accelX, accelY: s.accelY, accelZ: s.accelZ,
        accelA: s.accelA, accelB: s.accelB, accelC: s.accelC,
        veloX: s.veloX, veloY: s.veloY, veloZ: s.veloZ,
        veloA: s.veloA, veloB: s.veloB, veloC: s.veloC,
        jitter: imuData.samples[0].jitter } };
    }
  }

  // Unknown / standard 8-byte CAN — caller should use decodeStandardCan
  return { board: null };
}

/**
 * Convert a hex string (e.g. "A1B2C3") to a plain Array of byte values.
 */
export function hexToBytes(hex) {
  if (!hex || typeof hex !== 'string') return [];
  const bytes = [];
  for (let i = 0; i < hex.length - 1; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}
