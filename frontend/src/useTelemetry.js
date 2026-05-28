import { useState, useEffect, useRef } from 'react';

// Using the default WebSocket port we configured in FastAPI (8000)
const WS_URL = 'ws://localhost:8000/ws';

export function useTelemetry() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const wsRef = useRef(null);

  // Instead of updating React state at 50Hz (which kills performance),
  // we keep the latest telemetry frame in a highly accessible ref object.
  // The React components will read from this ref using requestAnimationFrame,
  // or pass this ref directly to uPlot for native rendering.
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

  useEffect(() => {
    let reconnectTimer;

    function connect() {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          telemetryRef.current = data;
          
          // Only update React state for UI-breaking changes to prevent 50Hz re-renders
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
        // Attempt to reconnect every 2 seconds
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = (err) => {
        ws.close();
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const toggleLogging = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    const cmd = {
      action: isLogging ? "STOP_LOG" : "START_LOG"
    };
    
    wsRef.current.send(JSON.stringify(cmd));
  };

  return { isConnected, isLogging, telemetryRef, toggleLogging };
}
