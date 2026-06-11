import { useEffect, useMemo, useState } from 'react';
import {
  clampPlayback,
} from '../utils/logPlaybackUtils';

const DIAGRAM_SIZE = 360;
const CENTER = DIAGRAM_SIZE / 2;
const RADIUS = 150;

// Hardware correction mapping happens right here once. 
// According to hardware specs, the board's .ax column actually holds Lateral data, 
// and the .ay column holds Longitudinal data. 
const sensorOptions = [
  { id: 0, label: 'COG IMU', latKey: 'imu[0].ax', longKey: 'imu[0].ay', color: '#00e5ff' },
  { id: 1, label: 'Front IMU', latKey: 'imu[1].ax', longKey: 'imu[1].ay', color: '#00ff7f' },
  { id: 2, label: 'Rear IMU', latKey: 'imu[2].ax', longKey: 'imu[2].ay', color: '#ff2a4d' },
];

export default function GGDiagram({ samples = [], availableSignalIds = [] }) {
  const [sensorId, setSensorId] = useState(0);
  const [swapAxes, setSwapAxes] = useState(false);
  const [viewMode, setViewMode] = useState('xy');

  const availableSensors = useMemo(() => (
    sensorOptions.filter((sensor) => {
      if (sensor.id === 0) {
        return (availableSignalIds.includes(sensor.latKey) && availableSignalIds.includes(sensor.longKey)) ||
               (availableSignalIds.includes('imu.ax') && availableSignalIds.includes('imu.ay'));
      }
      return availableSignalIds.includes(sensor.latKey) && availableSignalIds.includes(sensor.longKey);
    })
  ), [availableSignalIds]);

  useEffect(() => {
    if (availableSensors.length === 0) return;
    if (!availableSensors.some((sensor) => sensor.id === sensorId)) {
      setSensorId(availableSensors[0].id);
    }
  }, [availableSensors, sensorId]);

  const selectedSensor = availableSensors.find((sensor) => sensor.id === sensorId) || availableSensors[0] || null;

  const trace = useMemo(() => {
    if (!selectedSensor) return [];

    // Map fallback legacy single-IMU parameters for ID 0 if required
    let latKey = selectedSensor.latKey;
    let longKey = selectedSensor.longKey;

    if (selectedSensor.id === 0) {
      if (!samples.some(s => s[latKey] !== undefined) && samples.some(s => s['imu.ax'] !== undefined)) {
        latKey = 'imu.ax';
      }
      if (!samples.some(s => s[longKey] !== undefined) && samples.some(s => s['imu.ay'] !== undefined)) {
        longKey = 'imu.ay';
      }
    }

    return samples.map((sample, index) => {
      const latVal = parseFloat(sample[latKey]);
      const longVal = parseFloat(sample[longKey]);

      if (isNaN(latVal) || isNaN(longVal)) {
        return null;
      }

      // Standard G-G diagram layout: 
      // X = Lateral (horizontal), Y = Longitudinal (vertical).
      // The user-facing checkbox manually swaps layout presentation if desired.
      return {
        x: swapAxes ? longVal : latVal,
        y: swapAxes ? latVal : longVal,
        lateral: latVal,
        longitudinal: longVal,
        index,
      };
    }).filter(Boolean);
  }, [samples, selectedSensor, swapAxes]);

  const maxes = useMemo(() => {
    let maxLat = 0, minLat = 0, maxLong = 0, minLong = 0;
    for (const pt of trace) {
      if (pt.lateral > maxLat) maxLat = pt.lateral;
      if (pt.lateral < minLat) minLat = pt.lateral;
      if (pt.longitudinal > maxLong) maxLong = pt.longitudinal;
      if (pt.longitudinal < minLong) minLong = pt.longitudinal;
    }
    return { maxLat, minLat, maxLong, minLong };
  }, [trace]);

  const currentPoint = trace[trace.length - 1] || null;

  return (
    <section className="glass-panel animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: '0.25rem' }}>G-G Diagram</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem' }}>
            Live acceleration envelope and historical trace log.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="select-input"
            value={selectedSensor?.id ?? ''}
            onChange={(event) => setSensorId(Number(event.target.value))}
            disabled={availableSensors.length === 0}
            style={{ padding: '0.25rem 2rem 0.25rem 0.75rem', fontSize: '0.8rem' }}
          >
            {availableSensors.length === 0 ? (
              <option value="">No IMUs in Active Dataset</option>
            ) : availableSensors.map((sensor) => (
              <option key={sensor.id} value={sensor.id}>{sensor.label}</option>
            ))}
          </select>
          <label className="plotter-checkbox-label" style={{ userSelect: 'none', border: '1px solid var(--border-color)', padding: '0.25rem 0.5rem', background: 'rgba(255, 255, 255, 0.02)' }}>
            <input
              type="checkbox"
              checked={swapAxes}
              onChange={(event) => setSwapAxes(event.target.checked)}
              style={{ marginRight: '0.25rem' }}
            />
            <span>Swap Lat / Long Display</span>
          </label>
          <select
            className="select-input"
            value={viewMode}
            onChange={(event) => setViewMode(event.target.value)}
            style={{ padding: '0.25rem 2rem 0.25rem 0.75rem', fontSize: '0.8rem' }}
          >
            <option value="xy">Full G-G</option>
            <option value="lat">Lateral Only</option>
            <option value="long">Longitudinal Only</option>
          </select>
        </div>
      </div>

      {trace.length === 0 ? (
        <div style={{ display: 'flex', height: '300px', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          This run does not contain valid lateral and longitudinal IMU parameters.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', padding: '2rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              {viewMode === 'xy' ? (
                <svg viewBox={`0 0 ${DIAGRAM_SIZE} ${DIAGRAM_SIZE}`} style={{ display: 'block', maxWidth: '360px', width: '100%', height: 'auto', overflow: 'visible' }}>
                  <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
                  <circle cx={CENTER} cy={CENTER} r={RADIUS * 0.5} fill="none" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                  <line x1={CENTER} y1={CENTER - RADIUS} x2={CENTER} y2={CENTER + RADIUS} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                  <line x1={CENTER - RADIUS} y1={CENTER} x2={CENTER + RADIUS} y2={CENTER} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                  
                  {/* Correctly synchronized plot labels */}
                  <text x={CENTER} y={24} textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontWeight="600">
                    {swapAxes ? '+Lat Accel' : '+Long Accel'}
                  </text>
                  <text x={CENTER} y={DIAGRAM_SIZE - 12} textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontWeight="600">
                    {swapAxes ? '-Lat Accel' : '-Long Accel'}
                  </text>
                  <text x={12} y={CENTER + 3} textAnchor="start" fill="var(--text-secondary)" fontSize="9" fontWeight="600">
                    {swapAxes ? '-Long Accel' : '-Lat Accel'}
                  </text>
                  <text x={DIAGRAM_SIZE - 12} y={CENTER + 3} textAnchor="end" fill="var(--text-secondary)" fontSize="9" fontWeight="600">
                    {swapAxes ? '+Long Accel' : '+Lat Accel'}
                  </text>

                  {trace.map((point) => {
                    const cx = CENTER + clampPlayback(point.x, -2.5, 2.5) * (RADIUS / 2);
                    const cy = CENTER - clampPlayback(point.y, -2.5, 2.5) * (RADIUS / 2);
                    return (
                      <circle
                        key={point.index}
                        cx={cx.toFixed(1)}
                        cy={cy.toFixed(1)}
                        r="1.5"
                        fill={selectedSensor?.color || '#00e5ff'}
                        opacity="0.6"
                      />
                    );
                  })}

                  {currentPoint ? (
                    <circle
                      cx={CENTER + clampPlayback(currentPoint.x, -2.5, 2.5) * (RADIUS / 2)}
                      cy={CENTER - clampPlayback(currentPoint.y, -2.5, 2.5) * (RADIUS / 2)}
                      r="5"
                      fill={selectedSensor?.color || '#00e5ff'}
                      stroke="#ffffff"
                      strokeOpacity="0.8"
                      strokeWidth="1.5"
                      style={{ filter: `drop-shadow(0 0 5px ${selectedSensor?.color})` }}
                    />
                  ) : null}
                </svg>
              ) : (
                <svg viewBox="0 0 360 360" style={{ display: 'block', maxWidth: '360px', width: '100%', height: 'auto', overflow: 'visible' }}>
                  <line x1="38" y1="180" x2="332" y2="180" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
                  <line x1="38" y1="38" x2="38" y2="322" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
                  <text x="44" y="28" fill="var(--text-secondary)" fontSize="9" fontWeight="600">
                    {viewMode === 'lat' ? 'Lateral Accel (G)' : 'Longitudinal Accel (G)'}
                  </text>
                  {trace.map((point, index) => {
                    const cx = 38 + ((index / Math.max(trace.length - 1, 1)) * 294);
                    const val = viewMode === 'lat' ? point.lateral : point.longitudinal;
                    const cy = 180 - (clampPlayback(val, -2.5, 2.5) * 55);
                    return (
                      <circle
                        key={point.index}
                        cx={cx.toFixed(1)}
                        cy={cy.toFixed(1)}
                        r="1.5"
                        fill={selectedSensor?.color || '#00e5ff'}
                        opacity="0.6"
                      />
                    );
                  })}
                </svg>
              )}
            </div>

            {/* Current Vector Data & Maxes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <h3 className="section-title" style={{ fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Live Vector Info</h3>
                {currentPoint ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-slate-400">Lat Accel:</span>
                      <strong style={{ color: selectedSensor?.color }}>{currentPoint.lateral.toFixed(2)} G</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-slate-400">Long Accel:</span>
                      <strong style={{ color: selectedSensor?.color }}>{currentPoint.longitudinal.toFixed(2)} G</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="text-slate-400">Combined:</span>
                      <strong style={{ color: '#fff' }}>{Math.sqrt(currentPoint.lateral**2 + currentPoint.longitudinal**2).toFixed(2)} G</strong>
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-400" style={{ fontSize: '0.85rem' }}>No data available</div>
                )}
              </div>

              <div style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <h3 className="section-title" style={{ fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Session Maxes</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-slate-400">Max Lat (L/R):</span>
                    <strong style={{ color: selectedSensor?.color }}>{maxes.minLat.toFixed(2)} / {maxes.maxLat.toFixed(2)} G</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-slate-400">Max Long (B/A):</span>
                    <strong style={{ color: selectedSensor?.color }}>{maxes.minLong.toFixed(2)} / {maxes.maxLong.toFixed(2)} G</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}