import { useState, useEffect, useRef, useCallback } from 'react';
import { flattenTelemetryData } from './signals';

const MAX_HISTORY_POINTS = 600;
function createEmptyTelemetry() {
  return {
    ts: 0,
    gps: { lat: 0, lon: 0, alt: 0, vel: 0, hdg: 0, fix: 0, sats: 0 },
    imu: { ax: 0, ay: 0, az: 0, pitch: 0, roll: 0, yaw: 0, cal: 0 },
    inv: { rpm: 0, mot_t: 0, cool_t: 0, vdc: 0, idc: 0, tq_cmd: 0, tq_fb: 0, vsm: 0, faults: 0, all: {}, cmd: {} },
    bms: { v: 0, i: 0, soc: 0, avg_t: 0, hi_t: 0, lo_t: 0, avg_cv: 0, hi_cv: 0, lo_cv: 0, dcl: 0 },
    vcu: {
      spd: 0,
      req_tq: 0,
      apps1: 0,
      apps2: 0,
      bse: 0,
      rtd: 0,
      imd_fault: 0,
      precharge: 0,
      air_pos: 0,
      air_neg: 0,
      crosscheck: 0,
      apps_plausible: 0,
      looking_for_rtd: 0,
      all: {},
    },
    fusebox: {
      state: 0,
      dcdc_v: 0,
      battery_v: 0,
      lvb_soc: 0,
      dcdc_temp: 0,
      accy_fan_power: 0,
      tractive_fan_power: 0,
      tractive_pumps_power: 0,
      charging_power: 0,
      ambient_temp: 0,
      all: {},
    },
    sdu: [
      { pos: 'FL', shock: 0, brake: 0, wrpm: 0, tire: [0, 0, 0, 0] },
      { pos: 'FR', shock: 0, brake: 0, wrpm: 0, tire: [0, 0, 0, 0] },
      { pos: 'RL', shock: 0, brake: 0, wrpm: 0, tire: [0, 0, 0, 0] },
      { pos: 'RR', shock: 0, brake: 0, wrpm: 0, tire: [0, 0, 0, 0] },
    ],
    tspmu: [
      { boardId: 0, p1: 0, p2: 0, temps: [0, 0, 0, 0] },
      { boardId: 1, p1: 0, p2: 0, temps: [0, 0, 0, 0] },
    ],
    tshmu: { flow1: 0, flow2: 0, jitter_us: 0, error_flags: 0 },
    log: false,
    log_file: '',
    log_signal_ids: [],
    stats: { parsed: 0, errors: 0 },
  };
}

export function useTelemetry() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [connectionMessage, setConnectionMessage] = useState('Waiting for telemetry link.');
  const [activeTransport, setActiveTransport] = useState('wifi');
  const [targetIp, setTargetIp] = useState('');

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const healthTimerRef = useRef(null);
  const connectGenerationRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const lastMessageAtRef = useRef(0);
  const targetIpRef = useRef('');
  const activeSessionRef = useRef(null);

  const telemetryRef = useRef(createEmptyTelemetry());
  const historyRef = useRef([]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const stopHealthMonitor = useCallback(() => {
    if (healthTimerRef.current) {
      clearInterval(healthTimerRef.current);
      healthTimerRef.current = null;
    }
  }, []);

  const pushTelemetry = useCallback((data) => {
    telemetryRef.current = data;
    const flat = flattenTelemetryData(data);
    historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY_POINTS - 1)), flat];
    lastMessageAtRef.current = Date.now();
    setIsLogging(Boolean(data.log));
  }, []);

  const closeSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const requestJson = useCallback(async (path, options = {}, overrideIp) => {
    const ip = overrideIp || targetIpRef.current;
    if (!ip) {
      throw new Error('No Raspberry Pi IP is selected.');
    }

    const response = await fetch(`http://${ip}:8000${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
  }, []);

  const refreshStatus = useCallback(async (overrideIp) => {
    const status = await requestJson('/api/status', {}, overrideIp);
    setIsLogging(Boolean(status.is_logging));
    return status;
  }, [requestJson]);

  const scheduleReconnect = useCallback(() => {
    clearReconnectTimer();
    if (manualDisconnectRef.current || !targetIpRef.current || activeSessionRef.current !== 'wifi') {
      setConnectionState('disconnected');
      setConnectionMessage('Telemetry link idle.');
      return;
    }

    reconnectAttemptRef.current += 1;
    const attempt = reconnectAttemptRef.current;
    const delayMs = Math.min(1500 * attempt, 5000);

    setConnectionState('reconnecting');
    setConnectionMessage(`Link dropped. Reconnecting in ${(delayMs / 1000).toFixed(1)}s...`);

    reconnectTimerRef.current = setTimeout(async () => {
      let nextIp = targetIpRef.current;
      if (window.electronAPI && attempt % 3 === 0) {
        try {
          const scannedIp = await window.electronAPI.scanNetwork();
          if (scannedIp) {
            nextIp = scannedIp;
            targetIpRef.current = scannedIp;
            setTargetIp(scannedIp);
          }
        } catch (err) {
          console.error('Autoscan during reconnect failed', err);
        }
      }

      if (nextIp) {
        manualDisconnectRef.current = false;
        const generation = connectGenerationRef.current + 1;
        connectGenerationRef.current = generation;
        setConnectionState('connecting');
        setConnectionMessage(`Reconnecting to ${nextIp}...`);
        closeSocket();

        const socket = new WebSocket(`ws://${nextIp}:8000/ws`);
        wsRef.current = socket;

        socket.onopen = async () => {
          if (generation !== connectGenerationRef.current || activeSessionRef.current !== 'wifi') {
            socket.close();
            return;
          }
          reconnectAttemptRef.current = 0;
          setIsConnected(true);
          setActiveTransport('wifi');
          setConnectionState('connected');
          setConnectionMessage(`Streaming from ${nextIp}.`);
          lastMessageAtRef.current = Date.now();
          startHealthMonitor();
          try {
            await refreshStatus(nextIp);
          } catch (err) {
            console.error('Status refresh failed after reconnect', err);
          }
        };

        socket.onmessage = (event) => {
          if (generation !== connectGenerationRef.current || activeSessionRef.current !== 'wifi') {
            return;
          }
          try {
            pushTelemetry(JSON.parse(event.data));
            setConnectionState('connected');
            setConnectionMessage(`Streaming from ${nextIp}.`);
          } catch (err) {
            console.error('Telemetry parsing error', err);
          }
        };

        socket.onclose = () => {
          if (generation !== connectGenerationRef.current || activeSessionRef.current !== 'wifi') {
            return;
          }
          stopHealthMonitor();
          setIsConnected(false);
          scheduleReconnect();
        };

        socket.onerror = () => socket.close();
      }
    }, delayMs);
  }, [clearReconnectTimer, closeSocket, pushTelemetry, refreshStatus, stopHealthMonitor]);

  const startHealthMonitor = useCallback(() => {
    stopHealthMonitor();
    healthTimerRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      if (Date.now() - lastMessageAtRef.current > 15000) {
        setConnectionState((prev) => (prev === 'connected' ? 'degraded' : prev));
        setConnectionMessage((prev) => (
          prev.startsWith('Streaming from') && !prev.includes('waiting for fresh frames')
            ? `${prev} • waiting for fresh frames`
            : prev
        ));
      }
    }, 1000);
  }, [stopHealthMonitor]);

  const connect = useCallback((ip) => {
    const nextIp = (ip || '').trim();
    if (!nextIp) {
      return;
    }

    manualDisconnectRef.current = false;
    activeSessionRef.current = 'wifi';
    clearReconnectTimer();
    stopHealthMonitor();
    closeSocket();

    targetIpRef.current = nextIp;
    setTargetIp(nextIp);
    localStorage.setItem('telemetry:lastIp', nextIp);

    const generation = connectGenerationRef.current + 1;
    connectGenerationRef.current = generation;
    setConnectionState('connecting');
    setConnectionMessage(`Connecting to ${nextIp}...`);

    const socket = new WebSocket(`ws://${nextIp}:8000/ws`);
    wsRef.current = socket;

    socket.onopen = async () => {
      if (generation !== connectGenerationRef.current || activeSessionRef.current !== 'wifi') {
        socket.close();
        return;
      }
      reconnectAttemptRef.current = 0;
      setIsConnected(true);
      setActiveTransport('wifi');
      setConnectionState('connected');
      setConnectionMessage(`Streaming from ${nextIp}.`);
      lastMessageAtRef.current = Date.now();
      startHealthMonitor();
      try {
        await refreshStatus(nextIp);
      } catch (err) {
        console.error('Status refresh failed', err);
      }
    };

    socket.onmessage = (event) => {
      if (generation !== connectGenerationRef.current || activeSessionRef.current !== 'wifi') {
        return;
      }
      try {
        pushTelemetry(JSON.parse(event.data));
        setConnectionState('connected');
        setConnectionMessage(`Streaming from ${nextIp}.`);
      } catch (err) {
        console.error('Telemetry parsing error', err);
      }
    };

    socket.onclose = () => {
      if (generation !== connectGenerationRef.current || activeSessionRef.current !== 'wifi') {
        return;
      }
      stopHealthMonitor();
      setIsConnected(false);
      if (manualDisconnectRef.current) {
        setConnectionState('disconnected');
        setConnectionMessage('Telemetry link disconnected.');
        return;
      }
      scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }, [clearReconnectTimer, closeSocket, pushTelemetry, refreshStatus, scheduleReconnect, startHealthMonitor, stopHealthMonitor]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    activeSessionRef.current = null;
    clearReconnectTimer();
    stopHealthMonitor();
    closeSocket();
    if (window.electronAPI) {
      window.electronAPI.disconnectSerial();
    }
    setIsConnected(false);
    setConnectionState('disconnected');
    setConnectionMessage('Telemetry link disconnected.');
  }, [clearReconnectTimer, closeSocket, stopHealthMonitor]);

  const connectSerial = useCallback(async (portPath, baudRate = 115200) => {
    if (!window.electronAPI) {
      return;
    }

    manualDisconnectRef.current = true;
    activeSessionRef.current = 'serial';
    clearReconnectTimer();
    stopHealthMonitor();
    closeSocket();

    const result = await window.electronAPI.connectSerial(portPath, baudRate);
    if (result.success) {
      setIsConnected(true);
      setActiveTransport('serial');
      setConnectionState('connected');
      setConnectionMessage(`Streaming over serial: ${portPath}`);
    } else {
      alert(`Failed to connect to serial port: ${result.error}`);
    }
  }, [clearReconnectTimer, closeSocket, stopHealthMonitor]);

  const toggleLogging = useCallback(async (selectedSignalIds = [], filename = '') => {
    const shouldStart = !isLogging;
    if (!targetIpRef.current) {
      throw new Error('Connect to the Pi before changing logging state.');
    }

    if (shouldStart) {
      await requestJson('/api/logging/start', {
        method: 'POST',
        body: JSON.stringify({ signals: selectedSignalIds, filename }),
      });
    } else {
      await requestJson('/api/logging/stop', { method: 'POST' });
    }

    await refreshStatus();
  }, [isLogging, refreshStatus, requestJson]);

  const fetchLogs = useCallback(async () => requestJson('/api/logs'), [requestJson]);
  const fetchLogFile = useCallback(async (token) => requestJson(`/api/logs/${token}`), [requestJson]);

  useEffect(() => {
    const savedIp = localStorage.getItem('telemetry:lastIp');
    if (savedIp) {
      targetIpRef.current = savedIp;
      setTargetIp(savedIp);
      setTimeout(() => {
        if (!manualDisconnectRef.current && !wsRef.current && activeSessionRef.current !== 'serial') {
          connect(savedIp);
        }
      }, 0);
    } else if (window.electronAPI) {
      setConnectionState('connecting');
      setConnectionMessage('Scanning network for Telemetry Hub...');
      window.electronAPI.scanNetwork().then((foundIp) => {
        if (foundIp && !manualDisconnectRef.current && !wsRef.current && activeSessionRef.current !== 'serial') {
          connect(foundIp);
        } else if (!foundIp) {
          setConnectionState('disconnected');
          setConnectionMessage('No Telemetry Hub found on local network.');
        }
      }).catch((err) => {
        console.error('Initial auto-scan failed', err);
        setConnectionState('disconnected');
        setConnectionMessage('Network scan failed.');
      });
    }
  }, [connect]);

  useEffect(() => {
    if (!window.electronAPI) {
      return undefined;
    }

    window.electronAPI.onSerialData((data) => {
      if (activeSessionRef.current !== 'serial') {
        return;
      }
      try {
        pushTelemetry(JSON.parse(data));
        setIsConnected(true);
        setActiveTransport('serial');
        setConnectionState('connected');
        setConnectionMessage('Streaming over serial backup.');
      } catch (err) {
        console.error('Malformed serial telemetry frame', err);
      }
    });

    window.electronAPI.onSerialDisconnected(() => {
      if (activeSessionRef.current !== 'serial') {
        return;
      }
      activeSessionRef.current = null;
      setIsConnected(false);
      setConnectionState('disconnected');
      setConnectionMessage('Serial backup disconnected.');
    });

    return () => {
      clearReconnectTimer();
      stopHealthMonitor();
      closeSocket();
      window.electronAPI.disconnectSerial();
    };
  }, [clearReconnectTimer, closeSocket, pushTelemetry, stopHealthMonitor]);

  return {
    isConnected,
    isLogging,
    connectionState,
    connectionMessage,
    activeTransport,
    telemetryRef,
    historyRef,
    targetIp,
    connect,
    connectSerial,
    disconnect,
    toggleLogging,
    refreshStatus,
    fetchLogs,
    fetchLogFile,
  };
}
