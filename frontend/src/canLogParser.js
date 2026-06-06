function toSigned8(value) {
  return value > 127 ? value - 256 : value;
}

function toSigned16(value) {
  return value > 32767 ? value - 65536 : value;
}

function getUnsigned16LE(data, offset) {
  return data[offset] | (data[offset + 1] << 8);
}

function getUnsigned32LE(data, offset) {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function getSigned32LE(data, offset) {
  const raw = getUnsigned32LE(data, offset);
  return raw > 0x7FFFFFFF ? raw - 0x100000000 : raw;
}

function hexToBytes(value, expectedLength = null) {
  const cleaned = String(value ?? '').replace(/[^0-9a-fA-F]/g, '');
  if (!cleaned || cleaned.length % 2 !== 0) {
    return [];
  }

  const bytes = [];
  for (let index = 0; index < cleaned.length; index += 2) {
    bytes.push(Number.parseInt(cleaned.slice(index, index + 2), 16));
  }

  if (typeof expectedLength === 'number' && expectedLength >= 0) {
    return bytes.slice(0, expectedLength);
  }
  return bytes;
}

function normalizeLine(rawLine) {
  return String(rawLine ?? '').replace(/\0/g, '').trim();
}

function parseLengthAndPayload(remainder) {
  for (const digits of [2, 1]) {
    const lengthText = remainder.slice(0, digits);
    if (lengthText.length !== digits || !/^\d+$/.test(lengthText)) {
      continue;
    }

    const dataLength = Number.parseInt(lengthText, 10);
    if (dataLength > 64) {
      continue;
    }

    const dataHex = remainder.slice(digits);
    if (dataHex.length !== dataLength * 2 || !/^[0-9A-Fa-f]*$/.test(dataHex)) {
      continue;
    }

    return {
      ok: true,
      dataLength,
      dataHex: dataHex.toUpperCase(),
    };
  }

  return { ok: false };
}

function parseSlcanFrame(rawLine) {
  const line = normalizeLine(rawLine);
  if (!line) {
    return { ok: false };
  }

  const frameType = line[0];
  const identifierLength = frameType === 't' ? 3 : frameType === 'T' ? 8 : 0;
  if (!identifierLength || line.length < 1 + identifierLength + 1) {
    return { ok: false };
  }

  const identifierHex = line.slice(1, 1 + identifierLength).toUpperCase();
  if (!/^[0-9A-F]+$/.test(identifierHex)) {
    return { ok: false };
  }

  const lengthAndPayload = parseLengthAndPayload(line.slice(1 + identifierLength));
  if (!lengthAndPayload.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    identifier: Number.parseInt(identifierHex, 16),
    dataLength: lengthAndPayload.dataLength,
    dataBytes: hexToBytes(lengthAndPayload.dataHex, lengthAndPayload.dataLength),
  };
}

const FAST_PATTERN = /^\[B(\d+)\s+ID\s+([0-9A-Fa-f]+)\s+Fast\]\s+(?:Seq:\d+\s*\|\s*)?dT:(\d+)ms\s*\|\s*SG\[mV\]:\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\s*\|\s*Shock:\s*(-?\d+)\.(\d{2})\s*mm$/;
const SLOW_PATTERN = /^\[B(\d+)\s+ID\s+([0-9A-Fa-f]+)\s+Slow\]\s+(?:Seq:\d+\s*\|\s*)?dT:(\d+)ms\s*\|\s*RPM:\s*(-?\d+)\s*\|\s*Tire\[Max:\s*(-?\d+)\.(\d+)\s+Min:\s*(-?\d+)\.(\d+)\s+Ctr:\s*(-?\d+)\.(\d+)\s+Amb:\s*(-?\d+)\.(\d+)\]\s+Brk:\s*(-?\d+)\.(\d+)\s+Amb:\s*(-?\d+)\.(\d+)$/;

function combineSignedDecimal(intText, fracText) {
  const intPart = Number.parseInt(intText, 10);
  const fracDigits = fracText.length;
  const fracMagnitude = Number.parseInt(fracText, 10) / Math.pow(10, fracDigits);
  return String(intText).trim().startsWith('-') ? intPart - fracMagnitude : intPart + fracMagnitude;
}

function parseLegacyMduLineToSignals(rawLine) {
  const line = normalizeLine(rawLine);
  const fastMatch = line.match(FAST_PATTERN);
  if (fastMatch) {
    const canId = Number.parseInt(fastMatch[2], 16);
    const boardType = (canId >> 6) & 0x0F;
    const boardIndex = (canId >> 3) & 0x07;
    const sensorNum = canId & 0x07;
    if (boardType === 2 && boardIndex <= 3 && sensorNum === 1) {
      return { [`sdu[${boardIndex}].shock`]: combineSignedDecimal(fastMatch[10], fastMatch[11]) };
    }
    return null;
  }

  const slowMatch = line.match(SLOW_PATTERN);
  if (!slowMatch) {
    return null;
  }

  const canId = Number.parseInt(slowMatch[2], 16);
  const boardType = (canId >> 6) & 0x0F;
  const boardIndex = (canId >> 3) & 0x07;
  const sensorNum = canId & 0x07;

  if (boardType === 2 && boardIndex <= 3) {
    if (sensorNum === 2) {
      return { [`sdu[${boardIndex}].brake`]: combineSignedDecimal(slowMatch[13], slowMatch[14]) };
    }
    if (sensorNum === 3) {
      return {
        [`sdu[${boardIndex}].tire[0]`]: combineSignedDecimal(slowMatch[5], slowMatch[6]),
        [`sdu[${boardIndex}].tire[1]`]: combineSignedDecimal(slowMatch[7], slowMatch[8]),
        [`sdu[${boardIndex}].tire[2]`]: combineSignedDecimal(slowMatch[9], slowMatch[10]),
        [`sdu[${boardIndex}].tire[3]`]: combineSignedDecimal(slowMatch[11], slowMatch[12]),
      };
    }
    if (sensorNum === 4) {
      return { [`sdu[${boardIndex}].wrpm`]: Number.parseInt(slowMatch[4], 10) };
    }
  }

  if (boardType === 6 && boardIndex <= 3 && sensorNum === 1) {
    return {
      [`tspmu[${boardIndex}].temps[0]`]: combineSignedDecimal(slowMatch[5], slowMatch[6]),
      [`tspmu[${boardIndex}].temps[1]`]: combineSignedDecimal(slowMatch[7], slowMatch[8]),
      [`tspmu[${boardIndex}].temps[2]`]: combineSignedDecimal(slowMatch[9], slowMatch[10]),
      [`tspmu[${boardIndex}].temps[3]`]: combineSignedDecimal(slowMatch[11], slowMatch[12]),
    };
  }

  return null;
}

function parseCanId(row) {
  if (Number.isFinite(Number(row.id_dec))) {
    return Number(row.id_dec);
  }

  const rawHex = String(row.id_hex ?? '').trim();
  if (!rawHex) {
    return null;
  }

  const normalized = rawHex.replace(/^0x/i, '');
  const canId = Number.parseInt(normalized, 16);
  return Number.isFinite(canId) ? canId : null;
}

function decodeSensorSamples(data, sampleCount, scaleFactor) {
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = 6 + index * 3;
    if (offset + 2 >= data.length) {
      break;
    }
    const rawVal = data[offset] | (data[offset + 1] << 8);
    samples.push({
      index,
      value: rawVal / scaleFactor,
      jitterUs: toSigned8(data[offset + 2]),
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

function decodeStrainGaugeBlocks(data) {
  const blocks = [];
  for (let index = 0; index < 5; index += 1) {
    const offset = 6 + index * 10;
    if (offset + 9 >= data.length) {
      break;
    }

    const ch1Upper = data[offset];
    const ch2Upper = data[offset + 1];
    const ch1Ch2Lower = data[offset + 2];
    const ch3Upper = data[offset + 3];
    const ch4Upper = data[offset + 4];
    const ch3Ch4Lower = data[offset + 5];
    const ch5Upper = data[offset + 6];
    const ch6Upper = data[offset + 7];
    const ch5Ch6Lower = data[offset + 8];

    const rawVals = [
      (ch1Upper << 4) | (ch1Ch2Lower >> 4),
      (ch2Upper << 4) | (ch1Ch2Lower & 0x0F),
      (ch3Upper << 4) | (ch3Ch4Lower >> 4),
      (ch4Upper << 4) | (ch3Ch4Lower & 0x0F),
      (ch5Upper << 4) | (ch5Ch6Lower >> 4),
      (ch6Upper << 4) | (ch5Ch6Lower & 0x0F),
    ];

    blocks.push({
      index,
      channelsMv: rawVals.map((entry) => Math.round((entry / 4095.0) * 6600.0 - 3300.0)),
    });
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
    blocks.push({
      index,
      raw1: getUnsigned16LE(data, offset),
      flow1: getUnsigned16LE(data, offset + 2) / 10.0,
      raw2: getUnsigned16LE(data, offset + 4),
      flow2: getUnsigned16LE(data, offset + 6) / 10.0,
      jitter: toSigned8(data[offset + 8]),
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
    blocks.push({
      index,
      temp1: toSigned16(getUnsigned16LE(data, offset)) / 1000.0,
      temp2: toSigned16(getUnsigned16LE(data, offset + 2)) / 1000.0,
      temp3: toSigned16(getUnsigned16LE(data, offset + 4)) / 1000.0,
      temp4: toSigned16(getUnsigned16LE(data, offset + 6)) / 1000.0,
      temp5: toSigned16(getUnsigned16LE(data, offset + 8)) / 1000.0,
      temp6: toSigned16(getUnsigned16LE(data, offset + 10)) / 1000.0,
      jitterMs: toSigned8(data[offset + 12]),
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
    blocks.push({
      index,
      pressure1: toSigned16(getUnsigned16LE(data, offset)) / 100.0,
      pressure2: toSigned16(getUnsigned16LE(data, offset + 2)) / 100.0,
      jitter: data[offset + 4],
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
    blocks.push({
      index,
      temp1: toSigned16(getUnsigned16LE(data, offset)) / 10.0,
      temp2: toSigned16(getUnsigned16LE(data, offset + 2)) / 10.0,
      temp3: toSigned16(getUnsigned16LE(data, offset + 4)) / 10.0,
      temp4: toSigned16(getUnsigned16LE(data, offset + 6)) / 10.0,
      jitterMs: toSigned8(data[offset + 8]),
    });
  }
  return blocks;
}

function decodeImuFdFrame(canId, data) {
  const boardIndex = (canId >> 3) & 0x07;
  const sampleAt = (offset) => ({
    ax: toSigned16(getUnsigned16LE(data, offset)) / 1000.0,
    ay: toSigned16(getUnsigned16LE(data, offset + 2)) / 1000.0,
    az: toSigned16(getUnsigned16LE(data, offset + 4)) / 1000.0,
    angAccelA: toSigned16(getUnsigned16LE(data, offset + 6)) / 10.0,
    angAccelB: toSigned16(getUnsigned16LE(data, offset + 8)) / 10.0,
    angAccelC: toSigned16(getUnsigned16LE(data, offset + 10)) / 10.0,
    velX: toSigned16(getUnsigned16LE(data, offset + 12)) / 100.0,
    velY: toSigned16(getUnsigned16LE(data, offset + 14)) / 100.0,
    velZ: toSigned16(getUnsigned16LE(data, offset + 16)) / 100.0,
    gyroX: toSigned16(getUnsigned16LE(data, offset + 18)) / 100.0,
    gyroY: toSigned16(getUnsigned16LE(data, offset + 20)) / 100.0,
    gyroZ: toSigned16(getUnsigned16LE(data, offset + 22)) / 100.0,
  });

  return {
    boardIndex,
    errorFlags: getUnsigned16LE(data, 5),
    samples: [sampleAt(7), sampleAt(33)],
  };
}

function decodeGpsTimesync(data) {
  return {
    fix: data[12],
    fixQuality: data[13],
    satellites: data[14],
    headingValid: data[15],
    utcMsOfDay: getUnsigned32LE(data, 4),
    utcDate: getUnsigned32LE(data, 8),
    sentenceCount: getUnsigned32LE(data, 16),
    rmcCount: getUnsigned32LE(data, 20),
    ggaCount: getUnsigned32LE(data, 24),
    pqtmtarCount: getUnsigned32LE(data, 28),
    errorFlags: data[63],
  };
}

function decodeGpsPos(data) {
  return {
    lat: getSigned32LE(data, 4) / 10000000.0,
    lon: getSigned32LE(data, 8) / 10000000.0,
    alt: getSigned32LE(data, 12) / 1000.0,
    hdop: getUnsigned16LE(data, 16) / 100.0,
    fix: data[18],
    fixQuality: data[19],
    satellites: data[20],
    errorFlags: data[63],
  };
}

function decodeGpsNav(data) {
  return {
    vel: getUnsigned32LE(data, 4) / 100.0,
    course: getSigned32LE(data, 8) / 100.0,
    hdg: getSigned32LE(data, 12) / 100.0,
    headingAccuracyDeg: getUnsigned16LE(data, 16) / 100.0,
    headingValid: data[18],
    headingQuality: data[19],
    baselineM: getUnsigned32LE(data, 20) / 1000.0,
    pitchDeg: getSigned32LE(data, 24) / 100.0,
    errorFlags: data[63],
  };
}

function decodeCanFrameToSignals(canId, data) {
  if (!Array.isArray(data) || data.length < 64) {
    return null;
  }

  if (canId === 0x040) {
    const decoded = decodeGpsTimesync(data);
    return {
      'gps.fix': decoded.fix,
      'gps.fix_quality': decoded.fixQuality,
      'gps.sats': decoded.satellites,
      'gps.heading_valid': decoded.headingValid,
      'gps.utc_ms_of_day': decoded.utcMsOfDay,
      'gps.utc_date': decoded.utcDate,
      'gps.sentence_count': decoded.sentenceCount,
      'gps.rmc_count': decoded.rmcCount,
      'gps.gga_count': decoded.ggaCount,
      'gps.pqtmtar_count': decoded.pqtmtarCount,
      'gps.error_flags': decoded.errorFlags,
    };
  }

  if (canId === 0x041) {
    const decoded = decodeGpsPos(data);
    return {
      'gps.lat': decoded.lat,
      'gps.lon': decoded.lon,
      'gps.alt': decoded.alt,
      'gps.hdop': decoded.hdop,
      'gps.fix': decoded.fix,
      'gps.fix_quality': decoded.fixQuality,
      'gps.sats': decoded.satellites,
      'gps.error_flags': decoded.errorFlags,
    };
  }

  if (canId === 0x042) {
    const decoded = decodeGpsNav(data);
    return {
      'gps.vel': decoded.vel,
      'gps.course_deg': decoded.course,
      'gps.hdg': decoded.hdg,
      'gps.heading_accuracy_deg': decoded.headingAccuracyDeg,
      'gps.heading_valid': decoded.headingValid,
      'gps.heading_quality': decoded.headingQuality,
      'gps.baseline_m': decoded.baselineM,
      'gps.pitch_deg': decoded.pitchDeg,
      'gps.error_flags': decoded.errorFlags,
    };
  }

  if (canId === 0x043 || canId === 0x04B || canId === 0x053) {
    const decoded = decodeImuFdFrame(canId, data);
    const latest = decoded.samples[decoded.samples.length - 1];
    const prefix = `imu[${decoded.boardIndex}]`;
    return {
      [`${prefix}.ax`]: latest.ax,
      [`${prefix}.ay`]: latest.ay,
      [`${prefix}.az`]: latest.az,
      [`${prefix}.ang_accel_a`]: latest.angAccelA,
      [`${prefix}.ang_accel_b`]: latest.angAccelB,
      [`${prefix}.ang_accel_c`]: latest.angAccelC,
      [`${prefix}.vel_x`]: latest.velX,
      [`${prefix}.vel_y`]: latest.velY,
      [`${prefix}.vel_z`]: latest.velZ,
      [`${prefix}.gyro_x`]: latest.gyroX,
      [`${prefix}.gyro_y`]: latest.gyroY,
      [`${prefix}.gyro_z`]: latest.gyroZ,
      [`${prefix}.error_flags`]: decoded.errorFlags,
    };
  }

  const boardType = (canId >> 6) & 0x0F;
  const boardIndex = (canId >> 3) & 0x07;
  const sensorNum = canId & 0x07;

  if (boardType === 2 && boardIndex <= 3) {
    const prefix = `sdu[${boardIndex}]`;

    if (sensorNum === 0) {
      const blocks = decodeStrainGaugeBlocks(data);
      const latest = blocks[blocks.length - 1];
      if (!latest) {
        return null;
      }
      return Object.fromEntries(latest.channelsMv.map((value, index) => [`${prefix}.strain[${index}]`, value]));
    }

    if (sensorNum === 1) {
      const samples = decodeSensorSamples(data, 19, 100.0);
      const latest = samples[samples.length - 1];
      return latest ? { [`${prefix}.shock`]: latest.value } : null;
    }

    if (sensorNum === 2) {
      const samples = decodeSensorSamples(data, 19, 10.0);
      const latest = samples[samples.length - 1];
      return latest ? { [`${prefix}.brake`]: latest.value } : null;
    }

    if (sensorNum === 3) {
      const blocks = decodeTireHistoryBlocks(data);
      const latest = blocks[blocks.length - 1];
      if (!latest) {
        return null;
      }
      return {
        [`${prefix}.tire[0]`]: latest.max,
        [`${prefix}.tire[1]`]: latest.min,
        [`${prefix}.tire[2]`]: latest.center,
        [`${prefix}.tire[3]`]: latest.ambient,
      };
    }

    if (sensorNum === 4) {
      const samples = decodeSensorSamples(data, 19, 10.0);
      const latest = samples[samples.length - 1];
      return latest ? { [`${prefix}.wrpm`]: latest.value } : null;
    }
  }

  if (boardType === 4) {
    if (sensorNum === 2) {
      const blocks = decodeFlowBlocks(data);
      const latest = blocks[blocks.length - 1];
      if (!latest) {
        return null;
      }
      return {
        'tshmu.flow1': latest.flow1,
        'tshmu.flow2': latest.flow2,
        'tshmu.raw1': latest.raw1,
        'tshmu.raw2': latest.raw2,
        'tshmu.jitter_us': latest.jitter,
      };
    }

    if (sensorNum === 3) {
      const blocks = decodeTshmuTempBlocks(data);
      const latest = blocks[blocks.length - 1];
      if (!latest) {
        return null;
      }
      return {
        'tshmu.temp1': latest.temp1,
        'tshmu.temp2': latest.temp2,
        'tshmu.temp3': latest.temp3,
        'tshmu.temp4': latest.temp4,
        'tshmu.temp5': latest.temp5,
        'tshmu.temp6': latest.temp6,
      };
    }
  }

  if (boardType === 6) {
    const prefix = `tspmu[${boardIndex}]`;

    if (sensorNum === 0) {
      const blocks = decodeTspmuPressureBlocks(data);
      const latest = blocks[blocks.length - 1];
      return latest ? {
        [`${prefix}.p1`]: latest.pressure1,
        [`${prefix}.p2`]: latest.pressure2,
      } : null;
    }

    if (sensorNum === 1) {
      const blocks = decodeTspmuTempBlocks(data);
      const latest = blocks[blocks.length - 1];
      if (!latest) {
        return null;
      }
      return {
        [`${prefix}.temps[0]`]: latest.temp1,
        [`${prefix}.temps[1]`]: latest.temp2,
        [`${prefix}.temps[2]`]: latest.temp3,
        [`${prefix}.temps[3]`]: latest.temp4,
      };
    }
  }

  return null;
}

export function isRawCanLogHeaders(headers = []) {
  const headerSet = new Set(headers);
  return headerSet.has('ts') && headerSet.has('data_hex') && (headerSet.has('id_dec') || headerSet.has('id_hex'));
}

export function decodeRawCanLogRows(rawRows, filename) {
  const snapshot = {};
  const decodedRows = [];
  const seenHeaders = new Set();

  rawRows.forEach((rawRow) => {
    const ts = Number(rawRow.ts);
    if (!Number.isFinite(ts)) {
      return;
    }

    const canId = parseCanId(rawRow);
    if (!Number.isFinite(canId)) {
      return;
    }

    const dlc = Number(rawRow.dlc);
    const bytes = hexToBytes(rawRow.data_hex, Number.isFinite(dlc) ? dlc : null);
    const updates = decodeCanFrameToSignals(canId, bytes);
    if (!updates || !Object.keys(updates).length) {
      return;
    }

    Object.assign(snapshot, updates);
    Object.keys(updates).forEach((header) => seenHeaders.add(header));
    decodedRows.push({ ts, ...snapshot });
  });

  if (!decodedRows.length) {
    return {
      filename,
      headers: [],
      rows: [],
      sourceType: 'raw-can-decoded',
    };
  }

  return {
    filename,
    headers: ['ts', ...Array.from(seenHeaders).sort((left, right) => left.localeCompare(right))],
    rows: decodedRows,
    sourceType: 'raw-can-decoded',
  };
}

export function decodeSerialLineToSignalUpdates(rawLine) {
  const slcan = parseSlcanFrame(rawLine);
  if (slcan.ok) {
    return decodeCanFrameToSignals(slcan.identifier, slcan.dataBytes);
  }
  return parseLegacyMduLineToSignals(rawLine);
}