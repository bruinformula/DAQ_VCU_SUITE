import React, { useMemo } from 'react';
import { Zap, Activity, Thermometer } from 'lucide-react';
import { createDropoutPlugin } from '../utils/dropoutPlugin';
import ZoomableLine from './ZoomableLine';

export default function Drivetrain({ data, boardDropouts, startTs }) {
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

  // Helper to parse a field to continuous linear datasets
  const parseLinearData = (colName, scale = 1.0) => {
    return processedData.map(row => {
      const val = parseFloat(row[colName]);
      const time = parseFloat((parseFloat(row.ts) - startTs).toFixed(2));
      return { x: time, y: isNaN(val) ? null : val * scale };
    });
  };

  // Dropout highlighter plugins
  const inverterPlugin = useMemo(() => createDropoutPlugin(boardDropouts?.inverter, startTs), [boardDropouts, startTs]);
  const tshmuPlugin = useMemo(() => createDropoutPlugin(boardDropouts?.tshmu, startTs), [boardDropouts, startTs]);

  // 1. Inverter and Motor Temperatures
  const tempChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Motor Temperature',
          data: parseLinearData('inv.mot_t'),
          borderColor: '#ef4444', // Red
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Inverter Coolant',
          data: parseLinearData('inv.cool_t'),
          borderColor: '#3b82f6', // Blue
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Gate Driver Board',
          data: parseLinearData('inv.all.gate_driver_board_temp'),
          borderColor: '#10b981', // Green
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 2. Torque Cmd vs Torque Feedback
  const torqueChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Torque Command',
          data: parseLinearData('inv.tq_cmd'),
          borderColor: '#f59e0b', // Amber
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Torque Feedback',
          data: parseLinearData('inv.tq_fb'),
          borderColor: '#a855f7', // Purple
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 3. DC Bus Current (Inverter Current)
  const currentChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'DC Link Current',
          data: parseLinearData('inv.idc'),
          borderColor: '#06b6d4', // Cyan
          backgroundColor: 'rgba(6, 182, 212, 0.05)',
          borderWidth: 2,
          fill: true,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 4. Coolant Flow Rates & PMU stats
  const coolingChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'B0 Flow 1',
          data: parseLinearData('tshmu[0].flow1'),
          borderColor: '#3b82f6', // Blue
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'B0 Flow 2',
          data: parseLinearData('tshmu[0].flow2'),
          borderColor: '#60a5fa', // Light Blue
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'B1 Flow 1',
          data: parseLinearData('tshmu[1].flow1'),
          borderColor: '#10b981', // Green
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'B1 Flow 2',
          data: parseLinearData('tshmu[1].flow2'),
          borderColor: '#34d399', // Light Green
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Jitter (x0.1 us)',
          data: parseLinearData('tshmu[0].jitter_us', 1.0 / 10),
          borderColor: '#ec4899', // Pink
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  return (
    <div className="animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      <div className="grid-cols-2">
        {/* Torque Command vs Feedback */}
        <div className="glass-panel">
          <h2 className="section-title">Inverter Torque Overlay</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Compares motor torque request (Command) vs actual motor torque (Feedback). Translucent red bands indicate data dropouts.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Inverter Torque Overlay" 
              description="Compares motor torque request (Command) vs actual motor torque (Feedback)." 
              options={getChartOptions('Torque (Nm)')} 
              data={torqueChartData} 
              plugins={[inverterPlugin]} 
            />
          </div>
        </div>

        {/* Drivetrain Temperatures */}
        <div className="glass-panel">
          <h2 className="section-title">Motor & Inverter Cooling Temps</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Rotor windings (Motor) vs cooling circuit (Inverter Coolant) and gate driver temperatures.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Motor & Inverter Cooling Temps" 
              description="Rotor windings (Motor) vs cooling circuit (Inverter Coolant) and gate driver temperatures." 
              options={getChartOptions('Temperature (°C)')} 
              data={tempChartData} 
              plugins={[inverterPlugin]} 
            />
          </div>
        </div>
      </div>

      <div className="grid-cols-2">
        {/* DC Link Current */}
        <div className="glass-panel">
          <h2 className="section-title">Battery DC Link Current</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Current draw from accumulator pack into the inverter stage. High spikes indicate heavy acceleration.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Battery DC Link Current" 
              description="Current draw from accumulator pack into the inverter stage." 
              options={getChartOptions('Current (Amps)')} 
              data={currentChartData} 
              plugins={[inverterPlugin]} 
            />
          </div>
        </div>

        {/* Cooling Circuit Flow Rates & Jitter */}
        <div className="glass-panel">
          <h2 className="section-title">Flow Rate & Bus Jitter</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Coolant flow meters from the TSHMU and communication bus jitter.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Flow Rate & Bus Jitter" 
              description="Coolant flow meters from the TSHMU and communication bus jitter." 
              options={getChartOptions('Flow (L/min) / Jitter')} 
              data={coolingChartData} 
              plugins={[tshmuPlugin]} 
            />
          </div>
        </div>
      </div>

    </div>
  );
}
