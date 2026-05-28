import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export default function TelemetryChart({ telemetryRef, isConnected }) {
  const chartRef = useRef(null);
  const uplotInst = useRef(null);
  const dataRef = useRef([[], [], []]); // [timestamps, motor_speed, pack_v]

  useEffect(() => {
    if (!chartRef.current) return;

    // uPlot configuration
    const opts = {
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight,
      title: "Powertrain Telemetry (50Hz)",
      series: [
        { label: "Time" },
        {
          label: "Motor RPM",
          stroke: "#00e5ff",
          width: 2,
        },
        {
          label: "Pack Voltage",
          stroke: "#00ff7f",
          width: 2,
          scale: "v"
        }
      ],
      axes: [
        { grid: { stroke: "rgba(255,255,255,0.1)" }, stroke: "rgba(255,255,255,0.5)" },
        { grid: { stroke: "rgba(255,255,255,0.1)" }, stroke: "rgba(255,255,255,0.5)" },
        { 
          scale: "v", 
          side: 1, 
          grid: { show: false },
          stroke: "rgba(255,255,255,0.5)"
        }
      ],
      scales: {
        x: { time: false }, // Use simple relative counters or pure timestamps for performance
        v: { auto: true }
      }
    };

    const u = new uPlot(opts, dataRef.current, chartRef.current);
    uplotInst.current = u;

    // Handle window resize
    const handleResize = () => {
      u.setSize({
        width: chartRef.current.clientWidth,
        height: chartRef.current.clientHeight
      });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      u.destroy();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Polling loop to push data from telemetryRef into uPlot at screen refresh rate
  useEffect(() => {
    let animationFrameId;
    let lastTimestamp = 0;
    
    // Keep max 500 points on screen for the "oscilloscope" effect
    const MAX_POINTS = 500; 

    const tick = () => {
      if (isConnected && telemetryRef.current) {
        const data = telemetryRef.current;
        
        // Only append if the timestamp moved forward (new data arrived)
        if (data.timestamp > lastTimestamp) {
          lastTimestamp = data.timestamp;
          
          const times = dataRef.current[0];
          const speeds = dataRef.current[1];
          const volts = dataRef.current[2];

          times.push(data.timestamp);
          speeds.push(data.can.INV_Motor_Speed);
          volts.push(data.can.Pack_Summed_Voltage);

          // Shift out old data
          if (times.length > MAX_POINTS) {
            times.shift();
            speeds.shift();
            volts.shift();
          }

          // Native WebGL/Canvas update, totally bypasses React!
          if (uplotInst.current) {
            uplotInst.current.setData(dataRef.current);
          }
        }
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(animationFrameId);
  }, [isConnected, telemetryRef]);

  return <div ref={chartRef} style={{ width: '100%', height: '100%' }} />;
}
