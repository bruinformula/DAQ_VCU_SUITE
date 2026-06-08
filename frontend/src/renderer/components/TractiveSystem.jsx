import React, { useMemo, useState } from 'react';
import { Zap, ShieldAlert, Activity, Thermometer } from 'lucide-react';
import { createDropoutPlugin } from '../utils/dropoutPlugin';
import ZoomableLine from './ZoomableLine';

export default function TractiveSystem({ data, boardDropouts, startTs }) {
  const [selectedTspmuBoard, setSelectedTspmuBoard] = useState('0'); // '0' or '1'

  // Downsample data for visualization performance
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const valid = data.filter(row => !isNaN(parseFloat(row.ts)));
    
    // Increased targetPoints to 4000 to preserve full high-frequency dropouts/details
    const targetPoints = 4000;
    if (valid.length <= targetPoints) return valid;
    
    const step = Math.ceil(valid.length / targetPoints);
    return valid.filter((_, idx) => idx % step === 0);
  }, [data]);

  // Check if BMS data is present in the current dataset
  const hasBms = useMemo(() => {
    if (processedData.length === 0) return false;
    // Check if bms.v exists in the first row and has a valid number
    const sample = processedData[0];
    return sample['bms.v'] !== undefined && sample['bms.v'] !== null && sample['bms.v'] !== '';
  }, [processedData]);

  // Chart configuration helpers
  const getChartOptions = (yTitle, xTitle = 'Time (s)', secondaryYTitle = null) => {
    const scales = {
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
    };

    if (secondaryYTitle) {
      scales.y1 = {
        title: {
          display: true,
          text: secondaryYTitle,
          color: '#94a3b8',
          font: { family: 'Inter', size: 12 }
        },
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { color: '#64748b', maxTicksLimit: 8 }
      };
    }

    return {
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
          pan: { enabled: false },
          zoom: {
            wheel: { enabled: false },
            pinch: { enabled: true },
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
      scales
    };
  };

  // Helper to merge dropouts from multiple boards without duplicating global gaps
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

  // Dropout highlighter plugins
  const tspmu0Dropouts = boardDropouts?.tspmu0 || [];
  const tspmu1Dropouts = boardDropouts?.tspmu1 || [];
  const bmsDropouts = boardDropouts?.bms || [];

  const combinedTspmuPlugin = useMemo(() => {
    const merged = mergeDropouts(tspmu0Dropouts, tspmu1Dropouts);
    return createDropoutPlugin(merged, startTs);
  }, [tspmu0Dropouts, tspmu1Dropouts, startTs]);

  const tspmu0Plugin = useMemo(() => createDropoutPlugin(tspmu0Dropouts, startTs), [tspmu0Dropouts, startTs]);
  const tspmu1Plugin = useMemo(() => createDropoutPlugin(tspmu1Dropouts, startTs), [tspmu1Dropouts, startTs]);
  
  const selectedTspmuPlugin = useMemo(() => {
    return selectedTspmuBoard === '0' ? tspmu0Plugin : tspmu1Plugin;
  }, [selectedTspmuBoard, tspmu0Plugin, tspmu1Plugin]);

  const bmsPlugin = useMemo(() => createDropoutPlugin(bmsDropouts, startTs), [bmsDropouts, startTs]);

  // Helper to parse a field to continuous linear datasets
  const parseLinearData = (colName) => {
    return processedData.map(row => {
      const val = parseFloat(row[colName]);
      const time = parseFloat(row.ts) - startTs;
      return { x: time, y: isNaN(val) ? null : val };
    });
  };

  // 1. TSPMU Pressures (Board 0 & 1)
  const pressureChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Board 0 Pressure 1 (p1)',
          data: parseLinearData('tspmu[0].p1'),
          borderColor: '#f59e0b', // Amber
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Board 0 Pressure 2 (p2)',
          data: parseLinearData('tspmu[0].p2'),
          borderColor: '#d97706', // Darker Amber
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Board 1 Pressure 1 (p1)',
          data: parseLinearData('tspmu[1].p1'),
          borderColor: '#10b981', // Green
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Board 1 Pressure 2 (p2)',
          data: parseLinearData('tspmu[1].p2'),
          borderColor: '#059669', // Darker Green
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 2. TSPMU Thermistor Temperatures (Selected Board)
  const tspmuTempChartData = useMemo(() => {
    const prefix = `tspmu[${selectedTspmuBoard}]`;
    return {
      datasets: [
        {
          label: 'Temp 1',
          data: parseLinearData(`${prefix}.temps[0]`),
          borderColor: '#60a5fa', // Light Blue
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Temp 2',
          data: parseLinearData(`${prefix}.temps[1]`),
          borderColor: '#3b82f6', // Medium Blue
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Temp 3',
          data: parseLinearData(`${prefix}.temps[2]`),
          borderColor: '#a855f7', // Purple
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Temp 4',
          data: parseLinearData(`${prefix}.temps[3]`),
          borderColor: '#ec4899', // Pink
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [selectedTspmuBoard, processedData, startTs]);

  // BMS Charts (conditional on BMS data existence)
  const bmsPackChartData = useMemo(() => {
    if (!hasBms) return null;
    return {
      datasets: [
        {
          label: 'Pack Voltage (V)',
          data: parseLinearData('bms.v'),
          borderColor: '#10b981', // Green
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
          yAxisID: 'y'
        },
        {
          label: 'Pack Current (A)',
          data: parseLinearData('bms.i'),
          borderColor: '#ef4444', // Red
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
          yAxisID: 'y1'
        }
      ]
    };
  }, [hasBms, processedData, startTs]);

  const bmsCellSpreadChartData = useMemo(() => {
    if (!hasBms) return null;
    return {
      datasets: [
        {
          label: 'High Cell Voltage',
          data: parseLinearData('bms.hi_cv'),
          borderColor: '#10b981', // Green
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Avg Cell Voltage',
          data: parseLinearData('bms.avg_cv'),
          borderColor: '#3b82f6', // Blue
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Low Cell Voltage',
          data: parseLinearData('bms.lo_cv'),
          borderColor: '#f59e0b', // Amber
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [hasBms, processedData, startTs]);

  const bmsTempSpreadChartData = useMemo(() => {
    if (!hasBms) return null;
    return {
      datasets: [
        {
          label: 'High Cell Temp',
          data: parseLinearData('bms.hi_t'),
          borderColor: '#ef4444', // Red
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Avg Cell Temp',
          data: parseLinearData('bms.avg_t'),
          borderColor: '#fb923c', // Orange
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Low Cell Temp',
          data: parseLinearData('bms.lo_t'),
          borderColor: '#60a5fa', // Blue
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [hasBms, processedData, startTs]);

  const bmsSocChartData = useMemo(() => {
    if (!hasBms) return null;
    return {
      datasets: [
        {
          label: 'BMS State of Charge (SoC)',
          data: parseLinearData('bms.soc'),
          borderColor: '#06b6d4', // Cyan
          backgroundColor: 'rgba(6, 182, 212, 0.05)',
          borderWidth: 2,
          fill: true,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [hasBms, processedData, startTs]);

  return (
    <div className="animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* SECTION 1: TSPMU (HV Tractive System Power Management) */}
      <div>
        <h2 className="section-title" style={{ borderLeftColor: 'var(--color-warning)' }}>
          TSPMU Tractive System Monitor
        </h2>
        <p className="text-slate-400" style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          Real-time pressures and temperature thermistors monitoring the isolation state, HV routing, and tractive subsystems.
        </p>

        <div className="grid-cols-2">
          {/* TSPMU Pressures */}
          <div className="glass-panel">
            <h3 className="section-title" style={{ fontSize: '1.15rem' }}>TSPMU Transducer Pressures</h3>
            <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
              HV system line pressure levels in Pascals (Pa). Monitored on Board 0 and Board 1.
            </p>
            <div className="chart-container">
              <ZoomableLine 
                title="TSPMU Transducer Pressures" 
                description="HV system line pressure levels in Pascals (Pa). Monitored on Board 0 and Board 1." 
                options={getChartOptions('Pressure (Pa)')} 
                data={pressureChartData} 
                plugins={[combinedTspmuPlugin]} 
              />
            </div>
          </div>

          {/* TSPMU Board Temperatures */}
          <div className="glass-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 className="section-title" style={{ fontSize: '1.15rem', marginBottom: 0 }}>Board Thermistors</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className={`nav-button ${selectedTspmuBoard === '0' ? 'active' : ''}`}
                  onClick={() => setSelectedTspmuBoard('0')}
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                >
                  Board 0 Temps
                </button>
                <button
                  className={`nav-button ${selectedTspmuBoard === '1' ? 'active' : ''}`}
                  onClick={() => setSelectedTspmuBoard('1')}
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}
                >
                  Board 1 Temps
                </button>
              </div>
            </div>
            <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
              Plots the 4 local board temperature sensors in degrees Celsius (°C) for Board {selectedTspmuBoard}.
            </p>
            <div className="chart-container">
              <ZoomableLine 
                title="Board Thermistors" 
                description={`Plots the 4 local board temperature sensors in degrees Celsius (°C) for Board ${selectedTspmuBoard}.`} 
                options={getChartOptions('Temperature (°C)')} 
                data={tspmuTempChartData} 
                plugins={[selectedTspmuPlugin]} 
              />
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: Accumulator BMS (Battery Management System) */}
      <div>
        <h2 className="section-title" style={{ borderLeftColor: 'var(--color-success)' }}>
          Accumulator BMS Status
        </h2>
        <p className="text-slate-400" style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          Cell safety limits, pack level voltage, current profiles, and state-of-charge tracking.
        </p>

        {hasBms ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="grid-cols-2">
              {/* Pack Voltage & Current */}
              <div className="glass-panel">
                <h3 className="section-title" style={{ fontSize: '1.15rem' }}>Pack Voltage vs Current</h3>
                <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Plots battery pack voltage (green, left) and current draw (red, right). High negative spikes are regenerative braking.
                </p>
                <div className="chart-container">
                  <ZoomableLine 
                    title="Pack Voltage vs Current" 
                    description="Plots battery pack voltage (green, left) and current draw (red, right). High negative spikes are regenerative braking." 
                    options={getChartOptions('Voltage (V)', 'Time (s)', 'Current (A)')} 
                    data={bmsPackChartData} 
                    plugins={[bmsPlugin]} 
                  />
                </div>
              </div>

              {/* Pack SoC */}
              <div className="glass-panel">
                <h3 className="section-title" style={{ fontSize: '1.15rem' }}>State of Charge (SoC)</h3>
                <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Capacity percentage remaining in the accumulator pack over the course of the test run.
                </p>
                <div className="chart-container">
                  <ZoomableLine 
                    title="State of Charge (SoC)" 
                    description="Capacity percentage remaining in the accumulator pack over the course of the test run." 
                    options={getChartOptions('SoC (%)')} 
                    data={bmsSocChartData} 
                    plugins={[bmsPlugin]} 
                  />
                </div>
              </div>
            </div>

            <div className="grid-cols-2">
              {/* Cell Voltages spread */}
              <div className="glass-panel">
                <h3 className="section-title" style={{ fontSize: '1.15rem' }}>Cell Voltage Dispersion</h3>
                <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Compares high, low, and average cell voltages to identify weak cell series groups or imbalances.
                </p>
                <div className="chart-container">
                  <ZoomableLine 
                    title="Cell Voltage Dispersion" 
                    description="Compares high, low, and average cell voltages to identify weak cell series groups or imbalances." 
                    options={getChartOptions('Cell Voltage (V)')} 
                    data={bmsCellSpreadChartData} 
                    plugins={[bmsPlugin]} 
                  />
                </div>
              </div>

              {/* Cell Temperatures spread */}
              <div className="glass-panel">
                <h3 className="section-title" style={{ fontSize: '1.15rem' }}>Cell Temperature Spread</h3>
                <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                  High, low, and average cell temperatures. Keeps track of thermal safety limits.
                </p>
                <div className="chart-container">
                  <ZoomableLine 
                    title="Cell Temperature Spread" 
                    description="High, low, and average cell temperatures. Keeps track of thermal safety limits." 
                    options={getChartOptions('Temperature (°C)')} 
                    data={bmsTempSpreadChartData} 
                    plugins={[bmsPlugin]} 
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="glass-panel text-center py-12" style={{ borderLeft: '4px solid var(--text-muted)' }}>
            <Zap size={40} className="text-slate-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold mb-1">BMS Telemetry Offline</h3>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              Accumulator BMS CAN frames are not detected in the current run file (<strong>{data?.[0]?.['gps.lat'] !== undefined ? 'SDU/GPS focus run' : 'Unknown run'}</strong>). Check standard autocross/brakes runs to view BMS logs.
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
