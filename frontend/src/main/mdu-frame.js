'use strict';

const { parseSlcanFrame } = require('./slcan');

const ANSI_ESCAPE = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;

const FAST_PATTERN = /^\[B(\d+)\s+ID\s+([0-9A-Fa-f]+)\s+Fast\]\s+(?:Seq:\d+\s*\|\s*)?dT:(\d+)ms\s*\|\s*SG\[mV\]:\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\s*\|\s*Shock:\s*(-?\d+)\.(\d{2})\s*mm$/;

const SLOW_PATTERN = /^\[B(\d+)\s+ID\s+([0-9A-Fa-f]+)\s+Slow\]\s+(?:Seq:\d+\s*\|\s*)?dT:(\d+)ms\s*\|\s*RPM:\s*(-?\d+)\s*\|\s*Tire\[Max:\s*(-?\d+)\.(\d+)\s+Min:\s*(-?\d+)\.(\d+)\s+Ctr:\s*(-?\d+)\.(\d+)\s+Amb:\s*(-?\d+)\.(\d+)\]\s+Brk:\s*(-?\d+)\.(\d+)\s+Amb:\s*(-?\d+)\.(\d+)$/;

const lastSeenTimes = new Map();
const lastSeqByBoard = new Map();

function getCalculatedDeltaMs(identifier, rawDeltaMs) {
  const now = Date.now();
  const lastSeen = lastSeenTimes.get(identifier);
  lastSeenTimes.set(identifier, now);
  if (lastSeen === undefined) {
    return rawDeltaMs;
  }
  return now - lastSeen;
}
function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0').toUpperCase();
  }
  return hex;
}

function stripAnsiAndControl(text) {
  return String(text ?? '').replace(ANSI_ESCAPE, '').replace(/[\x00\x07\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function normalizeMduLine(rawLine) {
  return stripAnsiAndControl(rawLine).trim();
}

function combineSignedDecimal(intText, fracText) {
  const intPart = Number.parseInt(intText, 10);
  const fracDigits = fracText.length;
  const fracMagnitude = Number.parseInt(fracText, 10) / Math.pow(10, fracDigits);
  if (intText.trim().startsWith('-')) {
    return intPart - fracMagnitude;
  }
  return intPart + fracMagnitude;
}

function buildIdMeta(idHex) {
  const upper = idHex.toUpperCase().padStart(3, '0');
  return {
    identifier: Number.parseInt(upper, 16),
    identifierHex: upper,
    idText: `0x${upper}`,
  };
}

function toSigned8(value) {
  return value > 127 ? value - 256 : value;
}

function toSigned16(value) {
  return value > 32767 ? value - 65536 : value;
}

function decodeStrainGaugeBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 5; index += 1) {
    const offset = 6 + index * 10;
    const ch1_upper = data[offset];
    const ch2_upper = data[offset + 1];
    const ch1_ch2_lower = data[offset + 2];
    const ch3_upper = data[offset + 3];
    const ch4_upper = data[offset + 4];
    const ch3_ch4_lower = data[offset + 5];
    const ch5_upper = data[offset + 6];
    const ch6_upper = data[offset + 7];
    const ch5_ch6_lower = data[offset + 8];
    const jitterUs = toSigned8(data[offset + 9]);

    const val1 = (ch1_upper << 4) | (ch1_ch2_lower >> 4);
    const val2 = (ch2_upper << 4) | (ch1_ch2_lower & 0x0F);
    const val3 = (ch3_upper << 4) | (ch3_ch4_lower >> 4);
    const val4 = (ch4_upper << 4) | (ch3_ch4_lower & 0x0F);
    const val5 = (ch5_upper << 4) | (ch5_ch6_lower >> 4);
    const val6 = (ch6_upper << 4) | (ch5_ch6_lower & 0x0F);

    const strainGaugesMv = [val1, val2, val3, val4, val5, val6].map((v) => {
      return Math.round((v / 4095.0) * 6600.0 - 3300.0);
    });

    blocks.push({
      index,
      strainGaugesMv,
      jitterUs,
    });
  }
  return blocks;
}

function decodeSensorSamples(data, sampleCount, scaleFactor) {
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = 6 + index * 3;
    if (offset + 2 >= data.length) {
      break;
    }
    const rawVal = data[offset] | (data[offset + 1] << 8);
    const value = rawVal / scaleFactor;
    const jitterUs = toSigned8(data[offset + 2]);
    samples.push({
      index,
      value,
      jitterUs,
    });
  }
  return samples;
}

function decodeTireHistoryBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 11; index += 1) {
    const offset = 6 + index * 5;
    if (offset + 4 >= data.length) {
      break;
    }
    blocks.push({
      index,
      max: data[offset],
      min: data[offset + 1],
      center: data[offset + 2],
      ambient: data[offset + 3],
      jitterMs: toSigned8(data[offset + 4]),
    });
  }
  return blocks;
}

function decodeTspmuPressureBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 11; index += 1) {
    const offset = 4 + index * 5;
    if (offset + 4 >= data.length) {
      break;
    }
    const rawP1 = data[offset] | (data[offset + 1] << 8);
    const rawP2 = data[offset + 2] | (data[offset + 3] << 8);
    const pressure1 = toSigned16(rawP1) / 100.0;
    const pressure2 = toSigned16(rawP2) / 100.0;
    const jitter = data[offset + 4];
    blocks.push({
      index,
      pressure1,
      pressure2,
      jitter,
    });
  }
  return blocks;
}

function decodeTshmuTempBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 4; index += 1) {
    const offset = 6 + index * 13;
    if (offset + 12 >= data.length) {
      break;
    }
    const temp1 = toSigned16(data[offset] | (data[offset + 1] << 8)) / 1000.0;
    const temp2 = toSigned16(data[offset + 2] | (data[offset + 3] << 8)) / 1000.0;
    const temp3 = toSigned16(data[offset + 4] | (data[offset + 5] << 8)) / 1000.0;
    const temp4 = toSigned16(data[offset + 6] | (data[offset + 7] << 8)) / 1000.0;
    const temp5 = toSigned16(data[offset + 8] | (data[offset + 9] << 8)) / 1000.0;
    const temp6 = toSigned16(data[offset + 10] | (data[offset + 11] << 8)) / 1000.0;
    const jitterMs = toSigned8(data[offset + 12]);
    blocks.push({ index, temp1, temp2, temp3, temp4, temp5, temp6, jitterMs });
  }
  return blocks;
}

function decodeFlowBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 6; index += 1) {
    const offset = 6 + index * 9;
    if (offset + 8 >= data.length) {
      break;
    }
    const rawR1 = data[offset] | (data[offset + 1] << 8);
    const rawF1 = data[offset + 2] | (data[offset + 3] << 8);
    const rawR2 = data[offset + 4] | (data[offset + 5] << 8);
    const rawF2 = data[offset + 6] | (data[offset + 7] << 8);
    const flow1 = rawF1 / 10.0;
    const flow2 = rawF2 / 10.0;
    const jitter = toSigned8(data[offset + 8]);
    blocks.push({
      index,
      raw1: rawR1,
      flow1,
      raw2: rawR2,
      flow2,
      jitter,
    });
  }
  return blocks;
}

function decodeTspmuTempBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 6; index += 1) {
    const offset = 4 + index * 9;
    if (offset + 8 >= data.length) {
      break;
    }
    const rawT1 = data[offset] | (data[offset + 1] << 8);
    const rawT2 = data[offset + 2] | (data[offset + 3] << 8);
    const rawT3 = data[offset + 4] | (data[offset + 5] << 8);
    const rawT4 = data[offset + 6] | (data[offset + 7] << 8);
    const temp1 = toSigned16(rawT1) / 10.0;
    const temp2 = toSigned16(rawT2) / 10.0;
    const temp3 = toSigned16(rawT3) / 10.0;
    const temp4 = toSigned16(rawT4) / 10.0;
    const jitterMs = toSigned8(data[offset + 8]);
    blocks.push({
      index,
      temp1,
      temp2,
      temp3,
      temp4,
      jitterMs,
    });
  }
  return blocks;
}


function decodeImuSamples(data) {
  const baseTimestamp = (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0;
  const expectedPeriod = data[4];
  const errorFlags = data[5] | (data[6] << 8);

  function getSigned16(offset) {
    const raw = data[offset] | (data[offset + 1] << 8);
    return toSigned16(raw);
  }

  function getUnsigned16(offset) {
    return data[offset] | (data[offset + 1] << 8);
  }

  const sample1 = {
    index: 0,
    accelX: getSigned16(7),
    accelY: getSigned16(9),
    accelZ: getSigned16(11),
    accelA: getSigned16(13),
    accelB: getSigned16(15),
    accelC: getSigned16(17),
    veloX: getSigned16(19),
    veloY: getSigned16(21),
    veloZ: getSigned16(23),
    veloA: getSigned16(25),
    veloB: getSigned16(27),
    veloC: getSigned16(29),
    jitter: getUnsigned16(31)
  };

  const sample2 = {
    index: 1,
    accelX: getSigned16(33),
    accelY: getSigned16(35),
    accelZ: getSigned16(37),
    accelA: getSigned16(39),
    accelB: getSigned16(41),
    accelC: getSigned16(43),
    veloX: getSigned16(45),
    veloY: getSigned16(47),
    veloZ: getSigned16(49),
    veloA: getSigned16(51),
    veloB: getSigned16(53),
    veloC: getSigned16(55)
  };

  return {
    baseTimestamp,
    expectedPeriod,
    errorFlags,
    samples: [sample1, sample2]
  };
}

function decodeGpsTimesync(data) {
  const getU32 = (offset) => (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  return {
    timestampUs: getU32(0),
    utcMsOfDay: getU32(4),
    utcDate: getU32(8),
    fixValid: data[12],
    fixQuality: data[13],
    satellites: data[14],
    headingValid: data[15],
    sentenceCount: getU32(16),
    rmcCount: getU32(20),
    ggaCount: getU32(24),
    pqtmtarCount: getU32(28),
    errorFlags: data[63]
  };
}

function decodeGpsPos(data) {
  const getU32 = (offset) => (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  const getS32 = (offset) => {
    const u32 = getU32(offset);
    return u32 > 0x7FFFFFFF ? u32 - 0x100000000 : u32;
  };
  return {
    timestampUs: getU32(0),
    latDeg: getS32(4) / 10000000.0,
    lonDeg: getS32(8) / 10000000.0,
    altM: getS32(12) / 1000.0,
    hdop: (data[16] | (data[17] << 8)) / 100.0,
    fixValid: data[18],
    fixQuality: data[19],
    satellites: data[20],
    errorFlags: data[63]
  };
}

function decodeGpsNav(data) {
  const getU32 = (offset) => (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  const getS32 = (offset) => {
    const u32 = getU32(offset);
    return u32 > 0x7FFFFFFF ? u32 - 0x100000000 : u32;
  };
  return {
    timestampUs: getU32(0),
    velMps: getU32(4) / 100.0,
    courseDeg: getS32(8) / 100.0,
    headingDeg: getS32(12) / 100.0,
    headingAccDeg: (data[16] | (data[17] << 8)) / 100.0,
    headingValid: data[18],
    headingQuality: data[19],
    baselineM: getU32(20) / 1000.0,
    pitchDeg: getS32(24) / 100.0,
    errorFlags: data[63]
  };
}

function parseFast(match, rawLine) {
  const board = Number.parseInt(match[1], 10);
  const id = buildIdMeta(match[2]);
  const rawDeltaMs = Number.parseInt(match[3], 10);
  const timeSinceLastMs = getCalculatedDeltaMs(id.identifier, rawDeltaMs);
  const strainGaugesMv = [
    Number.parseInt(match[4], 10),
    Number.parseInt(match[5], 10),
    Number.parseInt(match[6], 10),
    Number.parseInt(match[7], 10),
    Number.parseInt(match[8], 10),
    Number.parseInt(match[9], 10),
  ];
  const shockMm = combineSignedDecimal(match[10], match[11]);

  const isTspmu = ((id.identifier >> 6) === 6);
  const boardId = isTspmu ? ((id.identifier >> 3) & 0x07) : board;
  const boardKey = `${isTspmu ? 6 : 2}-${boardId}`;

  const seqMatch = rawLine ? rawLine.match(/Seq:(\d+)/) : null;
  let errorFlags = 0;
  if (seqMatch) {
    const seq = Number.parseInt(seqMatch[1], 10);
    let seqState = lastSeqByBoard.get(boardKey);
    if (!seqState) {
      seqState = { lastSeq: seq, lowestBit: 0 };
    } else {
      if (seq !== seqState.lastSeq) {
        seqState.lowestBit = 0;
        seqState.lastSeq = seq;
      } else {
        seqState.lowestBit = (seqState.lowestBit + 1) & 1;
      }
    }
    lastSeqByBoard.set(boardKey, seqState);
    const counter = ((seq << 1) | seqState.lowestBit) & 0x07;
    errorFlags = counter << 7;
  }

  if (isTspmu) {
    const sensorNum = id.identifier & 0x07;

    if (sensorNum === 1) {
      // 0x181 (TSPMU Temp) is printed as Fast, but it is actually the Temperature (slow) frame!
      // In the printed SDU layout:
      // vals[1] (strainGaugesMv[1]) contains blocks[0].temp2 * 10
      // vals[2] (strainGaugesMv[2]) contains blocks[0].temp4 * 10
      const temp2 = strainGaugesMv[1] / 10.0;
      const temp4 = strainGaugesMv[2] / 10.0;
      // Since temp1 and temp3 are not printed in the legacy fast layout, fallback to temp2 and temp4
      const temp1 = temp2;
      const temp3 = temp4;

      const bytes = new Uint8Array(64);
      bytes[62] = errorFlags & 0xFF;
      bytes[63] = (errorFlags >> 8) & 0xFF;
      const t1 = Math.round(temp1 * 10);
      const t2 = Math.round(temp2 * 10);
      const t3 = Math.round(temp3 * 10);
      const t4 = Math.round(temp4 * 10);
      for (let i = 0; i < 6; i++) {
        const offset = 4 + i * 9;
        bytes[offset] = t1 & 0xFF;
        bytes[offset + 1] = (t1 >> 8) & 0xFF;
        bytes[offset + 2] = t2 & 0xFF;
        bytes[offset + 3] = (t2 >> 8) & 0xFF;
        bytes[offset + 4] = t3 & 0xFF;
        bytes[offset + 5] = (t3 >> 8) & 0xFF;
        bytes[offset + 6] = t4 & 0xFF;
        bytes[offset + 7] = (t4 >> 8) & 0xFF;
        bytes[offset + 8] = 0;
      }
      const dataBytes = Array.from(bytes);
      const dataHex = bytesToHex(bytes);

      return {
        boardType: 6, // TSPMU
        boardId,
        kind: 'slow',
        ...id,
        timeSinceLastMs,
        tspmuTemp1: temp1,
        tspmuTemp2: temp2,
        tspmuTemp3: temp3,
        tspmuTemp4: temp4,
        jitterMs: 0,
        errorFlags,
        dataBytes,
        dataHex,
        tempBlocks: [{
          index: 0,
          temp1,
          temp2,
          temp3,
          temp4,
          jitterMs: 0
        }]
      };
    }

    // Readings[0].pressure1 was printed as vals[1] (strainGaugesMv[1])
    // readings[0].pressure2 was printed as vals[2] (strainGaugesMv[2])
    const pressure1 = strainGaugesMv[1] / 100.0;
    const pressure2 = strainGaugesMv[2] / 100.0;

    const bytes = new Uint8Array(64);
    bytes[62] = errorFlags & 0xFF;
    bytes[63] = (errorFlags >> 8) & 0xFF;
    const p1 = Math.round(pressure1 * 100);
    const p2 = Math.round(pressure2 * 100);
    for (let i = 0; i < 11; i++) {
      const offset = 4 + i * 5;
      bytes[offset] = p1 & 0xFF;
      bytes[offset + 1] = (p1 >> 8) & 0xFF;
      bytes[offset + 2] = p2 & 0xFF;
      bytes[offset + 3] = (p2 >> 8) & 0xFF;
      bytes[offset + 4] = 0;
    }
    const dataBytes = Array.from(bytes);
    const dataHex = bytesToHex(bytes);

    return {
      boardType: 6, // TSPMU
      boardId,
      kind: 'fast',
      ...id,
      timeSinceLastMs,
      pressure1,
      pressure2,
      jitter: 0,
      errorFlags,
      dataBytes,
      dataHex,
      pressureBlocks: [{
        index: 0,
        pressure1,
        pressure2,
        jitter: 0
      }]
    };
  }

  const bytes = new Uint8Array(64);
  bytes[4] = errorFlags & 0xFF;
  bytes[5] = (errorFlags >> 8) & 0xFF;
  for (let i = 0; i < 6 && i < strainGaugesMv.length; i++) {
    const val = Math.min(4095, Math.max(0, Math.round(((strainGaugesMv[i] + 3300.0) / 6600.0) * 4095.0)));
    const offset = 6 + i * 2;
    bytes[offset] = val & 0xFF;
    bytes[offset + 1] = (val >> 8) & 0xFF;
  }
  const shockVal = Math.round(shockMm * 100);
  bytes[18] = shockVal & 0xFF;
  bytes[19] = (shockVal >> 8) & 0xFF;
  const dataBytes = Array.from(bytes);
  const dataHex = bytesToHex(bytes);

  return {
    boardType: 2,
    boardId: board,
    kind: 'fast',
    ...id,
    timeSinceLastMs,
    strainGaugesMv,
    shockMm,
    errorFlags,
    dataBytes,
    dataHex,
  };
}

function parseSlow(match, rawLine) {
  const board = Number.parseInt(match[1], 10);
  const id = buildIdMeta(match[2]);
  const rawDeltaMs = Number.parseInt(match[3], 10);
  const timeSinceLastMs = getCalculatedDeltaMs(id.identifier, rawDeltaMs);
  const rpm = Number.parseInt(match[4], 10);
  const tireC = {
    max: combineSignedDecimal(match[5], match[6]),
    min: combineSignedDecimal(match[7], match[8]),
    center: combineSignedDecimal(match[9], match[10]),
    ambient: combineSignedDecimal(match[11], match[12]),
  };
  const brakeC = combineSignedDecimal(match[13], match[14]);
  const brakeAmbientC = combineSignedDecimal(match[15], match[16]);

  const isTspmu = ((id.identifier >> 6) === 6);
  const boardId = isTspmu ? ((id.identifier >> 3) & 0x07) : board;
  const boardKey = `${isTspmu ? 6 : 2}-${boardId}`;

  const seqMatch = rawLine ? rawLine.match(/Seq:(\d+)/) : null;
  let errorFlags = 0;
  if (seqMatch) {
    const seq = Number.parseInt(seqMatch[1], 10);
    let seqState = lastSeqByBoard.get(boardKey);
    if (!seqState) {
      seqState = { lastSeq: seq, lowestBit: 0 };
    } else {
      if (seq !== seqState.lastSeq) {
        seqState.lowestBit = 0;
        seqState.lastSeq = seq;
      } else {
        seqState.lowestBit = (seqState.lowestBit + 1) & 1;
      }
    }
    lastSeqByBoard.set(boardKey, seqState);
    const counter = ((seq << 1) | seqState.lowestBit) & 0x07;
    errorFlags = counter << 7;
  }

  if (isTspmu) {
    // For TSPMU temperature frame:
    // readings[0].temp1 is printed as tireC.max
    // readings[0].temp2 is printed as tireC.min
    // readings[0].temp3 is printed as tireC.center
    // readings[0].temp4 is printed as tireC.ambient
    const bytes = new Uint8Array(64);
    bytes[62] = errorFlags & 0xFF;
    bytes[63] = (errorFlags >> 8) & 0xFF;
    const t1 = Math.round(tireC.max * 10);
    const t2 = Math.round(tireC.min * 10);
    const t3 = Math.round(tireC.center * 10);
    const t4 = Math.round(tireC.ambient * 10);
    for (let i = 0; i < 6; i++) {
      const offset = 4 + i * 9;
      bytes[offset] = t1 & 0xFF;
      bytes[offset + 1] = (t1 >> 8) & 0xFF;
      bytes[offset + 2] = t2 & 0xFF;
      bytes[offset + 3] = (t2 >> 8) & 0xFF;
      bytes[offset + 4] = t3 & 0xFF;
      bytes[offset + 5] = (t3 >> 8) & 0xFF;
      bytes[offset + 6] = t4 & 0xFF;
      bytes[offset + 7] = (t4 >> 8) & 0xFF;
      bytes[offset + 8] = 0;
    }
    const dataBytes = Array.from(bytes);
    const dataHex = bytesToHex(bytes);

    return {
      boardType: 6, // TSPMU
      boardId,
      kind: 'slow',
      ...id,
      timeSinceLastMs,
      tspmuTemp1: tireC.max,
      tspmuTemp2: tireC.min,
      tspmuTemp3: tireC.center,
      tspmuTemp4: tireC.ambient,
      jitterMs: 0,
      errorFlags,
      dataBytes,
      dataHex,
      tempBlocks: [{
        index: 0,
        temp1: tireC.max,
        temp2: tireC.min,
        temp3: tireC.center,
        temp4: tireC.ambient,
        jitterMs: 0
      }]
    };
  }

  const bytes = new Uint8Array(64);
  bytes[4] = errorFlags & 0xFF;
  bytes[5] = (errorFlags >> 8) & 0xFF;
  bytes[6] = rpm & 0xFF;
  bytes[7] = (rpm >> 8) & 0xFF;
  const tMax = Math.round(tireC.max * 10);
  const tMin = Math.round(tireC.min * 10);
  const tCtr = Math.round(tireC.center * 10);
  const tAmb = Math.round(tireC.ambient * 10);
  bytes[8] = tMax & 0xFF;
  bytes[9] = (tMax >> 8) & 0xFF;
  bytes[10] = tMin & 0xFF;
  bytes[11] = (tMin >> 8) & 0xFF;
  bytes[12] = tCtr & 0xFF;
  bytes[13] = (tCtr >> 8) & 0xFF;
  bytes[14] = tAmb & 0xFF;
  bytes[15] = (tAmb >> 8) & 0xFF;
  const brk = Math.round(brakeC * 10);
  const brkAmb = Math.round(brakeAmbientC * 10);
  bytes[16] = brk & 0xFF;
  bytes[17] = (brk >> 8) & 0xFF;
  bytes[18] = brkAmb & 0xFF;
  bytes[19] = (brkAmb >> 8) & 0xFF;
  const dataBytes = Array.from(bytes);
  const dataHex = bytesToHex(bytes);

  return {
    boardType: 2,
    boardId: board,
    kind: 'slow',
    ...id,
    timeSinceLastMs,
    rpm,
    tireC,
    brakeC,
    brakeAmbientC,
    errorFlags,
    dataBytes,
    dataHex,
  };
}

function parseMduLine(rawLine) {
  const cleaned = normalizeMduLine(rawLine);
  if (!cleaned) {
    return { ok: false, reason: 'empty-line', raw: cleaned };
  }

  const fastMatch = cleaned.match(FAST_PATTERN);
  if (fastMatch) {
    const board = parseFast(fastMatch, cleaned);
    return {
      ok: true,
      source: 'board',
      raw: cleaned,
      idText: board.idText,
      idType: 'standard',
      identifier: board.identifier,
      identifierHex: board.identifierHex,
      dataLength: 64,
      dataHex: board.dataHex ?? '',
      dataBytes: board.dataBytes ?? [],
      board,
    };
  }

  const slowMatch = cleaned.match(SLOW_PATTERN);
  if (slowMatch) {
    const board = parseSlow(slowMatch, cleaned);
    return {
      ok: true,
      source: 'board',
      raw: cleaned,
      idText: board.idText,
      idType: 'standard',
      identifier: board.identifier,
      identifierHex: board.identifierHex,
      dataLength: 64,
      dataHex: board.dataHex ?? '',
      dataBytes: board.dataBytes ?? [],
      board,
    };
  }

  const slcan = parseSlcanFrame(cleaned);
  if (slcan.ok) {
    return parseSlcanToBoard(slcan, cleaned);
  }

  return {
    ok: false,
    reason: slcan.reason ?? 'unrecognized-line',
    raw: cleaned,
  };
}

function getSigned32LE(data, offset) {
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) | 0
  );
}

function getUnsigned16LE(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

function parseSlcanToBoard(slcan, rawLine) {
  const id = slcan.identifier;

  // GPS COG SMU frames from mk11-smu (FDCAN 64-byte payloads)
  // 0x040 timesync, 0x041 position, 0x042 nav, 0x043 imu (handled by IMU path)
  if ((id === 0x040 || id === 0x041 || id === 0x042) && slcan.dataBytes.length >= 64) {
    const data = slcan.dataBytes;
    const board = {
      boardType: 7,
      boardId: 0,
      kind: 'fast',
      identifier: slcan.identifier,
      identifierHex: slcan.identifierHex,
      idText: slcan.idText,
      timeSinceLastMs: 100,
      errorFlags: data[63],
    };
    if (id === 0x040) {
      board.fix_valid = data[12];
      board.fix_quality = data[13];
      board.satellites = data[14];
      board.heading_valid = data[15];
      board.sentence_count = (data[16] | (data[17] << 8) | (data[18] << 16) | (data[19] << 24)) >>> 0;
      board.rmc_count = (data[20] | (data[21] << 8) | (data[22] << 16) | (data[23] << 24)) >>> 0;
      board.gga_count = (data[24] | (data[25] << 8) | (data[26] << 16) | (data[27] << 24)) >>> 0;
    } else if (id === 0x041) {
      board.latitude_deg = getSigned32LE(data, 4) / 1e7;
      board.longitude_deg = getSigned32LE(data, 8) / 1e7;
      board.altitude_m = getSigned32LE(data, 12) / 1000;
      board.hdop = getUnsigned16LE(data, 16) / 100;
      board.fix_valid = data[18];
      board.fix_quality = data[19];
      board.satellites = data[20];
    } else if (id === 0x042) {
      board.velocity_mps = (data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24)) >>> 0;
      board.velocity_mps = board.velocity_mps / 100;
      board.course_deg = getSigned32LE(data, 8) / 100;
      board.heading_deg = getSigned32LE(data, 12) / 100;
      board.heading_accuracy_deg = getUnsigned16LE(data, 16) / 100;
      board.heading_valid = data[18];
      board.heading_quality = data[19];
    }
    return {
      ok: true,
      source: 'board',
      raw: rawLine,
      idText: slcan.idText,
      idType: slcan.idType,
      identifier: slcan.identifier,
      identifierHex: slcan.identifierHex,
      dataLength: slcan.dataLength,
      dataHex: slcan.dataHex,
      dataBytes: slcan.dataBytes,
      board,
    };
  }

    // Extract bit-packed fields from the 11-bit standard ID
    const boardType = (id >> 6) & 0x0F; // Bits 9-6   (Board Type: 2 for SDU)
    const boardId = (id >> 3) & 0x07; // Bits 5-3   (Board Index: 0 to 3)
    const sensorNum = id & 0x07;        // Bits 2-0   (Sensor Index: 0 to 4 directly at LSB)

    if (boardType === 2 && boardId <= 3 && slcan.dataBytes.length >= 64) {
      const data = slcan.dataBytes;
      const err = data[4] | (data[5] << 8);

      // Sensor 0: Strain Gauges
      if (sensorNum === 0) {
        const strainBlocks = decodeStrainGaugeBlocks(data);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'fast',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 5,
            errorFlags: err,
            strainGaugesMv: strainBlocks[0]?.strainGaugesMv ?? [],
            strainBlocks,
          }
        };
      }

      // Sensor 1: Shock Pots
      if (sensorNum === 1) {
        const shockSamples = decodeSensorSamples(data, 19, 100);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'fast',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 5,
            errorFlags: err,
            shockMm: shockSamples[0]?.value ?? 0,
            shockSamples,
          }
        };
      }

      // Sensor 2: Brake Temp
      if (sensorNum === 2) {
        const brakeSamples = decodeSensorSamples(data, 19, 10);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 100,
            errorFlags: err,
            brakeC: brakeSamples[0]?.value ?? 0,
            brakeAmbientC: 25.0,
            brakeSamples,
          }
        };
      }

      // Sensor 3: Tire Temp
      if (sensorNum === 3) {
        const tireBlocks = decodeTireHistoryBlocks(data);
        const latestTire = tireBlocks[0] ?? { max: 0, min: 0, center: 0, ambient: 0 };
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 100,
            errorFlags: err,
            tireC: {
              max: latestTire.max,
              min: latestTire.min,
              center: latestTire.center,
              ambient: latestTire.ambient,
            },
            tireBlocks,
          }
        };
      }

      // Sensor 4: Wheel Speed
      if (sensorNum === 4) {
        const wheelSamples = decodeSensorSamples(data, 19, 10);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 100,
            errorFlags: err,
            rpm: wheelSamples[0]?.value ?? 0,
            wheelSamples,
          }
        };
      }
    }

    if (boardType === 4 && slcan.dataBytes.length >= 64) {
      const data = slcan.dataBytes;
      const err = data[4] | (data[5] << 8);

      // Sensor 2: Flow Rate
      if (sensorNum === 2) {
        const flowBlocks = decodeFlowBlocks(data);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 600,
            errorFlags: err,
            raw1: flowBlocks[0]?.raw1 ?? 0,
            flow1: flowBlocks[0]?.flow1 ?? 0,
            raw2: flowBlocks[0]?.raw2 ?? 0,
            flow2: flowBlocks[0]?.flow2 ?? 0,
            jitter: flowBlocks[0]?.jitter ?? 0,
            flowBlocks,
          }
        };
      }

      // Sensor 3: Thermistor Temperatures
      if (sensorNum === 3) {
        const tempBlocks = decodeTshmuTempBlocks(data);
        const latest = tempBlocks[0] ?? {};
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'fast',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 600,
            errorFlags: err,
            temp1: latest.temp1 ?? 0,
            temp2: latest.temp2 ?? 0,
            temp3: latest.temp3 ?? 0,
            temp4: latest.temp4 ?? 0,
            temp5: latest.temp5 ?? 0,
            temp6: latest.temp6 ?? 0,
            jitterMs: latest.jitterMs ?? 0,
            tempBlocks,
          }
        };
      }
    }

    if (boardType === 6 && slcan.dataBytes.length >= 64) {
      const data = slcan.dataBytes;
      const err = data[62] | (data[63] << 8);

      // Sensor 0: Pressure
      if (sensorNum === 0) {
        const pressureBlocks = decodeTspmuPressureBlocks(data);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'fast',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 45,
            errorFlags: err,
            pressure1: pressureBlocks[0]?.pressure1 ?? 0,
            pressure2: pressureBlocks[0]?.pressure2 ?? 0,
            jitter: pressureBlocks[0]?.jitter ?? 0,
            pressureBlocks,
          }
        };
      }

      // Sensor 1: Temperature
      if (sensorNum === 1) {
        const tempBlocks = decodeTspmuTempBlocks(data);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 1333,
            errorFlags: err,
            tspmuTemp1: tempBlocks[0]?.temp1 ?? 0,
            tspmuTemp2: tempBlocks[0]?.temp2 ?? 0,
            tspmuTemp3: tempBlocks[0]?.temp3 ?? 0,
            tspmuTemp4: tempBlocks[0]?.temp4 ?? 0,
            jitterMs: tempBlocks[0]?.jitterMs ?? 0,
            tempBlocks,
          }
        };
      }
    }

    if (boardType === 1 && slcan.dataBytes.length >= 64) {
      const data = slcan.dataBytes;
      if (sensorNum === 0) {
        const timesync = decodeGpsTimesync(data);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 100,
            errorFlags: timesync.errorFlags,
            gpsTimesync: timesync,
          }
        };
      } else if (sensorNum === 1) {
        const pos = decodeGpsPos(data);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 50,
            errorFlags: pos.errorFlags,
            gpsPos: pos,
          }
        };
      } else if (sensorNum === 2) {
        const nav = decodeGpsNav(data);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'slow',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 50,
            errorFlags: nav.errorFlags,
            gpsNav: nav,
          }
        };
      } else if (sensorNum === 3) {
        const imuData = decodeImuSamples(data);
        return {
          ok: true,
          source: 'board',
          raw: rawLine,
          idText: slcan.idText,
          idType: slcan.idType,
          identifier: slcan.identifier,
          identifierHex: slcan.identifierHex,
          dataLength: slcan.dataLength,
          dataHex: slcan.dataHex,
          dataBytes: slcan.dataBytes,
          board: {
            boardType,
            boardId,
            kind: 'fast',
            identifier: slcan.identifier,
            identifierHex: slcan.identifierHex,
            idText: slcan.idText,
            timeSinceLastMs: 50,
            errorFlags: imuData.errorFlags,
            baseTimestamp: imuData.baseTimestamp,
            expectedPeriod: imuData.expectedPeriod,
            samples: imuData.samples,
            accelX: imuData.samples[1].accelX,
            accelY: imuData.samples[1].accelY,
            accelZ: imuData.samples[1].accelZ,
            accelA: imuData.samples[1].accelA,
            accelB: imuData.samples[1].accelB,
            accelC: imuData.samples[1].accelC,
            veloX: imuData.samples[1].veloX,
            veloY: imuData.samples[1].veloY,
            veloZ: imuData.samples[1].veloZ,
            veloA: imuData.samples[1].veloA,
            veloB: imuData.samples[1].veloB,
            veloC: imuData.samples[1].veloC,
            jitter: imuData.samples[0].jitter,
          }
        };
      }
    }

    return {
      ok: true,
      source: 'slcan',
      raw: rawLine,
      idText: slcan.idText,
      idType: slcan.idType,
      identifier: slcan.identifier,
      identifierHex: slcan.identifierHex,
      dataLength: slcan.dataLength,
      dataHex: slcan.dataHex,
      dataBytes: slcan.dataBytes,
      board: null,
    };
}

module.exports = {
  parseMduLine,
  parseSlcanToBoard,
  normalizeMduLine,
  stripAnsiAndControl,
};
