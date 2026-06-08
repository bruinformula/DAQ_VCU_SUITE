import React, { useMemo } from 'react';
import { Compass, ShieldAlert, Activity } from 'lucide-react';
import { createDropoutPlugin } from '../utils/dropoutPlugin';
import ZoomableLine from './ZoomableLine';

export default function ImuMotion({ data, boardDropouts, startTs }) {
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

  // Dropout highlighter plugin
  const imuPlugin = useMemo(() => createDropoutPlugin(boardDropouts?.imu, startTs), [boardDropouts, startTs]);

  // 1. Primary IMU G-forces
  const gForceChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Longitudinal Gs (ax)',
          data: parseLinearData('imu.ax', 1.0 / 9.80665),
          borderColor: '#ef4444', // Red
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Lateral Gs (ay)',
          data: parseLinearData('imu.ay', 1.0 / 9.80665),
          borderColor: '#3b82f6', // Blue
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Vertical Gs (az)',
          data: parseLinearData('imu.az', 1.0 / 9.80665),
          borderColor: '#10b981', // Green
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 2. Longitudinal G comparison across 3 sensors (twist/pitch analysis)
  const axComparisonChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Front/GPS IMU (ax)',
          data: parseLinearData('imu[0].ax', 1.0 / 9.80665), // scaled to Gs
          borderColor: '#f97316', // Orange
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Mid IMU (ax)',
          data: parseLinearData('imu[1].ax'), // already in Gs
          borderColor: '#06b6d4', // Cyan
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Rear IMU (ax)',
          data: parseLinearData('imu[2].ax'), // already in Gs
          borderColor: '#8b5cf6', // Purple
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 3. Lateral G comparison across 3 sensors (chassis yaw/flex analysis)
  const ayComparisonChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Front/GPS IMU (ay)',
          data: parseLinearData('imu[0].ay', 1.0 / 9.80665), // scaled to Gs
          borderColor: '#f97316',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Mid IMU (ay)',
          data: parseLinearData('imu[1].ay'), // already in Gs
          borderColor: '#06b6d4',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Rear IMU (ay)',
          data: parseLinearData('imu[2].ay'), // already in Gs
          borderColor: '#8b5cf6',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  // 4. Angular Rates (Roll, Pitch, Yaw)
  const gyroChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Roll Rate',
          data: parseLinearData('imu.roll'),
          borderColor: '#eab308', // Yellow
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Pitch Rate',
          data: parseLinearData('imu.pitch'),
          borderColor: '#ec4899', // Pink
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Yaw Rate',
          data: parseLinearData('imu.yaw'),
          borderColor: '#6366f1', // Indigo
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs]);

  const latestRow = data && data.length > 0 ? data[data.length - 1] : null;

  const maxG = 2.0;
  const getImuCoords = (row, index) => {
    let ax = 0;
    let ay = 0;
    let valid = false;
    
    if (row) {
      if (index === 0) {
        ax = parseFloat(row['imu[0].ax']) || parseFloat(row['imu.ax']) || 0;
        ay = parseFloat(row['imu[0].ay']) || parseFloat(row['imu.ay']) || 0;
        valid = !isNaN(parseFloat(row['imu[0].ax'])) || !isNaN(parseFloat(row['imu.ax']));
      } else if (index === 1) {
        ax = parseFloat(row['imu[1].ax']) || 0;
        ay = parseFloat(row['imu[1].ay']) || 0;
        valid = !isNaN(parseFloat(row['imu[1].ax']));
      } else if (index === 2) {
        ax = parseFloat(row['imu[2].ax']) || 0;
        ay = parseFloat(row['imu[2].ay']) || 0;
        valid = !isNaN(parseFloat(row['imu[2].ax']));
      }
    }
    
    // Scale standard m/s^2 to G if values are large (e.g. around 9.8)
    const toG = (val) => {
      return Math.abs(val) > 4.0 ? val / 9.80665 : val;
    };
    
    const gX = toG(ay); // lateral
    const gY = toG(ax); // longitudinal
    const gMag = Math.sqrt(gX * gX + gY * gY);
    const cx = 50 + Math.max(-1, Math.min(1, gX / maxG)) * 50;
    const cy = 50 - Math.max(-1, Math.min(1, gY / maxG)) * 50;
    return { cx, cy, gMag, valid };
  };

  const cogCoords = getImuCoords(latestRow, 0);
  const frontCoords = getImuCoords(latestRow, 1);
  const rearCoords = getImuCoords(latestRow, 2);

  return (
    <div className="animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {/* Real-time G-Force Vector Meter Card */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', minHeight: '400px' }}>
          <div style={{ width: '100%', textAlign: 'center' }}>
            <h2 className="section-title" style={{ justifyContent: 'center', borderLeft: 'none', paddingLeft: 0 }}>G-Force Meter</h2>
            <p className="text-slate-400" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>Real-time triple-IMU acceleration vector</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(0, 0, 0, 0.2)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', width: '100%', maxWidth: '260px' }}>
            <svg width="160" height="160" viewBox="0 0 100 100" style={{ display: 'block', overflow: 'visible' }}>
              {/* Outer boundary G zone (2.0G) */}
              <circle cx="50" cy="50" r="50" fill="none" stroke="var(--text-secondary)" strokeOpacity="0.25" strokeWidth="1.5"></circle>
              {/* Inner boundary G zone (1.0G) */}
              <circle cx="50" cy="50" r="25" fill="none" stroke="var(--text-secondary)" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="3,3"></circle>
              
              {/* Crosshair axes */}
              <line x1="0" y1="50" x2="100" y2="50" stroke="var(--text-secondary)" strokeOpacity="0.2" strokeWidth="1"></line>
              <line x1="50" y1="0" x2="50" y2="100" stroke="var(--text-secondary)" strokeOpacity="0.2" strokeWidth="1"></line>
              
              {/* Direction Labels */}
              <text x="50" y="9" textAnchor="middle" fill="var(--text-secondary)" fillOpacity="0.75" fontWeight="600" fontSize="7" fontFamily="var(--font-sans)">F</text>
              <text x="50" y="97" text-Anchor="middle" fill="var(--text-secondary)" fillOpacity="0.75" fontWeight="600" fontSize="7" fontFamily="var(--font-sans)">B</text>
              <text x="7" y="52.5" textAnchor="start" fill="var(--text-secondary)" fillOpacity="0.75" fontWeight="600" fontSize="7" fontFamily="var(--font-sans)">L</text>
              <text x="93" y="52.5" textAnchor="end" fill="var(--text-secondary)" fillOpacity="0.75" fontWeight="600" fontSize="7" fontFamily="var(--font-sans)">R</text>

              {/* COG G vector (Cyan) */}
              <circle cx={cogCoords.cx.toFixed(1)} cy={cogCoords.cy.toFixed(1)} r="4.5" fill="#00e5ff" stroke="#ffffff" strokeWidth="0.75" strokeOpacity="0.8" style={{ filter: 'drop-shadow(0 0 4px #00e5ff)', transition: 'cx 80ms ease, cy 80ms ease', opacity: cogCoords.valid ? 1 : 0.2 }}></circle>

              {/* Front G vector (Emerald Green) */}
              <circle cx={frontCoords.cx.toFixed(1)} cy={frontCoords.cy.toFixed(1)} r="4.5" fill="#00ff7f" stroke="#ffffff" strokeWidth="0.75" strokeOpacity="0.8" style={{ filter: 'drop-shadow(0 0 4px #00ff7f)', transition: 'cx 80ms ease, cy 80ms ease', opacity: frontCoords.valid ? 1 : 0.2 }}></circle>

              {/* Rear G vector (Red) */}
              <circle cx={rearCoords.cx.toFixed(1)} cy={rearCoords.cy.toFixed(1)} r="4.5" fill="#ff2a4d" stroke="#ffffff" strokeWidth="0.75" strokeOpacity="0.8" style={{ filter: 'drop-shadow(0 0 4px #ff2a4d)', transition: 'cx 80ms ease, cy 80ms ease', opacity: rearCoords.valid ? 1 : 0.2 }}></circle>
            </svg>

            {/* Vector Legend */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%', marginTop: '1.25rem', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00e5ff', boxShadow: '0 0 4px #00e5ff' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>COG</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: cogCoords.valid ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {cogCoords.valid ? `${cogCoords.gMag.toFixed(2)} G` : 'Offline'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00ff7f', boxShadow: '0 0 4px #00ff7f' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>Front</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: frontCoords.valid ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {frontCoords.valid ? `${frontCoords.gMag.toFixed(2)} G` : 'Offline'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ff2a4d', boxShadow: '0 0 4px #ff2a4d' }} />
                  <span style={{ color: 'var(--text-secondary)' }}>Rear</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: rearCoords.valid ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {rearCoords.valid ? `${rearCoords.gMag.toFixed(2)} G` : 'Offline'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Primary G-Forces Chart Card */}
        <div className="glass-panel">
          <h2 className="section-title">Chassis G-Forces (Primary IMU)</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Plots acceleration forces in Gs along the longitudinal (accel/braking), lateral (cornering), and vertical directions.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Chassis G-Forces (Primary IMU)" 
              description="Plots acceleration forces in Gs along the longitudinal (accel/braking), lateral (cornering), and vertical directions." 
              options={getChartOptions('Chassis Forces (G)')} 
              data={gForceChartData} 
              plugins={[imuPlugin]} 
            />
          </div>
        </div>

        {/* Angular rates */}
        <div className="glass-panel">
          <h2 className="section-title">Angular Rotational Rates</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Roll, pitch, and yaw rates in degrees/sec. Helpful for monitoring body roll transition speed and turn-in response.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Angular Rotational Rates" 
              description="Roll, pitch, and yaw rates in degrees/sec. Helpful for monitoring body roll transition speed and turn-in response." 
              options={getChartOptions('Angular Speed (deg/s)')} 
              data={gyroChartData} 
              plugins={[imuPlugin]} 
            />
          </div>
        </div>
      </div>

      <div className="grid-cols-2">
        {/* Longitudinal G comparison */}
        <div className="glass-panel">
          <h2 className="section-title">Longitudinal Gs Comparison</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Compares acceleration forces across the Front (GPS), Mid, and Rear IMUs to study chassis flex and pitching dynamics.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Longitudinal Gs Comparison" 
              description="Compares acceleration forces across the Front (GPS), Mid, and Rear IMUs to study chassis flex and pitching dynamics." 
              options={getChartOptions('Acceleration (G)')} 
              data={axComparisonChartData} 
              plugins={[imuPlugin]} 
            />
          </div>
        </div>

        {/* Lateral G comparison */}
        <div className="glass-panel">
          <h2 className="section-title">Lateral Gs Comparison</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Compares cornering forces across Front, Mid, and Rear sensor locations. Deviations indicate vehicle yaw or frame twisting.
          </p>
          <div className="chart-container">
            <ZoomableLine 
              title="Lateral Gs Comparison" 
              description="Compares cornering forces across Front, Mid, and Rear sensor locations. Deviations indicate vehicle yaw or frame twisting." 
              options={getChartOptions('Acceleration (G)')} 
              data={ayComparisonChartData} 
              plugins={[imuPlugin]} 
            />
          </div>
        </div>
      </div>

    </div>
  );
}
