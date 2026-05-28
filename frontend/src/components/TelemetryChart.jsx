import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { SIGNAL_MAP, getSignalValue } from '../signals';

export default function TelemetryChart({ telemetryRef, isConnected, selectedSignals }) {
  const chartRef = useRef(null);
  const uplotInst = useRef(null);
  
  // Array of arrays: [timestamps, series1, series2, ...]
  const dataRef = useRef([]);

  useEffect(() => {
    if (!chartRef.current) return;

    // Build series configuration based on selected signals
    const activeSignals = selectedSignals.map(id => SIGNAL_MAP[id]).filter(Boolean);
    
    // Reset data buffer for the new series configuration
    // Initialize with empty arrays: one for time, plus one for each active signal
    dataRef.current = [[]];
    activeSignals.forEach(() => dataRef.current.push([]));

    // Gather unique units to create axes/scales
    const units = [...new Set(activeSignals.map(s => s.unit))];
    
    const scales = { x: { time: false } };
    const axes = [
      { grid: { stroke: "rgba(255,255,255,0.1)" }, stroke: "rgba(255,255,255,0.5)" }
    ];

    units.forEach((unit, idx) => {
      scales[unit] = { auto: true };
      axes.push({
        scale: unit,
        side: idx % 2 === 0 ? 3 : 1, // Alternate sides (3=right, 1=left)
        grid: { show: idx === 0 ? true : false, stroke: "rgba(255,255,255,0.05)" },
        stroke: "rgba(255,255,255,0.5)",
        values: (u, vals) => vals.map(v => v + unit),
        size: 80 // Provide enough space so large numbers aren't clipped
      });
    });

    const seriesConfig = [
      { label: "Time" },
      ...activeSignals.map(s => ({
        label: s.name,
        stroke: s.color,
        width: 2,
        scale: s.unit
      }))
    ];

    const opts = {
      width: chartRef.current.clientWidth || 800,
      height: chartRef.current.clientHeight || 400,
      title: "Powertrain Telemetry (50Hz)",
      series: seriesConfig,
      axes: axes,
      scales: scales
    };

    const u = new uPlot(opts, dataRef.current, chartRef.current);
    uplotInst.current = u;

    // Handle container resize dynamically
    const handleResize = () => {
      if (chartRef.current && uplotInst.current) {
        uplotInst.current.setSize({
          width: chartRef.current.clientWidth,
          height: chartRef.current.clientHeight
        });
      }
    };
    
    const resizeObserver = new ResizeObserver(handleResize);
    if (chartRef.current) {
      resizeObserver.observe(chartRef.current);
    }

    return () => {
      u.destroy();
      uplotInst.current = null;
      resizeObserver.disconnect();
    };
  }, [selectedSignals]);

  // Polling loop to push data from telemetryRef into uPlot at screen refresh rate
  useEffect(() => {
    let animationFrameId;
    let lastTimestamp = 0;
    
    // Wipe the data buffer cleanly upon reconnection to prevent massive time gaps
    // from squishing the X-axis scale and making the graph appear frozen.
    if (dataRef.current && dataRef.current.length > 0) {
      dataRef.current.forEach(arr => {
        arr.length = 0; // Clear array in-place
      });
    }
    
    // Keep max 500 points on screen for the "oscilloscope" effect (10 seconds at 50Hz)
    const MAX_POINTS = 500; 

    const tick = () => {
      if (isConnected && telemetryRef.current && uplotInst.current && dataRef.current.length > 0) {
        const data = telemetryRef.current;
        
        // Only append if the timestamp moved forward (new data arrived)
        if (data.ts > lastTimestamp) {
          lastTimestamp = data.ts;
          
          const activeSignals = selectedSignals.map(id => SIGNAL_MAP[id]).filter(Boolean);
          
          // dataRef.current[0] is time
          dataRef.current[0].push(data.ts);
          
          // Push each active signal's value
          activeSignals.forEach((signal, idx) => {
            const val = getSignalValue(data, signal.id);
            dataRef.current[idx + 1].push(val !== undefined ? val : null);
          });

          // Shift out old data
          if (dataRef.current[0].length > MAX_POINTS) {
            dataRef.current.forEach(arr => arr.shift());
          }

          // Native WebGL/Canvas update, totally bypasses React!
          uplotInst.current.setData(dataRef.current);
        }
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(animationFrameId);
  }, [isConnected, telemetryRef, selectedSignals]);

  return <div ref={chartRef} style={{ width: '100%', height: '100%' }} />;
}
