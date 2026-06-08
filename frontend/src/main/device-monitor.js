'use strict';

const { EventEmitter } = require('events');
const { SerialPort } = require('serialport');

const { LogWriter } = require('./log-writer');
const { parseMduLine, parseSlcanToBoard } = require('./mdu-frame');
const { TARGET_HUB_PID, TARGET_HUB_VID, scanUsbTopology } = require('./usb-topology');
const { parseBinaryFrame } = require('./slcan');

const TARGET_VID = '0483';
const TARGET_PID = '5740';
const DEFAULT_BAUD_RATE = 115200;
const PORT_SCAN_INTERVAL_MS = 1500;
const DIAGNOSTICS_INTERVAL_MS = 50;
const USB_TOPOLOGY_SCAN_INTERVAL_MS = 5000;

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
  if (!value) {
    return null;
  }

  const stripped = String(value).replace(/^0x/i, '').trim().toUpperCase();
  if (!stripped) {
    return null;
  }

  return stripped.padStart(4, '0');
}

function locationPrefix(value) {
  const match = String(value ?? '').match(/0x([0-9a-fA-F]{3})/);
  if (!match) {
    return null;
  }

  return match[1].toUpperCase();
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
    displayName: port.path,
    usbBacked,
    bluetoothLike,
    matchesTarget: vendorId === TARGET_VID && productId === TARGET_PID,
    mirrorEligible: usbBacked && !bluetoothLike,
  };
}

function formatMirrorPath(port) {
  if (!port) {
    return 'No USB CDC endpoint selected';
  }

  const hubPath = port.locationId ? `hub path ${port.locationId}` : 'hub path unavailable';
  const usbId = port.vendorId && port.productId ? `${port.vendorId}:${port.productId}` : 'USB ID unavailable';
  return `${port.path} · ${usbId} · ${hubPath}`;
}

function formatHubPath(hub) {
  if (!hub) {
    return 'USB2514 hub not detected';
  }

  const usbId = hub.vendorId && hub.productId ? `${hub.vendorId}:${hub.productId}` : 'USB ID unavailable';
  const location = hub.locationId ?? 'unknown location';
  return `${hub.name} · ${usbId} · ${location}`;
}

class DiagnosticsTracker {
  constructor() {
    this.reset();
  }

  reset(now = Date.now()) {
    this.sessionStartedAt = now;
    this.connectionStartedAt = 0;
    this.totalBytes = 0;
    this.totalLines = 0;
    this.totalFrames = 0;
    this.boardFrames = 0;
    this.slcanFrames = 0;
    this.payloadBytes = 0;
    this.parseErrors = 0;
    this.standardFrames = 0;
    this.extendedFrames = 0;
    this.lastChunkAt = 0;
    this.lastFrameAt = 0;
    this.byteEvents = [];
    this.frameEvents = [];
    this.ids = new Map();
  }

  setConnected(connected, now = Date.now()) {
    this.connectionStartedAt = connected ? now : 0;
  }

  clearSession(now = Date.now()) {
    const wasConnected = this.connectionStartedAt !== 0;
    this.reset(now);
    if (wasConnected) {
      this.connectionStartedAt = now;
    }
  }

  recordChunk(byteLength, now = Date.now()) {
    this.totalBytes += byteLength;
    this.lastChunkAt = now;
    this.byteEvents.push({ now, byteLength });
  }

  recordLine(parsedFrame, now = Date.now()) {
    this.totalLines += 1;

    if (!parsedFrame.ok) {
      this.parseErrors += 1;
      return;
    }

    this.totalFrames += 1;
    this.payloadBytes += parsedFrame.dataLength;
    this.lastFrameAt = now;
    this.frameEvents.push({ now });

    if (parsedFrame.source === 'board') {
      this.boardFrames += 1;
    } else {
      this.slcanFrames += 1;
    }

    if (parsedFrame.idType === 'standard') {
      this.standardFrames += 1;
    } else {
      this.extendedFrames += 1;
    }

    const idStats = this.ids.get(parsedFrame.idText) ?? {
      idText: parsedFrame.idText,
      idType: parsedFrame.idType,
      source: parsedFrame.source,
      count: 0,
      recentTimestamps: [],
      lastSeenAt: 0,
      lastDataHex: '',
      lastDataLength: 0,
    };

    idStats.count += 1;
    idStats.lastSeenAt = now;
    idStats.lastDataHex = parsedFrame.dataHex ?? '';
    idStats.lastDataLength = parsedFrame.dataLength;
    idStats.source = parsedFrame.source;
    idStats.recentTimestamps.push(now);
    this.ids.set(parsedFrame.idText, idStats);
  }

  prune(now = Date.now()) {
    const lastMinute = now - 60000;
    const lastTenSeconds = now - 10000;

    this.byteEvents = this.byteEvents.filter((entry) => entry.now >= lastMinute);
    this.frameEvents = this.frameEvents.filter((entry) => entry.now >= lastMinute);

    for (const stats of this.ids.values()) {
      stats.recentTimestamps = stats.recentTimestamps.filter((timestamp) => timestamp >= lastTenSeconds);
    }
  }

  buildTopIds() {
    return [...this.ids.values()]
      .sort((left, right) => {
        if (right.recentTimestamps.length !== left.recentTimestamps.length) {
          return right.recentTimestamps.length - left.recentTimestamps.length;
        }

        return right.count - left.count;
      })
      .slice(0, 8)
      .map((entry) => ({
        idText: entry.idText,
        idType: entry.idType,
        source: entry.source,
        count: entry.count,
        recentHz: entry.recentTimestamps.length / 10,
        lastSeenAt: entry.lastSeenAt,
        lastDataLength: entry.lastDataLength,
        lastDataHex: entry.lastDataHex,
      }));
  }

  snapshot(now = Date.now()) {
    this.prune(now);

    const bytesPerSecond = this.byteEvents.reduce((sum, entry) => {
      return entry.now >= now - 1000 ? sum + entry.byteLength : sum;
    }, 0);

    const framesPerSecond = this.frameEvents.reduce((sum, entry) => {
      return entry.now >= now - 1000 ? sum + 1 : sum;
    }, 0);

    const sessionSeconds = Math.max(1, (now - this.sessionStartedAt) / 1000);

    return {
      sessionStartedAt: this.sessionStartedAt,
      connectionStartedAt: this.connectionStartedAt || null,
      connectionUptimeMs: this.connectionStartedAt ? now - this.connectionStartedAt : null,
      totalBytes: this.totalBytes,
      totalLines: this.totalLines,
      totalFrames: this.totalFrames,
      boardFrames: this.boardFrames,
      slcanFrames: this.slcanFrames,
      parseErrors: this.parseErrors,
      payloadBytes: this.payloadBytes,
      standardFrames: this.standardFrames,
      extendedFrames: this.extendedFrames,
      uniqueIds: this.ids.size,
      bytesPerSecond,
      framesPerSecond,
      averageBytesPerSecond: this.totalBytes / sessionSeconds,
      averageFramesPerSecond: this.totalFrames / sessionSeconds,
      averagePayloadBytes: this.totalFrames ? this.payloadBytes / this.totalFrames : 0,
      lastChunkAt: this.lastChunkAt || null,
      lastFrameAt: this.lastFrameAt || null,
      timeSinceLastChunkMs: this.lastChunkAt ? now - this.lastChunkAt : null,
      timeSinceLastFrameMs: this.lastFrameAt ? now - this.lastFrameAt : null,
      topIds: this.buildTopIds(),
    };
  }
}

class BoardStateTracker {
  constructor() {
    this.boards = new Map();
  }

  reset() {
    this.boards = new Map();
  }

  record(boardPayload, now = Date.now()) {
    if (!boardPayload || typeof boardPayload.boardId !== 'number') {
      return;
    }

    const boardType = boardPayload.boardType ?? 2;
    const boardId = boardPayload.boardId;
    const key = `${boardType}-${boardId}`;
    const state = this.boards.get(key) ?? {
      boardType,
      boardId,
      fast: null,
      slow: null,
      lastSeenAt: 0,
      fastCount: 0,
      slowCount: 0,
      recentFastTimestamps: [],
      // Message counter tracking for debugging: last seen 3-bit counter,
      // whether a mismatch was observed, and last received raw counter.
      lastMessageCounter: null,
      counterMismatch: false,
      counterMismatchCount: 0,
      consecutiveGoodFrames: 0,
      lastMessageCounterReceived: null,
    };

    state.lastSeenAt = now;

    if (boardPayload.kind === 'fast') {
      state.recentFastTimestamps.push(now);
      const oneSecondAgo = now - 1000;
      while (state.recentFastTimestamps.length > 0 && state.recentFastTimestamps[0] < oneSecondAgo) {
        state.recentFastTimestamps.shift();
      }
      boardPayload.rateHz = state.recentFastTimestamps.length;
      state.fast = { ...state.fast, ...boardPayload, receivedAt: now };
      state.fastCount += 1;
    } else if (boardPayload.kind === 'slow') {
      state.slow = { ...state.slow, ...boardPayload, receivedAt: now };
      state.slowCount += 1;
    }

    // Extract 3-bit rolling message counter from shared error flags when available
    // Bits 7-9 contain the counter: (errorFlags >> 7) & 0x07
    if (boardPayload && typeof boardPayload.errorFlags === 'number') {
      const err = boardPayload.errorFlags;
      const counter = (err >> 7) & 0x07;
      if (state.lastMessageCounter === null) {
        // First frame seen — anchor the counter, no mismatch
        state.lastMessageCounter = counter;
        state.consecutiveGoodFrames = 1;
        state.counterMismatch = false;
      } else {
        const expected = (state.lastMessageCounter + 1) & 0x07;
        if (counter !== expected) {
          state.counterMismatch = true;
          state.counterMismatchCount += 1;
          state.consecutiveGoodFrames = 0;
          // Re-anchor so we don't cascade mismatches from this point
          state.lastMessageCounter = counter;
        } else {
          state.consecutiveGoodFrames += 1;
          state.lastMessageCounter = counter;
          // Auto-clear after 8 consecutive good frames
          if (state.consecutiveGoodFrames >= 8) {
            state.counterMismatch = false;
          }
        }
      }
      state.lastMessageCounterReceived = counter;
    }

    this.boards.set(key, state);
  }

  snapshot(now = Date.now()) {
    const oneSecondAgo = now - 1000;
    return [...this.boards.values()]
      .sort((left, right) => {
        if (left.boardType !== right.boardType) {
          return left.boardType - right.boardType;
        }
        return left.boardId - right.boardId;
      })
      .map((state) => {
        if (state.recentFastTimestamps) {
          while (state.recentFastTimestamps.length > 0 && state.recentFastTimestamps[0] < oneSecondAgo) {
            state.recentFastTimestamps.shift();
          }
          if (state.fast) {
            state.fast.rateHz = state.recentFastTimestamps.length;
          }
        }
        return {
          boardType: state.boardType,
          boardId: state.boardId,
          lastSeenAt: state.lastSeenAt,
          lastSeenAgeMs: state.lastSeenAt ? now - state.lastSeenAt : null,
          fastCount: state.fastCount,
          slowCount: state.slowCount,
          // Expose message counter tracking for UI/debugging
          lastMessageCounter: state.lastMessageCounter,
          counterMismatch: state.counterMismatch,
          counterMismatchCount: state.counterMismatchCount,
          consecutiveGoodFrames: state.consecutiveGoodFrames,
          lastMessageCounterReceived: state.lastMessageCounterReceived,
          fast: state.fast
            ? { ...state.fast, ageMs: now - state.fast.receivedAt }
            : null,
          slow: state.slow
            ? { ...state.slow, ageMs: now - state.slow.receivedAt }
            : null,
        };
      });
  }
}

class DeviceMonitor extends EventEmitter {
  constructor() {
    super();
    this.availablePorts = [];
    this.port = null;
    this.activePorts = new Map();
    this.connectedPortInfo = null;
    this.connecting = false;
    this.pendingText = '';
    this.autoConnect = true;
    this.autoConnectHold = false;
    this.preferredPortPath = null;
    this.baudRate = DEFAULT_BAUD_RATE;
    this.lastError = null;
    this.stats = new DiagnosticsTracker();
    this.boardStates = new BoardStateTracker();
    this.usbTopology = {
      hub: null,
      hubs: [],
      devices: [],
      scannedAt: null,
      error: null,
    };
    this.logWriter = new LogWriter((status) => {
      this.emit('log-status', status);
    });
    this.portScanTimer = null;
    this.diagnosticsTimer = null;
    this.usbTopologyTimer = null;
    this.pendingFrames = [];
    this.frameBatchTimer = null;
  }

  async start() {
    await Promise.all([this.scanPorts(), this.scanUsbTopology()]);

    this.portScanTimer = setInterval(() => {
      this.scanPorts().catch((error) => {
        this.handleRuntime('error', 'Failed to scan serial ports.', {
          error: error.message,
        });
      });
    }, PORT_SCAN_INTERVAL_MS);

    this.usbTopologyTimer = setInterval(() => {
      this.scanUsbTopology().catch((error) => {
        this.handleRuntime('error', 'Failed to scan macOS USB topology.', {
          error: error.message,
        });
      });
    }, USB_TOPOLOGY_SCAN_INTERVAL_MS);

    this.diagnosticsTimer = setInterval(() => {
      this.emit('diagnostics', this.getDiagnosticsSnapshot());
    }, DIAGNOSTICS_INTERVAL_MS);

    this.frameBatchTimer = setInterval(() => {
      if (this.pendingFrames.length > 0) {
        this.emit('frames', this.pendingFrames);
        this.pendingFrames = [];
      }
    }, 33); // ~30 FPS updates
  }

  async dispose() {
    if (this.portScanTimer) {
      clearInterval(this.portScanTimer);
      this.portScanTimer = null;
    }

    if (this.frameBatchTimer) {
      clearInterval(this.frameBatchTimer);
      this.frameBatchTimer = null;
    }

    if (this.diagnosticsTimer) {
      clearInterval(this.diagnosticsTimer);
      this.diagnosticsTimer = null;
    }

    if (this.usbTopologyTimer) {
      clearInterval(this.usbTopologyTimer);
      this.usbTopologyTimer = null;
    }

    await this.disconnect('shutdown');
    this.logWriter.stop();
  }

  getInitialState() {
    return {
      ports: this.availablePorts,
      connection: this.getConnectionState(),
      diagnostics: this.getDiagnosticsSnapshot(),
      logStatus: this.logWriter.getStatus(),
    };
  }

  getConnectionState() {
    const connected = this.activePorts.size > 0 && Array.from(this.activePorts.values()).some((p) => p.isOpen);
    return {
      connected,
      connecting: this.connecting,
      autoConnect: this.autoConnect,
      preferredPortPath: this.preferredPortPath,
      baudRate: this.baudRate,
      port: this.connectedPortInfo,
      lastError: this.lastError,
      targetUsb: {
        vendorId: TARGET_VID,
        productId: TARGET_PID,
        productName: 'STM32 Virtual ComPort',
      },
      hub: {
        targetVendorId: TARGET_HUB_VID,
        targetProductId: TARGET_HUB_PID,
        detected: Boolean(this.usbTopology.hub),
        info: this.usbTopology.hub,
        lastError: this.usbTopology.error,
        scannedAt: this.usbTopology.scannedAt,
        hasMirrorableEndpoint: this.availablePorts.length > 0,
      },
      transportLabel: 'USB CDC mirror',
    };
  }

  getDiagnosticsSnapshot() {
    const now = Date.now();
    return {
      ...this.stats.snapshot(now),
      boards: this.boardStates.snapshot(now),
      hub: this.usbTopology.hub,
      logging: this.logWriter.getStatus(),
    };
  }

  async listPorts() {
    await Promise.all([this.scanPorts(), this.scanUsbTopology()]);
    return this.availablePorts;
  }

  async scanUsbTopology() {
    const previousHubsKey = JSON.stringify(this.usbTopology.hubs || (this.usbTopology.hub ? [this.usbTopology.hub] : []));
    const previousDetected = Boolean(this.usbTopology.hub);

    try {
      this.usbTopology = await scanUsbTopology();
    } catch (error) {
      this.usbTopology = {
        ...this.usbTopology,
        scannedAt: new Date().toISOString(),
        error: error.message,
      };
    }

    const currentHubsKey = JSON.stringify(this.usbTopology.hubs || (this.usbTopology.hub ? [this.usbTopology.hub] : []));
    if (previousHubsKey !== currentHubsKey) {
      this.emit('connection', this.getConnectionState());
      this.emit('diagnostics', this.getDiagnosticsSnapshot());
    }

    const detected = Boolean(this.usbTopology.hub);
    if (detected !== previousDetected) {
      if (detected) {
        this.handleRuntime('info', 'Detected USB2514 hub in macOS USB topology.', {
          hubPath: formatHubPath(this.usbTopology.hub),
        });
      } else {
        this.handleRuntime('warning', 'USB2514 hub is no longer visible in macOS USB topology.', {});
      }
    }

    return this.usbTopology;
  }

  async scanPorts() {
    const ports = (await SerialPort.list())
      .map(normalizePort)
      .filter((entry) => entry.mirrorEligible)
      .sort((left, right) => left.path.localeCompare(right.path));

    const previous = JSON.stringify(this.availablePorts);
    const next = JSON.stringify(ports);
    this.availablePorts = ports;

    if (previous !== next) {
      this.emit('ports', this.availablePorts);
    }

    if (this.connectedPortInfo) {
      const latestInfo = this.availablePorts.find((entry) => entry.path === this.connectedPortInfo.path);
      if (latestInfo) {
        this.connectedPortInfo = latestInfo;
        this.emit('connection', this.getConnectionState());
      }
    }

    if (this.autoConnect && !this.autoConnectHold && !this.connecting && !(this.port && this.port.isOpen)) {
      const candidate = this.pickAutoConnectPort();
      if (candidate) {
        try {
          await this.connect({ path: candidate.path, baudRate: this.baudRate, source: 'auto' });
        } catch (error) {
          this.lastError = error.message;
          this.emit('connection', this.getConnectionState());
        }
      }
    }

    return this.availablePorts;
  }

  pickAutoConnectPort() {
    if (this.preferredPortPath) {
      if (this.preferredPortPath === 'all') {
        return { path: 'all', matchesTarget: true };
      }
      const preferred = this.availablePorts.find((entry) => entry.path === this.preferredPortPath);
      if (preferred) {
        return preferred;
      }
    }

    const targetPorts = this.availablePorts.filter((entry) => entry.matchesTarget);
    if (targetPorts.length > 1) {
      return { path: 'all', matchesTarget: true };
    }

    const hubs = this.usbTopology.hubs || (this.usbTopology.hub ? [this.usbTopology.hub] : []);
    for (const hub of hubs) {
      const hubPrefix = locationPrefix(hub.locationId);
      if (hubPrefix) {
        const hubPort = this.availablePorts.find((entry) => locationPrefix(entry.locationId) === hubPrefix);
        if (hubPort) {
          return hubPort;
        }
      }
    }

    return (
      this.availablePorts.find((entry) => entry.matchesTarget) ??
      (this.availablePorts.length === 1 ? this.availablePorts[0] : null)
    );
  }

  async setPreferredPort(path) {
    this.preferredPortPath = path;
    this.emit('connection', this.getConnectionState());
    return this.getConnectionState();
  }

  checkAllPortsConnected(paths) {
    if (this.activePorts.size !== paths.length) {
      return false;
    }
    for (const path of paths) {
      const p = this.activePorts.get(path);
      if (!p || !p.isOpen) {
        return false;
      }
    }
    return true;
  }

  async connect(options = {}) {
    const requestedPath = options.path ?? this.preferredPortPath ?? this.pickAutoConnectPort()?.path;
    if (!requestedPath) {
      if (this.usbTopology.hub) {
        throw new Error(
          `USB2514 hub detected at ${this.usbTopology.hub.locationId ?? 'unknown location'}, but macOS has not enumerated a USB CDC child endpoint yet.`
        );
      }

      throw new Error('No USB CDC endpoint selected.');
    }

    const pathsToConnect = requestedPath === 'all'
      ? this.availablePorts.map(p => p.path)
      : [requestedPath];

    if (pathsToConnect.length === 0) {
      throw new Error('No USB CDC ports available to connect to.');
    }

    if (this.port && this.port.isOpen && this.connectedPortInfo?.path === requestedPath) {
      if (requestedPath !== 'all' || this.checkAllPortsConnected(pathsToConnect)) {
        return this.getConnectionState();
      }
    }

    this.autoConnectHold = false;
    this.connecting = true;
    this.lastError = null;
    this.preferredPortPath = requestedPath;
    this.baudRate = Number(options.baudRate) || this.baudRate || DEFAULT_BAUD_RATE;
    this.emit('connection', this.getConnectionState());

    if (this.activePorts.size > 0 || this.port) {
      await this.disconnect('switch');
      this.connecting = true;
      this.emit('connection', this.getConnectionState());
    }

    if (requestedPath === 'all') {
      this.connectedPortInfo = {
        path: 'all',
        displayName: `All USB CDC Ports (${this.availablePorts.length} connected)`,
        matchesTarget: true,
        mirrorEligible: true,
      };
    } else {
      this.connectedPortInfo =
        this.availablePorts.find((entry) => entry.path === requestedPath) ??
        normalizePort({ path: requestedPath });
    }

    const openPromises = pathsToConnect.map((path) => {
      return new Promise((resolve, reject) => {
        const serialPort = new SerialPort({
          path,
          baudRate: this.baudRate,
          autoOpen: false,
        });

        const rxBuffer = Buffer.allocUnsafe(65536);
        let rxRead = 0;
        let rxWrite = 0;

        serialPort.on('data', (chunk) => {
          const now = Date.now();
          this.stats.recordChunk(chunk.length, now);
          
          if (rxWrite + chunk.length > rxBuffer.length) {
            const len = rxWrite - rxRead;
            if (len > 0) {
              rxBuffer.copy(rxBuffer, 0, rxRead, rxWrite);
            }
            rxRead = 0;
            rxWrite = len;
          }

          if (rxWrite + chunk.length > rxBuffer.length) {
            rxRead = 0;
            rxWrite = 0; 
          }

          chunk.copy(rxBuffer, rxWrite);
          rxWrite += chunk.length;

          while (rxWrite - rxRead > 0) {
            const syncIndex = rxBuffer.indexOf(0xAA, rxRead);
            
            if (syncIndex === -1 || syncIndex >= rxWrite) {
              rxRead = rxWrite; 
              break;
            }

            rxRead = syncIndex;
            const available = rxWrite - rxRead;

            if (available < 5) {
              break;
            }

            const dataLength = rxBuffer[rxRead + 3];
            const frameLength = 5 + dataLength;

            if (available < frameLength) {
              break;
            }

            const frameBuffer = rxBuffer.subarray(rxRead, rxRead + frameLength);
            const slcan = parseBinaryFrame(frameBuffer);
            
            if (!slcan.ok) {
               rxRead += 1;
               continue;
            }

            rxRead += frameLength;

            const parsedFrame = parseSlcanToBoard(slcan, slcan.raw);

            this.stats.recordLine(parsedFrame, now);
            if (parsedFrame.ok && parsedFrame.source === 'board' && parsedFrame.board) {
              this.boardStates.record(parsedFrame.board, now);
            }

            const event = {
              timestamp: new Date(now).toISOString(),
              raw: parsedFrame.raw,
              ok: parsedFrame.ok,
              reason: parsedFrame.ok ? null : parsedFrame.reason,
              source: parsedFrame.ok ? parsedFrame.source : null,
              board: parsedFrame.ok && parsedFrame.source === 'board' ? parsedFrame.board : null,
              frame: parsedFrame.ok
                ? {
                    idText: parsedFrame.idText,
                    idType: parsedFrame.idType,
                    identifierHex: parsedFrame.identifierHex,
                    dataLength: parsedFrame.dataLength,
                    dataHex: parsedFrame.dataHex,
                    dataBytes: parsedFrame.dataBytes,
                  }
                : null,
            };

            this.pendingFrames.push(event);
            this.logWriter.write({
              type: 'frame',
              ...event,
            });
          }
        });

        serialPort.on('error', (error) => {
          this.handleRuntime('error', `USB CDC mirror error on ${path}.`, {
            path,
            error: error.message,
          });
          if (requestedPath !== 'all') {
            this.lastError = error.message;
            this.emit('connection', this.getConnectionState());
          }
        });

        serialPort.on('close', () => {
          this.activePorts.delete(path);
          this.handleRuntime('warning', `USB CDC endpoint disconnected: ${path}`, { path });
          this.logWriter.write({
            type: 'runtime',
            level: 'warning',
            timestamp: new Date().toISOString(),
            message: `USB CDC endpoint disconnected: ${path}`,
            path,
          });

          if (this.activePorts.size === 0) {
            this.port = null;
            this.connectedPortInfo = null;
            this.connecting = false;
            this.stats.setConnected(false);
          }
          this.emit('connection', this.getConnectionState());
        });

        serialPort.open((error) => {
          if (error) {
            reject(error);
            return;
          }
          this.activePorts.set(path, serialPort);
          resolve(serialPort);
        });
      });
    });

    try {
      if (requestedPath === 'all') {
        const results = await Promise.allSettled(openPromises);
        const openedCount = results.filter(r => r.status === 'fulfilled').length;
        if (openedCount === 0) {
          const errors = results.map(r => r.reason?.message).filter(Boolean).join('; ');
          throw new Error(`Failed to open any ports: ${errors}`);
        }
      } else {
        await openPromises[0];
      }
    } catch (error) {
      this.connecting = false;
      this.lastError = error.message;
      this.emit('connection', this.getConnectionState());
      throw error;
    }

    this.port = {
      isOpen: true,
      close: (callback) => {
        const closePromises = Array.from(this.activePorts.values()).map(p => {
          return new Promise(res => p.close(() => res()));
        });
        Promise.all(closePromises).then(() => {
          this.activePorts.clear();
          if (callback) callback();
        });
      }
    };

    this.connecting = false;
    this.stats.setConnected(true);
    this.emit('connection', this.getConnectionState());

    const pathsConnectedStr = Array.from(this.activePorts.keys()).join(', ');
    this.handleRuntime('info', `Mirroring USB CDC endpoints: ${pathsConnectedStr}`, {
      paths: Array.from(this.activePorts.keys()),
      baudRate: this.baudRate,
      source: options.source ?? 'manual',
    });
    this.logWriter.write({
      type: 'runtime',
      level: 'info',
      timestamp: new Date().toISOString(),
      message: `Mirroring USB CDC endpoints: ${pathsConnectedStr}`,
      paths: Array.from(this.activePorts.keys()),
      baudRate: this.baudRate,
      source: options.source ?? 'manual',
    });

    return this.getConnectionState();
  }

  async disconnect(reason = 'manual') {
    if (reason === 'manual') {
      this.autoConnectHold = true;
    }

    if (this.activePorts.size === 0 && !this.port) {
      this.connecting = false;
      this.connectedPortInfo = null;
      this.stats.setConnected(false);
      this.emit('connection', this.getConnectionState());
      return this.getConnectionState();
    }

    this.connecting = false;
    const closePromises = Array.from(this.activePorts.values()).map((serialPort) => {
      return new Promise((resolve) => {
        if (serialPort.isOpen) {
          serialPort.close(() => resolve());
        } else {
          resolve();
        }
      });
    });

    await Promise.all(closePromises);
    this.activePorts.clear();
    this.port = null;
    this.connectedPortInfo = null;
    this.stats.setConnected(false);
    this.emit('connection', this.getConnectionState());

    return this.getConnectionState();
  }

  async setAutoConnect(enabled) {
    this.autoConnect = Boolean(enabled);
    this.autoConnectHold = !this.autoConnect ? true : false;
    this.emit('connection', this.getConnectionState());

    if (this.autoConnect) {
      this.autoConnectHold = false;
      await this.scanPorts();
    }

    return this.getConnectionState();
  }

  async clearSession() {
    this.stats.clearSession();
    this.boardStates.reset();
    this.emit('diagnostics', this.getDiagnosticsSnapshot());
    this.handleRuntime('info', 'Session counters cleared.', {});
    return this.getDiagnosticsSnapshot();
  }

  async startLogging(filePath) {
    const status = await this.logWriter.start(filePath);
    this.handleRuntime('info', 'File logging started.', {
      filePath,
    });
    return status;
  }

  stopLogging() {
    const previousPath = this.logWriter.getStatus().filePath;
    const status = this.logWriter.stop();
    this.handleRuntime('info', 'File logging stopped.', {
      filePath: previousPath,
    });
    return status;
  }

  handleData(chunk) {
    const now = Date.now();
    this.stats.recordChunk(chunk.length, now);
    this.pendingText += chunk.toString('utf8');

    const parts = this.pendingText.split(/\r\n|\n|\r/g);
    this.pendingText = parts.pop() ?? '';

    for (const part of parts) {
      const parsedFrame = parseMduLine(part);
      if (!parsedFrame.raw) {
        continue;
      }

      this.stats.recordLine(parsedFrame, now);
      if (parsedFrame.ok && parsedFrame.source === 'board' && parsedFrame.board) {
        this.boardStates.record(parsedFrame.board, now);
      }

      const event = {
        timestamp: new Date(now).toISOString(),
        raw: parsedFrame.raw,
        ok: parsedFrame.ok,
        reason: parsedFrame.ok ? null : parsedFrame.reason,
        source: parsedFrame.ok ? parsedFrame.source : null,
        board: parsedFrame.ok && parsedFrame.source === 'board' ? parsedFrame.board : null,
        frame: parsedFrame.ok
          ? {
              idText: parsedFrame.idText,
              idType: parsedFrame.idType,
              identifierHex: parsedFrame.identifierHex,
              dataLength: parsedFrame.dataLength,
              dataHex: parsedFrame.dataHex,
              dataBytes: parsedFrame.dataBytes,
            }
          : null,
      };

      this.pendingFrames.push(event);
      this.logWriter.write({
        type: 'frame',
        ...event,
      });
    }
  }

  handleRuntime(level, message, details) {
    const event = {
      timestamp: new Date().toISOString(),
      level,
      message,
      details,
    };

    this.emit('runtime', event);
  }
}

module.exports = {
  DEFAULT_BAUD_RATE,
  DeviceMonitor,
};
