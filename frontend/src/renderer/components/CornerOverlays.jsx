import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { RefreshCw } from 'lucide-react';
import { createDropoutPlugin } from '../utils/dropoutPlugin';
import ZoomableLine from './ZoomableLine';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  zoomPlugin
);

function TireHeatmapCanvas({ data, cornerIndex, startTs }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear background
    ctx.fillStyle = '#0f172a'; // Deep slate
    ctx.fillRect(0, 0, width, height);

    // Margins
    const marginLeft = 50;
    const marginRight = 55;
    const marginTop = 30;
    const marginBottom = 35;

    const plotWidth = width - marginLeft - marginRight;
    const plotHeight = height - marginTop - marginBottom;

    // Grid sizes
    const numRows = 4; // 4 tire channels
    const numCols = data.length;

    // Map temperature to HSL color matching MATLAB Parula/Jet look
    const getColor = (temp) => {
      if (isNaN(temp) || temp <= 0 || temp < 20) {
        return '#2e1065'; // Deep purple/black for dropouts
      }
      
      const minT = 40;
      const maxT = 70;
      const ratio = Math.max(0, Math.min(1, (temp - minT) / (maxT - minT)));
      
      // Interpolate Hue: 240 (blue) -> 120 (green) -> 60 (yellow) -> 20 (orange-red)
      const hue = 240 - ratio * 200; // 240 (blue) down to 40 (orange/red)
      return `hsl(${hue}, 85%, 50%)`;
    };

    // Draw Heatmap grid
    const colWidth = plotWidth / numCols;
    const rowHeight = plotHeight / numRows;

    const prefix = `sdu[${cornerIndex}]`;

    for (let c = 0; c < numCols; c++) {
      const rowData = data[c];
      const x = marginLeft + c * colWidth;
      
      for (let r = 0; r < numRows; r++) {
        // Y-axis 1 is Outer (tire[0]) at bottom, Y=4 is Inner (tire[3]) at top
        const channelIndex = r;
        const drawY = marginTop + (3 - r) * rowHeight;
        
        const tempVal = parseFloat(rowData[`${prefix}.tire[${channelIndex}]`]);
        ctx.fillStyle = getColor(tempVal);
        ctx.fillRect(x, drawY, Math.max(1, colWidth + 0.3), rowHeight + 0.3);
      }
    }

    // Axes and ticks
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;

    // X-axis line
    ctx.beginPath();
    ctx.moveTo(marginLeft, marginTop + plotHeight);
    ctx.lineTo(marginLeft + plotWidth, marginTop + plotHeight);
    ctx.stroke();

    // Y-axis line
    ctx.beginPath();
    ctx.moveTo(marginLeft, marginTop);
    ctx.lineTo(marginLeft, marginTop + plotHeight);
    ctx.stroke();

    // Text configuration
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Y ticks
    for (let r = 0; r < numRows; r++) {
      const labelY = marginTop + (3 - r) * rowHeight + rowHeight / 2;
      ctx.fillText(String(r + 1), marginLeft - 8, labelY);
    }

    // Y-axis title
    ctx.save();
    ctx.translate(15, marginTop + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Tire Position', 0, 0);
    ctx.restore();

    // X ticks
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const numTicks = 5;
    for (let i = 0; i < numTicks; i++) {
      const idx = Math.floor((i / (numTicks - 1)) * (numCols - 1));
      if (data[idx]) {
        const timeVal = (parseFloat(data[idx].ts) - startTs).toFixed(0);
        const tickX = marginLeft + (i / (numTicks - 1)) * plotWidth;
        
        ctx.beginPath();
        ctx.moveTo(tickX, marginTop + plotHeight);
        ctx.lineTo(tickX, marginTop + plotHeight + 4);
        ctx.stroke();
        
        ctx.fillText(`${timeVal}s`, tickX, marginTop + plotHeight + 6);
      }
    }

    // X-axis title
    ctx.fillText('Time (s)', marginLeft + plotWidth / 2, marginTop + plotHeight + 20);

    // Colorbar gradient on the right
    const barLeft = marginLeft + plotWidth + 15;
    const barWidth = 10;
    const barHeight = plotHeight;

    const grad = ctx.createLinearGradient(0, marginTop + barHeight, 0, marginTop);
    for (let i = 0; i <= 10; i++) {
      const temp = 40 + i * 3;
      grad.addColorStop(i / 10, getColor(temp));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(barLeft, marginTop, barWidth, barHeight);

    // Colorbar border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.strokeRect(barLeft, marginTop, barWidth, barHeight);

    // Colorbar ticks
    ctx.fillStyle = '#94a3b8';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const numColorTicks = 4;
    for (let i = 0; i < numColorTicks; i++) {
      const val = 40 + i * 10;
      const tickY = marginTop + barHeight - (i / (numColorTicks - 1)) * barHeight;
      ctx.fillText(String(val), barLeft + barWidth + 5, tickY);
    }

    // Title
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const corners = ['FL', 'FR', 'RL', 'RR'];
    ctx.fillText(`Tire Temperature (${corners[cornerIndex]})`, marginLeft + plotWidth / 2, 8);

  }, [data, cornerIndex, startTs]);

  return (
    <div style={{ position: 'relative', background: '#0f172a', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)', padding: '0.5rem' }}>
      <canvas
        ref={canvasRef}
        width={380}
        height={210}
        style={{
          width: '100%',
          height: '210px',
          display: 'block'
        }}
      />
    </div>
  );
}

export default function CornerOverlays({ data, boardDropouts, startTs = 0 }) {
  const [selectedTireCorner, setSelectedTireCorner] = useState('0'); // 0=FL, 1=FR, 2=RL, 3=RR

  // Downsample data if too large to ensure high performance
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const valid = data.filter(row => !isNaN(parseFloat(row.ts)));
    
    // Increased targetPoints to 4000 to preserve full high-frequency dropouts/details
    const targetPoints = 4000;
    if (valid.length <= targetPoints) return valid;
    
    const step = Math.ceil(valid.length / targetPoints);
    return valid.filter((_, idx) => idx % step === 0);
  }, [data]);

  const timestamps = useMemo(() => {
    if (processedData.length === 0) return [];
    return processedData.map(row => (parseFloat(row.ts) - startTs).toFixed(2));
  }, [processedData, startTs]);

  // Chart configuration helpers
  const getChartOptions = (yTitle, xTitle = 'Time (s)') => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#e2e8f0',
          font: { family: 'Inter', size: 11, weight: 500 }
        }
      },
      zoom: {
        pan: {
          enabled: false,
        },
        zoom: {
          wheel: {
            enabled: false,
          },
          pinch: {
            enabled: true
          },
          mode: 'x',
        }
      },
      tooltip: {
        mode: 'nearest',
        intersect: false,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 10,
        bodyFont: { family: 'var(--font-mono)', size: 12 }
      }
    },
    scales: {
      x: {
        type: 'linear',
        title: {
          display: true,
          text: xTitle,
          color: '#94a3b8',
          font: { family: 'Inter', size: 12 }
        },
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#64748b', maxTicksLimit: 10 }
      },
      y: {
        title: {
          display: true,
          text: yTitle,
          color: '#94a3b8',
          font: { family: 'Inter', size: 12 }
        },
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#64748b', maxTicksLimit: 8 }
      }
    }
  });

  // Helper to merge dropouts from multiple SDU boards without duplicating global gaps
  const mergeDropouts = (...dropoutLists) => {
    const merged = [];
    const seenGlobals = new Set();
    
    dropoutLists.forEach(list => {
      if (!list) return;
      list.forEach(gap => {
        if (gap.label === 'LOG DROP') {
          const key = `${gap.startTime.toFixed(2)}-${gap.endTime.toFixed(2)}`;
          if (seenGlobals.has(key)) return;
          seenGlobals.add(key);
        }
        merged.push(gap);
      });
    });
    return merged;
  };

  const sdu0Dropouts = boardDropouts?.sdu0 || [];
  const sdu1Dropouts = boardDropouts?.sdu1 || [];
  const sdu2Dropouts = boardDropouts?.sdu2 || [];
  const sdu3Dropouts = boardDropouts?.sdu3 || [];

  const comparisonPlugin = useMemo(() => {
    const merged = mergeDropouts(sdu0Dropouts, sdu1Dropouts, sdu2Dropouts, sdu3Dropouts);
    return createDropoutPlugin(merged, startTs);
  }, [sdu0Dropouts, sdu1Dropouts, sdu2Dropouts, sdu3Dropouts, startTs]);

  const selectedCornerPlugin = useMemo(() => {
    let list = [];
    if (selectedTireCorner === '0') list = sdu0Dropouts;
    else if (selectedTireCorner === '1') list = sdu1Dropouts;
    else if (selectedTireCorner === '2') list = sdu2Dropouts;
    else if (selectedTireCorner === '3') list = sdu3Dropouts;
    return createDropoutPlugin(list, startTs);
  }, [selectedTireCorner, sdu0Dropouts, sdu1Dropouts, sdu2Dropouts, sdu3Dropouts, startTs]);

  // Helper to parse a field to continuous linear datasets
  const parseLinearData = (colName) => {
    return processedData.map(row => {
      const val = parseFloat(row[colName]);
      const time = parseFloat((parseFloat(row.ts) - startTs).toFixed(2));
      return { x: time, y: isNaN(val) ? null : val };
    });
  };

  // 1. Brake Temperatures Overlay
  const brakesChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'FL Brake',
          data: parseLinearData('sdu[0].brake'),
          borderColor: 'rgba(249, 115, 22, 0.85)', // FL Color (Orange)
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'FR Brake',
          data: parseLinearData('sdu[1].brake'),
          borderColor: 'rgba(6, 182, 212, 0.85)', // FR Color (Cyan)
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'RL Brake',
          data: parseLinearData('sdu[2].brake'),
          borderColor: 'rgba(16, 185, 129, 0.85)', // RL Color (Green)
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'RR Brake',
          data: parseLinearData('sdu[3].brake'),
          borderColor: 'rgba(139, 92, 246, 0.85)', // RR Color (Purple)
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 2. Suspension Travels Overlay (Zero-offset relative to the first valid value)
  const shocksChartData = useMemo(() => {
    // Find initial static values for each shock pot (first valid numeric entry)
    const flInit = data.length > 0 ? parseFloat(data.find(row => !isNaN(parseFloat(row['sdu[0].shock'])))?.['sdu[0].shock']) || 0 : 0;
    const frInit = data.length > 0 ? parseFloat(data.find(row => !isNaN(parseFloat(row['sdu[1].shock'])))?.['sdu[1].shock']) || 0 : 0;
    const rlInit = data.length > 0 ? parseFloat(data.find(row => !isNaN(parseFloat(row['sdu[2].shock'])))?.['sdu[2].shock']) || 0 : 0;
    const rrInit = data.length > 0 ? parseFloat(data.find(row => !isNaN(parseFloat(row['sdu[3].shock'])))?.['sdu[3].shock']) || 0 : 0;

    const parseShockData = (col, initVal) => {
      return processedData.map(row => {
        const val = parseFloat(row[col]);
        const time = parseFloat((parseFloat(row.ts) - startTs).toFixed(2));
        return { x: time, y: isNaN(val) ? null : (val - initVal) };
      });
    };

    return {
      datasets: [
        {
          label: 'FL Suspension',
          data: parseShockData('sdu[0].shock', flInit),
          borderColor: 'rgba(249, 115, 22, 0.85)',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'FR Suspension',
          data: parseShockData('sdu[1].shock', frInit),
          borderColor: 'rgba(6, 182, 212, 0.85)',
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'RL Suspension',
          data: parseShockData('sdu[2].shock', rlInit),
          borderColor: 'rgba(16, 185, 129, 0.85)',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'RR Suspension',
          data: parseShockData('sdu[3].shock', rrInit),
          borderColor: 'rgba(139, 92, 246, 0.85)',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs, data]);

  // 3. Wheel RPMs Overlay
  const rpmChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'FL RPM',
          data: parseLinearData('sdu[0].wrpm'),
          borderColor: 'rgba(249, 115, 22, 0.85)',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'FR RPM',
          data: parseLinearData('sdu[1].wrpm'),
          borderColor: 'rgba(6, 182, 212, 0.85)',
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'RL RPM',
          data: parseLinearData('sdu[2].wrpm'),
          borderColor: 'rgba(16, 185, 129, 0.85)',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'RR RPM',
          data: parseLinearData('sdu[3].wrpm'),
          borderColor: 'rgba(139, 92, 246, 0.85)',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 4. Tire Temperatures (4 channels across the tread: Inner, Middle-Inner, Middle-Outer, Outer)
  const tireChartData = useMemo(() => {
    const prefix = `sdu[${selectedTireCorner}]`;
    return {
      datasets: [
        {
          label: 'Channel 0 (Outer)',
          data: parseLinearData(`${prefix}.tire[0]`),
          borderColor: '#ef4444',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Channel 1 (Mid-Outer)',
          data: parseLinearData(`${prefix}.tire[1]`),
          borderColor: '#f97316',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Channel 2 (Mid-Inner)',
          data: parseLinearData(`${prefix}.tire[2]`),
          borderColor: '#10b981',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Channel 3 (Inner)',
          data: parseLinearData(`${prefix}.tire[3]`),
          borderColor: '#3b82f6',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [selectedTireCorner, processedData, startTs]);

  const cornerLabels = [
    { value: '0', text: 'Front Left', className: 'corner-fl' },
    { value: '1', text: 'Front Right', className: 'corner-fr' },
    { value: '2', text: 'Rear Left', className: 'corner-rl' },
    { value: '3', text: 'Rear Right', className: 'corner-rr' },
  ];

  return (
    <div className="animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* 2x2 Grid for Brake and Shock Travel Overlays */}
      <div className="grid-cols-2">
        {/* Brake Temperatures Overlay */}
        <div className="glass-panel">
          <h2 className="section-title">Brake Temperatures Overlay</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Comparison of brake temperatures from all four corners. Click labels to toggle, drag to zoom, double-click to reset.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Brake Temperatures Overlay" 
              description="Comparison of brake temperatures from all four corners." 
              options={getChartOptions('Temperature (°C)')} 
              data={brakesChartData} 
              plugins={[comparisonPlugin]} 
            />
          </div>
        </div>

        {/* Suspension Travels Overlay */}
        <div className="glass-panel">
          <h2 className="section-title">Suspension Shock Travel</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Comparison of damper displacement from all four corners. Helpful for checking roll, pitch, and bump response.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Suspension Shock Travel" 
              description="Comparison of damper displacement from all four corners." 
              options={getChartOptions('Displacement (mm)')} 
              data={shocksChartData} 
              plugins={[comparisonPlugin]} 
            />
          </div>
        </div>
      </div>

      {/* Second Row: Wheel Speed and Tire Temperature Gradient */}
      <div className="grid-cols-2">
        {/* Wheel Speeds (RPM) Overlay */}
        <div className="glass-panel">
          <h2 className="section-title">Wheel Speeds (RPM)</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Rotational speeds of all four wheels. Overlay is critical for checking lock-ups and wheel spin profiles.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Wheel Speeds (RPM)" 
              description="Rotational speeds of all four wheels." 
              options={getChartOptions('Rotations Per Minute (RPM)')} 
              data={rpmChartData} 
              plugins={[comparisonPlugin]} 
            />
          </div>
        </div>

        {/* Tire Thermal Gradient Profile */}
        <div className="glass-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h2 className="section-title" style={{ marginBottom: 0 }}>Tire Thermal Gradient</h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {cornerLabels.map(item => (
                <button
                  key={item.value}
                  className={`nav-button ${selectedTireCorner === item.value ? 'active' : ''}`}
                  onClick={() => setSelectedTireCorner(item.value)}
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                >
                  <span className={`corner-label ${item.className}`} style={{ padding: 0, background: 'transparent' }}>
                    {item.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Plots the 4 infrared tire temp channels (inner edge to outer edge) of the selected tire to analyze heat spread.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Tire Thermal Gradient" 
              description="Plots the 4 infrared tire temp channels (inner edge to outer edge) of the selected tire to analyze heat spread." 
              options={getChartOptions('Temperature (°C)')} 
              data={tireChartData} 
              plugins={[selectedCornerPlugin]} 
            />
          </div>
        </div>
      </div>

      {/* Third Row: 2D Tire Temperature Heatmap Gradients */}
      <div className="glass-panel" style={{ marginTop: '2rem' }}>
        <h2 className="section-title">2D Tire Temperature Heatmap Profiles</h2>
        <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1.5rem' }}>
          2D spectrogram-style tire thermal tread profile gradients across the four tires (Outer (1) to Inner (4) channels from bottom to top). Deep purple represents telemetry dropouts.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
          <TireHeatmapCanvas data={processedData} cornerIndex={0} startTs={startTs} />
          <TireHeatmapCanvas data={processedData} cornerIndex={1} startTs={startTs} />
          <TireHeatmapCanvas data={processedData} cornerIndex={2} startTs={startTs} />
          <TireHeatmapCanvas data={processedData} cornerIndex={3} startTs={startTs} />
        </div>
      </div>
    </div>
  );
}
