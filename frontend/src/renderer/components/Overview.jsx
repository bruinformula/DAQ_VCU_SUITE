import React, { useMemo } from 'react';
import { Clock, Database, Gauge, Thermometer, ShieldAlert, Activity } from 'lucide-react';

export default function Overview({ data, dropouts = [], startTs = 0 }) {
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;

    // Filter out rows that are just headers or invalid
    const validRows = data.filter(row => !isNaN(parseFloat(row.ts)));
    if (validRows.length === 0) return null;

    const timestamps = validRows.map(row => parseFloat(row.ts));
    const startTs = Math.min(...timestamps);
    const endTs = Math.max(...timestamps);
    const duration = endTs - startTs;

    // Helper to find max of a field
    const getMaxField = (fieldKey) => {
      let maxVal = -Infinity;
      validRows.forEach(row => {
        const val = parseFloat(row[fieldKey]);
        if (!isNaN(val) && val > maxVal) {
          maxVal = val;
        }
      });
      return maxVal === -Infinity ? null : maxVal;
    };

    // Helper to find average of a field
    const getAvgField = (fieldKey) => {
      let sum = 0;
      let count = 0;
      validRows.forEach(row => {
        const val = parseFloat(row[fieldKey]);
        if (!isNaN(val)) {
          sum += val;
          count++;
        }
      });
      return count > 0 ? sum / count : null;
    };

    // Calculate Speed (gps.vel is in m/s)
    const maxSpeedMps = getMaxField('gps.vel') || 0;
    const maxSpeedMph = maxSpeedMps * 2.23694;

    // SDU Corner Brake Temperatures
    const maxBrakes = {
      fl: getMaxField('sdu[0].brake'),
      fr: getMaxField('sdu[1].brake'),
      rl: getMaxField('sdu[2].brake'),
      rr: getMaxField('sdu[3].brake'),
    };

    // SDU Corner Shock Travel
    const maxShocks = {
      fl: getMaxField('sdu[0].shock'),
      fr: getMaxField('sdu[1].shock'),
      rl: getMaxField('sdu[2].shock'),
      rr: getMaxField('sdu[3].shock'),
    };

    // Check which boards seem active (non-zero or non-empty readings)
    const activeBoards = {
      gps: validRows.some(row => parseFloat(row['gps.lat']) !== 0 && !isNaN(parseFloat(row['gps.lat']))),
      sdu0: validRows.some(row => parseFloat(row['sdu[0].brake']) > 0),
      sdu1: validRows.some(row => parseFloat(row['sdu[1].brake']) > 0),
      sdu2: validRows.some(row => parseFloat(row['sdu[2].brake']) > 0),
      sdu3: validRows.some(row => parseFloat(row['sdu[3].brake']) > 0),
      tshmu: validRows.some(row => parseFloat(row['tshmu.flow1']) > 0 || parseFloat(row['tshmu.jitter_us']) > 0),
      tspmu0: validRows.some(row => parseFloat(row['tspmu[0].p1']) > 0),
      tspmu1: validRows.some(row => parseFloat(row['tspmu[1].p1']) > 0),
    };

    return {
      duration,
      totalPoints: validRows.length,
      maxSpeedMps,
      maxSpeedMph,
      maxBrakes,
      maxShocks,
      activeBoards,
    };
  }, [data]);

  const healthStats = useMemo(() => {
    if (!dropouts || !stats || stats.duration <= 0) {
      return {
        healthScore: 100,
        totalLostTime: 0,
        avgLostTime: 0
      };
    }
    const totalLostTime = dropouts.reduce((sum, gap) => sum + gap.duration, 0);
    const healthScore = Math.max(0, Math.min(100, 100 * (1 - totalLostTime / stats.duration)));
    const avgLostTime = dropouts.length > 0 ? totalLostTime / dropouts.length : 0;
    return {
      healthScore,
      totalLostTime,
      avgLostTime
    };
  }, [dropouts, stats]);

  if (!stats) {
    return (
      <div className="glass-panel text-center py-12 animated-fade-in">
        <Activity className="mx-auto mb-4 text-slate-400" size={48} />
        <h3 className="text-xl font-semibold mb-2">No Valid Data Loaded</h3>
        <p className="text-slate-400">Please select a CSV run file or upload one to get started.</p>
      </div>
    );
  }

  const formatTemp = (val) => (val !== null ? `${val.toFixed(1)} °C` : 'N/A');
  const formatShock = (val) => (val !== null ? `${val.toFixed(1)} mm` : 'N/A');

  return (
    <div className="animated-fade-in">
      {/* Metrics Row */}
      <div className="grid-cols-4">
        {/* Run Duration */}
        <div className="glass-panel metric-card">
          <div className="metric-header">
            <span>Run Duration</span>
            <Clock size={20} className="text-blue-400" />
          </div>
          <div className="metric-value">
            {stats.duration.toFixed(1)}s
          </div>
          <div className="metric-subtext">
            Total elapsed test time
          </div>
        </div>

        {/* Data Points */}
        <div className="glass-panel metric-card">
          <div className="metric-header">
            <span>Sample Count</span>
            <Database size={20} className="text-emerald-400" />
          </div>
          <div className="metric-value">
            {stats.totalPoints.toLocaleString()}
          </div>
          <div className="metric-subtext">
            Logs recorded at ~10Hz
          </div>
        </div>

        {/* Top Speed */}
        <div className="glass-panel metric-card">
          <div className="metric-header">
            <span>Top Speed</span>
            <Gauge size={20} className="text-purple-400" />
          </div>
          <div className="metric-value">
            {stats.maxSpeedMph.toFixed(1)} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>mph</span>
          </div>
          <div className="metric-subtext">
            {stats.maxSpeedMps.toFixed(1)} m/s from GPS receiver
          </div>
        </div>

        {/* Peak Brake Temp */}
        <div className="glass-panel metric-card">
          <div className="metric-header">
            <span>Peak Brake Temp</span>
            <Thermometer size={20} className="text-orange-400" />
          </div>
          <div className="metric-value">
            {Math.max(
              stats.maxBrakes.fl || 0,
              stats.maxBrakes.fr || 0,
              stats.maxBrakes.rl || 0,
              stats.maxBrakes.rr || 0
            ).toFixed(1)} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>°C</span>
          </div>
          <div className="metric-subtext">
            Highest recorded brake rotor temperature
          </div>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid-cols-2">
        {/* Corner Telemetry Summary */}
        <div className="glass-panel">
          <h2 className="section-title">
            <Activity size={20} className="text-blue-400" />
            Corner Sensor Peaks
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              <div>Wheel Corner</div>
              <div>Max Brake Temp</div>
              <div>Max Shock Travel</div>
            </div>
            
            {/* Front Left */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '1rem', alignItems: 'center' }}>
              <div>
                <span className="corner-label corner-fl">Front Left (FL)</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatTemp(stats.maxBrakes.fl)}</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatShock(stats.maxShocks.fl)}</div>
            </div>

            {/* Front Right */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '1rem', alignItems: 'center' }}>
              <div>
                <span className="corner-label corner-fr">Front Right (FR)</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatTemp(stats.maxBrakes.fr)}</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatShock(stats.maxShocks.fr)}</div>
            </div>

            {/* Rear Left */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '1rem', alignItems: 'center' }}>
              <div>
                <span className="corner-label corner-rl">Rear Left (RL)</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatTemp(stats.maxBrakes.rl)}</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatShock(stats.maxShocks.rl)}</div>
            </div>

            {/* Rear Right */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '1rem', alignItems: 'center' }}>
              <div>
                <span className="corner-label corner-rr">Rear Right (RR)</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatTemp(stats.maxBrakes.rr)}</div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{formatShock(stats.maxShocks.rr)}</div>
            </div>
          </div>
        </div>

        {/* Board Activity Tracker */}
        <div className="glass-panel">
          <h2 className="section-title">
            <ShieldAlert size={20} className="text-emerald-400" />
            Board Communication Status
          </h2>
          <p className="text-slate-400" style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
            Verification of active data streams detected within the selected test file.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.875rem' }}>GPS (SMU 0)</span>
              <span className={`corner-label ${stats.activeBoards.gps ? 'corner-fr' : 'corner-fl'}`} style={{ marginLeft: 'auto' }}>
                {stats.activeBoards.gps ? 'Active' : 'Offline'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.875rem' }}>FL Corner (SDU 0)</span>
              <span className={`corner-label ${stats.activeBoards.sdu0 ? 'corner-rl' : 'corner-fl'}`} style={{ marginLeft: 'auto' }}>
                {stats.activeBoards.sdu0 ? 'Active' : 'Offline'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.875rem' }}>FR Corner (SDU 1)</span>
              <span className={`corner-label ${stats.activeBoards.sdu1 ? 'corner-rl' : 'corner-fl'}`} style={{ marginLeft: 'auto' }}>
                {stats.activeBoards.sdu1 ? 'Active' : 'Offline'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.875rem' }}>RL Corner (SDU 2)</span>
              <span className={`corner-label ${stats.activeBoards.sdu2 ? 'corner-rl' : 'corner-fl'}`} style={{ marginLeft: 'auto' }}>
                {stats.activeBoards.sdu2 ? 'Active' : 'Offline'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.875rem' }}>RR Corner (SDU 3)</span>
              <span className={`corner-label ${stats.activeBoards.sdu3 ? 'corner-rl' : 'corner-fl'}`} style={{ marginLeft: 'auto' }}>
                {stats.activeBoards.sdu3 ? 'Active' : 'Offline'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.875rem' }}>Flow (TSHMU)</span>
              <span className={`corner-label ${stats.activeBoards.tshmu ? 'corner-rl' : 'corner-fl'}`} style={{ marginLeft: 'auto' }}>
                {stats.activeBoards.tshmu ? 'Active' : 'Offline'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyBetween: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.875rem' }}>PMU Board 0</span>
              <span className={`corner-label ${stats.activeBoards.tspmu0 ? 'corner-rl' : 'corner-fl'}`} style={{ marginLeft: 'auto' }}>
                {stats.activeBoards.tspmu0 ? 'Active' : 'Offline'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.875rem' }}>PMU Board 1</span>
              <span className={`corner-label ${stats.activeBoards.tspmu1 ? 'corner-rl' : 'corner-fl'}`} style={{ marginLeft: 'auto' }}>
                {stats.activeBoards.tspmu1 ? 'Active' : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Logger Health & Dropouts Summary */}
      <div className="glass-panel" style={{ marginTop: '1.5rem' }}>
        <h2 className="section-title" style={{ borderLeftColor: dropouts.length > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
          <ShieldAlert size={20} className={dropouts.length > 0 ? 'text-red-400' : 'text-emerald-400'} />
          Logger Health & Data Cutouts
        </h2>
        <p className="text-slate-400" style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          Identifies periods where the connection cut out or logger stalled. High gaps (&gt;450ms) are highlighted in red on all charts.
        </p>
        
        <div className="grid-cols-4" style={{ marginBottom: '1.5rem' }}>
          {/* Health Score */}
          <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Log Reliability Score</span>
            <span style={{ 
              fontSize: '1.75rem', 
              fontWeight: 'bold', 
              color: healthStats.healthScore >= 98 ? 'var(--color-success)' : healthStats.healthScore >= 90 ? 'var(--color-warning)' : 'var(--color-danger)' 
            }}>
              {healthStats.healthScore.toFixed(2)}%
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Percent of time logger was streaming</span>
          </div>

          {/* Gaps count */}
          <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Cutout Count</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 'bold', color: dropouts.length > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
              {dropouts.length}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Gaps &gt; 450ms detected</span>
          </div>

          {/* Total lost time */}
          <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Lost Time</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 'bold', color: dropouts.length > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
              {healthStats.totalLostTime.toFixed(2)}s
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Combined length of logger gaps</span>
          </div>

          {/* Average Gap duration */}
          <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Avg Cutout Duration</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 'bold', color: dropouts.length > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
              {healthStats.avgLostTime.toFixed(2)}s
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Mean length per blackout</span>
          </div>
        </div>

        {/* List of Cutouts */}
        {dropouts.length > 0 ? (
          <div className="table-wrapper" style={{ maxHeight: '250px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ position: 'sticky', top: 0 }}>Gap ID</th>
                  <th style={{ position: 'sticky', top: 0 }}>Start (Relative)</th>
                  <th style={{ position: 'sticky', top: 0 }}>End (Relative)</th>
                  <th style={{ position: 'sticky', top: 0 }}>Duration</th>
                  <th style={{ position: 'sticky', top: 0 }}>Unix Timestamp (s)</th>
                </tr>
              </thead>
              <tbody>
                {dropouts.map((gap, idx) => (
                  <tr key={idx}>
                    <td style={{ color: 'var(--color-danger)', fontWeight: 'bold' }}>#{idx + 1}</td>
                    <td>{(gap.startTime - startTs).toFixed(2)}s</td>
                    <td>{(gap.endTime - startTs).toFixed(2)}s</td>
                    <td style={{ color: 'var(--color-warning)' }}>{gap.duration.toFixed(3)}s</td>
                    <td style={{ color: 'var(--text-muted)' }}>{gap.startTime.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '6px', color: 'var(--color-success)', fontSize: '0.875rem' }}>
            Perfect logger performance! No connection dropouts or sample gap anomalies detected.
          </div>
        )}
      </div>

    </div>
  );
}
