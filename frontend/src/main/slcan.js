'use strict';

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
    if (dataHex.length !== dataLength * 2) {
      continue;
    }

    if (!/^[0-9A-Fa-f]*$/.test(dataHex)) {
      return { ok: false, reason: 'non-hex-payload' };
    }

    return {
      ok: true,
      dataLength,
      dataHex: dataHex.toUpperCase(),
    };
  }

  return { ok: false, reason: 'length-payload-mismatch' };
}

function parseSlcanFrame(rawLine) {
  const line = normalizeLine(rawLine);
  if (!line) {
    return { ok: false, reason: 'empty-line', raw: line };
  }

  const frameType = line[0];
  const identifierLength = frameType === 't' ? 3 : frameType === 'T' ? 8 : 0;
  if (!identifierLength) {
    return { ok: false, reason: 'unsupported-frame-type', raw: line };
  }

  if (line.length < 1 + identifierLength + 1) {
    return { ok: false, reason: 'frame-too-short', raw: line };
  }

  const identifierHex = line.slice(1, 1 + identifierLength).toUpperCase();
  if (!/^[0-9A-F]+$/.test(identifierHex)) {
    return { ok: false, reason: 'invalid-identifier', raw: line };
  }

  const lengthAndPayload = parseLengthAndPayload(line.slice(1 + identifierLength));
  if (!lengthAndPayload.ok) {
    return {
      ok: false,
      reason: lengthAndPayload.reason,
      raw: line,
      identifierHex,
    };
  }

  const dataBytes = [];
  for (let index = 0; index < lengthAndPayload.dataHex.length; index += 2) {
    dataBytes.push(Number.parseInt(lengthAndPayload.dataHex.slice(index, index + 2), 16));
  }

  return {
    ok: true,
    raw: line,
    frameType,
    idType: frameType === 't' ? 'standard' : 'extended',
    identifier: Number.parseInt(identifierHex, 16),
    identifierHex,
    idText: `0x${identifierHex}`,
    dataLength: lengthAndPayload.dataLength,
    dataHex: lengthAndPayload.dataHex,
    dataBytes,
  };
}

function parseBinaryFrame(buffer) {
  if (buffer.length < 6) return { ok: false, reason: 'too-short' };
  if (buffer[0] !== 0xAA || buffer[1] !== 0x55) return { ok: false, reason: 'invalid-sync' };

  const idHi = buffer[2];
  const idLo = buffer[3];
  const identifier = (idHi << 8) | idLo;
  const dataLength = buffer[4];
  
  if (buffer.length !== 6 + dataLength) {
    return { ok: false, reason: 'length-mismatch' };
  }

  // Checksum: XOR of everything from ID_HI to last data byte
  let chk = 0;
  for (let i = 2; i < 5 + dataLength; i++) {
    chk ^= buffer[i];
  }
  if (chk !== buffer[5 + dataLength]) {
    return { ok: false, reason: 'invalid-checksum' };
  }

  const dataBytes = [];
  for (let i = 0; i < dataLength; i++) {
    dataBytes.push(buffer[5 + i]);
  }

  const identifierHex = identifier.toString(16).toUpperCase().padStart(3, '0');

  let rawHex = '';
  for (let i = 0; i < buffer.length; i++) {
    rawHex += buffer[i].toString(16).padStart(2, '0').toUpperCase() + ' ';
  }
  rawHex = rawHex.trim();

  let dataHex = '';
  for (let i = 0; i < dataBytes.length; i++) {
    dataHex += dataBytes[i].toString(16).padStart(2, '0').toUpperCase();
  }

  return {
    ok: true,
    raw: rawHex,
    frameType: 't',
    idType: 'standard',
    identifier,
    identifierHex,
    idText: `0x${identifierHex}`,
    dataLength,
    dataHex,
    dataBytes,
  };
}

module.exports = {
  normalizeLine,
  parseSlcanFrame,
  parseBinaryFrame,
};
