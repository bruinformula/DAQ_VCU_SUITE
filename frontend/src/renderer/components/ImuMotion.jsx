import React, { useMemo } from 'react';
import { Compass, ShieldAlert, Activity } from 'lucide-react';
import { createDropoutPlugin } from '../utils/dropoutPlugin';
import ZoomableLine from './ZoomableLine';

// ---------------------------------------------------------------------------
// IMU mounting orientations (axes given relative to the FRONT of the car):
//
//   IMU 0 (COG):   x -> right,  y -> front, z -> up
//   IMU 1 (Front): x -> left,   y -> rear,  z -> up
//   IMU 2 (Rear):  x -> left,   y -> up,    z -> front
//
// Car frame convention (matches GGDiagram):
//   Lateral      = positive RIGHT
//   Longitudinal = positive FORWARD (accel)
//
//   IMU 0: lat = +ax, long = +ay
//   IMU 1: lat = -ax, long = -ay
//
// NOTE: IMU 2 (Rear: x -> left, y -> up, z -> front) is intentionally
// EXCLUDED from all calculations and displays in this component.
//
// Units are AUTO-DETECTED per channel (see detectChannelScale) rather than
// hard-coded, and the COG IMU is additionally cross-calibrated against the
// Front IMU, which has been verified to read correctly.
// ---------------------------------------------------------------------------
const MS2_TO_G = 1.0 / 9.80665;

// Per-channel unit auto-detection (same logic as GGDiagram). The 99th
// percentile of |accel| is ~1.5 in G units but ~10+ in m/s^2, so a
// threshold of 6 separates them robustly without being fooled by spikes.
function detectChannelScale(rows, key) {
  const mags = [];
  for (const row of rows) {
    const v = Math.abs(parseFloat(row[key]));
    if (!isNaN(v)) mags.push(v);
  }
  if (mags.length < 10) return 1.0;
  mags.sort((a, b) => a - b);
  const p99 = mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.99))];
  return p99 > 6 ? MS2_TO_G : 1.0;
}

// Least-squares fit of reference = gain * value + offset (same logic as
// GGDiagram). Used to calibrate the COG IMU against the trusted Front IMU.
// Falls back to offset-only when the fit is unreliable, and to identity
// when there aren't enough overlapping samples.
function fitCalibration(pairs) {
  const n = pairs.length;
  if (n < 50) return { gain: 1, offset: 0, applied: false };
  let sx = 0, sy = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx;
    const dy = y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx < 1e-9 || syy < 1e-9) {
    return { gain: 1, offset: my - mx, applied: true };
  }
  const r = sxy / Math.sqrt(sxx * syy);
  const gain = sxy / sxx;
  if (Math.abs(r) < 0.5 || gain < 0.05 || gain > 20) {
    return { gain: 1, offset: my - mx, applied: true, r };
  }
  return { gain, offset: my - gain * mx, applied: true, r };
}

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

  // Helper to parse a field to continuous linear datasets.
  // `scale` carries the unit conversion, orientation sign, and calibration
  // gain; `offset` carries the calibration offset (applied after scaling).
  const parseLinearData = (colName, scale = 1.0, offset = 0.0) => {
    return processedData.map(row => {
      const val = parseFloat(row[colName]);
      const time = parseFloat((parseFloat(row.ts) - startTs).toFixed(2));
      return { x: time, y: isNaN(val) ? null : val * scale + offset };
    });
  };

  // Per-channel unit scales, detected once per dataset.
  const channelScales = useMemo(() => ({
    legacyAx: detectChannelScale(processedData, 'imu.ax'),
    legacyAy: detectChannelScale(processedData, 'imu.ay'),
    legacyAz: detectChannelScale(processedData, 'imu.az'),
    cogLat: detectChannelScale(processedData, 'imu[0].ax'),
    cogLong: detectChannelScale(processedData, 'imu[0].ay'),
    frontLat: detectChannelScale(processedData, 'imu[1].ax'),
    frontLong: detectChannelScale(processedData, 'imu[1].ay'),
  }), [processedData]);

  // Cross-calibration of the COG IMU against the Front IMU (the trusted
  // reference), in the car frame: fit front = gain * cog + offset per axis.
  const cogCalibration = useMemo(() => {
    const latPairs = [];
    const longPairs = [];
    for (const row of processedData) {
      const cLat = parseFloat(row['imu[0].ax']);
      const cLong = parseFloat(row['imu[0].ay']);
      const fLat = parseFloat(row['imu[1].ax']);
      const fLong = parseFloat(row['imu[1].ay']);
      if (!isNaN(cLat) && !isNaN(fLat)) {
        // car frame: COG lat = +ax * scale, Front lat = -ax * scale
        latPairs.push([cLat * channelScales.cogLat, -fLat * channelScales.frontLat]);
      }
      if (!isNaN(cLong) && !isNaN(fLong)) {
        // car frame: COG long = +ay * scale, Front long = -ay * scale
        longPairs.push([cLong * channelScales.cogLong, -fLong * channelScales.frontLong]);
      }
    }
    return { lat: fitCalibration(latPairs), long: fitCalibration(longPairs) };
  }, [processedData, channelScales]);

  // Dropout highlighter plugin
  const imuPlugin = useMemo(() => createDropoutPlugin(boardDropouts?.imu, startTs), [boardDropouts, startTs]);

  // 1. Primary (legacy single-channel) IMU G-forces.
  // Assumed COG orientation: x -> right, y -> front, z -> up, all signs +.
  // Unit scale auto-detected per channel.
  const gForceChartData = useMemo(() => {
    return {
      datasets: [
        {
          label: 'Lateral Gs (+right)',
          data: parseLinearData('imu.ax', channelScales.legacyAx),
          borderColor: '#3b82f6', // Blue
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Longitudinal Gs (+forward)',
          data: parseLinearData('imu.ay', channelScales.legacyAy),
          borderColor: '#ef4444', // Red
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Vertical Gs (+up)',
          data: parseLinearData('imu.az', channelScales.legacyAz),
          borderColor: '#10b981', // Green
          borderWidth: 1,
          borderDash: [3, 3],
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs, channelScales]);

  // 2. Longitudinal G comparison across the COG and Front sensors, rotated
  // into the car frame (positive = forward accel):
  //   COG   imu[0].ay * +scale, then calibrated to the Front reference
  //   Front imu[1].ay * -scale (y points rearward)
  const longComparisonChartData = useMemo(() => {
    const cal = cogCalibration.long;
    return {
      datasets: [
        {
          label: cal.applied ? 'COG IMU (+ay, calibrated)' : 'COG IMU (+ay)',
          data: parseLinearData('imu[0].ay', channelScales.cogLong * cal.gain, cal.offset),
          borderColor: '#f97316', // Orange
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Front IMU (-ay)',
          data: parseLinearData('imu[1].ay', -channelScales.frontLong),
          borderColor: '#06b6d4', // Cyan
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs, channelScales, cogCalibration]);

  // 3. Lateral G comparison across the COG and Front sensors, rotated into
  // the car frame (positive = right):
  //   COG   imu[0].ax * +scale, then calibrated to the Front reference
  //   Front imu[1].ax * -scale (x points left)
  const latComparisonChartData = useMemo(() => {
    const cal = cogCalibration.lat;
    return {
      datasets: [
        {
          label: cal.applied ? 'COG IMU (+ax, calibrated)' : 'COG IMU (+ax)',
          data: parseLinearData('imu[0].ax', channelScales.cogLat * cal.gain, cal.offset),
          borderColor: '#f97316',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: 'Front IMU (-ax)',
          data: parseLinearData('imu[1].ax', -channelScales.frontLat),
          borderColor: '#06b6d4',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        }
      ]
    };
  }, [processedData, startTs, channelScales, cogCalibration]);

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

  // Reads one row and returns the car-frame G vector for the given IMU.
  // Applies the per-sensor orientation mapping, the auto-detected unit
  // scales, and (for the COG IMU) the Front-referenced calibration.
  const getImuCoords = (row, index) => {
    let lat = 0;
    let long = 0;
    let valid = false;

    const num = (v) => {
      const parsed = parseFloat(v);
      return Number.isNaN(parsed) ? null : parsed;
    };

    if (row) {
      if (index === 0) {
        // COG: lat = +ax, long = +ay (fallback to legacy imu.ax/imu.ay)
        const usingIndexed = num(row['imu[0].ax']) !== null;
        const ax = num(row['imu[0].ax']) ?? num(row['imu.ax']);
        const ay = num(row['imu[0].ay']) ?? num(row['imu.ay']);
        valid = ax !== null && ay !== null;
        const latScale = usingIndexed ? channelScales.cogLat : channelScales.legacyAx;
        const longScale = usingIndexed ? channelScales.cogLong : channelScales.legacyAy;
        lat = (ax ?? 0) * latScale * cogCalibration.lat.gain + cogCalibration.lat.offset;
        long = (ay ?? 0) * longScale * cogCalibration.long.gain + cogCalibration.long.offset;
      } else if (index === 1) {
        // Front: lat = -ax, long = -ay
        const ax = num(row['imu[1].ax']);
        const ay = num(row['imu[1].ay']);
        valid = ax !== null && ay !== null;
        lat = -(ax ?? 0) * channelScales.frontLat;
        long = -(ay ?? 0) * channelScales.frontLong;
      }
      // index 2 (Rear IMU) intentionally not handled — excluded from display.
    }

    const gX = lat; // car lateral, +right (already in Gs)
    const gY = long; // car longitudinal, +forward (already in Gs)
    const gMag = Math.sqrt(gX * gX + gY * gY);
    const cx = 50 + Math.max(-1, Math.min(1, gX / maxG)) * 50;
    const cy = 50 - Math.max(-1, Math.min(1, gY / maxG)) * 50;
    return { cx, cy, gMag, valid };
  };

  const cogCoords = getImuCoords(latestRow, 0);
  const frontCoords = getImuCoords(latestRow, 1);

  return (
    <div className="animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {/* Real-time G-Force Vector Meter Card */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', minHeight: '400px' }}>
          <div style={{ width: '100%', textAlign: 'center' }}>
            <h2 className="section-title" style={{ justifyContent: 'center', borderLeft: 'none', paddingLeft: 0 }}>G-Force Meter</h2>
            <p className="text-slate-400" style={{ fontSize: '0.8rem', marginTop: '-0.5rem' }}>Real-time dual-IMU acceleration vector (COG + Front)</p>
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
              <text x="50" y="97" textAnchor="middle" fill="var(--text-secondary)" fillOpacity="0.75" fontWeight="600" fontSize="7" fontFamily="var(--font-sans)">B</text>
              <text x="7" y="52.5" textAnchor="start" fill="var(--text-secondary)" fillOpacity="0.75" fontWeight="600" fontSize="7" fontFamily="var(--font-sans)">L</text>
              <text x="93" y="52.5" textAnchor="end" fill="var(--text-secondary)" fillOpacity="0.75" fontWeight="600" fontSize="7" fontFamily="var(--font-sans)">R</text>

              {/* COG G vector (Cyan) */}
              <circle cx={cogCoords.cx.toFixed(1)} cy={cogCoords.cy.toFixed(1)} r="4.5" fill="#00e5ff" stroke="#ffffff" strokeWidth="0.75" strokeOpacity="0.8" style={{ filter: 'drop-shadow(0 0 4px #00e5ff)', transition: 'cx 80ms ease, cy 80ms ease', opacity: cogCoords.valid ? 1 : 0.2 }}></circle>

              {/* Front G vector (Emerald Green) */}
              <circle cx={frontCoords.cx.toFixed(1)} cy={frontCoords.cy.toFixed(1)} r="4.5" fill="#00ff7f" stroke="#ffffff" strokeWidth="0.75" strokeOpacity="0.8" style={{ filter: 'drop-shadow(0 0 4px #00ff7f)', transition: 'cx 80ms ease, cy 80ms ease', opacity: frontCoords.valid ? 1 : 0.2 }}></circle>
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
            Compares forward acceleration (car frame) across the COG and Front IMUs to study chassis flex and pitching dynamics.
          </p>
          <div className="chart-container">
            <ZoomableLine
              title="Longitudinal Gs Comparison"
              description="Compares forward acceleration (car frame) across the COG and Front IMUs to study chassis flex and pitching dynamics."
              options={getChartOptions('Acceleration (G)')}
              data={longComparisonChartData}
              plugins={[imuPlugin]}
            />
          </div>
        </div>

        {/* Lateral G comparison */}
        <div className="glass-panel">
          <h2 className="section-title">Lateral Gs Comparison</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Compares cornering forces (car frame, +right) across the COG and Front sensor locations. Deviations indicate vehicle yaw or frame twisting.
          </p>
          <div className="chart-container">
            <ZoomableLine
              title="Lateral Gs Comparison"
              description="Compares cornering forces (car frame, +right) across the COG and Front sensor locations. Deviations indicate vehicle yaw or frame twisting."
              options={getChartOptions('Acceleration (G)')}
              data={latComparisonChartData}
              plugins={[imuPlugin]}
            />
          </div>
        </div>
      </div>

    </div>
  );
}
