import { useState, useEffect, useRef, useCallback } from 'react';

export function useTelemetry() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const targetIpRef = useRef(null);

  const telemetryRef = useRef({
    ts: 0,
    gps: { lat: 0, lon: 0, alt: 0, vel: 0, hdg: 0, fix: 0, sats: 0 },
    imu: { ax: 0, ay: 0, az: 0, pitch: 0, roll: 0, yaw: 0, cal: 0 },
    inv: { rpm: 0, mot_t: 0, cool_t: 0, vdc: 0, idc: 0, tq_cmd: 0, tq_fb: 0, vsm: 0, faults: 0 },
    bms: { v: 0, i: 0, soc: 0, hi_t: 0, lo_t: 0, hi_cv: 0, lo_cv: 0, dcl: 0 },
    vcu: { spd: 0, apps1: 0, apps2: 0, bse: 0, rtd: 0 },
    sdu: [
      { pos: 'FL', shock: 0, brake: 0, wrpm: 0, tire: [0,0,0,0] },
      { pos: 'FR', shock: 0, brake: 0, wrpm: 0, tire: [0,0,0,0] },
      { pos: 'RL', shock: 0, brake: 0, wrpm: 0, tire: [0,0,0,0] },
      { pos: 'RR', shock: 0, brake: 0, wrpm: 0, tire: [0,0,0,0] },
    ],
    log: false,
    stats: { parsed: 0, errors: 0 }
  });

  const disconnect = useCallback(() => {
    targetIpRef.current = null;
    clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (window.electronAPI) {
      window.electronAPI.disconnectSerial();
      setIsConnected(false);
    }
  }, []);

  const connect = useCallback((ip) => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    targetIpRef.current = ip;
    const wsUrl = `ws://${ip}:8000/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        telemetryRef.current = data;
        
        setIsLogging(prev => {
          if (prev !== data.log) return data.log;
          return prev;
        });
      } catch (err) {
        console.error("Telemetry parsing error", err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsLogging(false);
      // Attempt to reconnect every 2 seconds if we have a target IP
      if (targetIpRef.current) {
        reconnectTimerRef.current = setTimeout(() => connect(targetIpRef.current), 2000);
      }
    };

    ws.onerror = (err) => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  const connectSerial = useCallback(async (portPath, baudRate = 115200) => {
    if (!window.electronAPI) return;
    
    disconnect(); // Ensure WS is closed
    
    const result = await window.electronAPI.connectSerial(portPath, baudRate);
    if (result.success) {
      setIsConnected(true);
    } else {
      alert("Failed to connect to serial port: " + result.error);
    }
  }, [disconnect]);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onSerialData((data) => {
        try {
          const parsed = JSON.parse(data);
          telemetryRef.current = parsed;
          setIsLogging(prev => {
            if (prev !== parsed.log) return parsed.log;
            return prev;
          });
        } catch (err) {
          // Ignore partial or malformed serial lines
        }
      });

      window.electronAPI.onSerialDisconnected(() => {
        setIsConnected(false);
        setIsLogging(false);
      });
    }

    return () => {
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
      if (window.electronAPI) window.electronAPI.disconnectSerial();
    };
  }, []);

  const toggleLogging = () => {
    // Note: Serial backup cannot currently toggle logging since it is a one-way broadcast from Pi to Mac.
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("Cannot toggle logging over serial backup. Connect via Wi-Fi.");
      return;
    }
    
    const cmd = {
      action: isLogging ? "STOP_LOG" : "START_LOG"
    };
    
    wsRef.current.send(JSON.stringify(cmd));
  };

  return { isConnected, isLogging, telemetryRef, toggleLogging, connect, connectSerial, disconnect };
}
