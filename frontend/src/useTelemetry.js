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
    timestamp: 0,
    can: { Pack_SOC: 0, Pack_Summed_Voltage: 0, INV_Motor_Speed: 0 },
    mdu: { suspension_fl: 0, steering_angle: 0 },
    is_logging: false
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
          if (data.is_logging !== isLogging) {
            setIsLogging(data.is_logging);
          }
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
  }, [isLogging]);

  const toggleLogging = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    const cmd = {
      action: isLogging ? "STOP_LOG" : "START_LOG"
    };
    
    wsRef.current.send(JSON.stringify(cmd));
  };

  return { isConnected, isLogging, telemetryRef, toggleLogging };
}
