import { useEffect, useMemo, useState } from 'react';
import {
  clampPlayback,
  formatPlaybackSeconds,
  formatPlaybackTimestamp,
  normalizeSampleTimestamps,
} from '../utils/logPlaybackUtils';

const DIAGRAM_SIZE = 360;
const CENTER = DIAGRAM_SIZE / 2;
const RADIUS = 150;

const sensorOptions = [
  { id: 0, label: 'COG IMU', ax: 'imu[0].ax', ay: 'imu[0].ay', color: '#00e5ff' },
  { id: 1, label: 'Front IMU', ax: 'imu[1].ax', ay: 'imu[1].ay', color: '#00ff7f' },
  { id: 2, label: 'Rear IMU', ax: 'imu[2].ax', ay: 'imu[2].ay', color: '#ff2a4d' },
];

export default function GGDiagram({ samples = [], availableSignalIds = [] }) {
  const [sensorId, setSensorId] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [swapAxes, setSwapAxes] = useState(false);
  const [viewMode, setViewMode] = useState('xy');

  const availableSensors = useMemo(() => (
    sensorOptions.filter((sensor) => {
      // Allow fallback to generic imu.ax/imu.ay if it's the COG sensor
      if (sensor.id === 0) {
        return (availableSignalIds.includes(sensor.ax) && availableSignalIds.includes(sensor.ay)) ||
               (availableSignalIds.includes('imu.ax') && availableSignalIds.includes('imu.ay'));
      }
      return availableSignalIds.includes(sensor.ax) && availableSignalIds.includes(sensor.ay);
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
    const timestamps = normalizeSampleTimestamps(samples);

    const axKey = selectedSensor.id === 0 && !samples.some(s => s[selectedSensor.ax] !== undefined) && samples.some(s => s['imu.ax'] !== undefined) ? 'imu.ax' : selectedSensor.ax;
    const ayKey = selectedSensor.id === 0 && !samples.some(s => s[selectedSensor.ay] !== undefined) && samples.some(s => s['imu.ay'] !== undefined) ? 'imu.ay' : selectedSensor.ay;

    return samples.map((sample, index) => {
      let ax = parseFloat(sample[axKey]);
      let ay = parseFloat(sample[ayKey]);
      
      // Standardize m/s^2 to Gs if they look unscaled
      const toG = (val) => Math.abs(val) > 4.0 ? val / 9.80665 : val;
      
      if (isNaN(ax) || isNaN(ay)) {
        return null;
      }
      
      ax = toG(ax);
      ay = toG(ay);

      return {
        x: swapAxes ? ax : ay,
        y: swapAxes ? ay : ax,
        rawAx: ax,
        rawAy: ay,
        timestamp: timestamps[index] ?? 0,
        index,
      };
    }).filter(Boolean);
  }, [samples, selectedSensor, swapAxes]);

  useEffect(() => {
    setPlaybackIndex(0);
    setIsPlaying(false);
  }, [selectedSensor]);

  useEffect(() => {
    if (!isPlaying || trace.length < 2) return undefined;

    const timer = window.setInterval(() => {
      setPlaybackIndex((current) => {
        if (current >= trace.length - 1) {
          setIsPlaying(false);
          return trace.length - 1;
        }
        return current + 1;
      });
    }, 24);

    return () => window.clearInterval(timer);
  }, [isPlaying, trace.length]);

  const currentIndex = clampPlayback(playbackIndex, 0, Math.max(trace.length - 1, 0));
  const displayedTrace = trace.slice(0, currentIndex + 1);
  const currentPoint = displayedTrace[displayedTrace.length - 1] || null;
  const totalDurationMs = trace.length > 1 ? trace[trace.length - 1].timestamp - trace[0].timestamp : 0;
  const playbackDurationMs = displayedTrace.length > 1
    ? displayedTrace[displayedTrace.length - 1].timestamp - displayedTrace[0].timestamp
    : 0;

  return (
    <section className="glass-panel animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: '0.25rem' }}>G-G Diagram Replay</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem' }}>
            Playback acceleration envelope. Shading highlights older trace points fading, while the cursor displays active G vectors.
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
          <button
            type="button"
            className="button"
            onClick={() => {
              if (currentIndex >= trace.length - 1) {
                setPlaybackIndex(0);
              }
              setIsPlaying((current) => !current);
            }}
            disabled={trace.length < 2}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
          >
            {isPlaying ? 'Pause' : (currentIndex >= trace.length - 1 ? 'Replay' : 'Play')}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setIsPlaying(false);
              setPlaybackIndex(trace.length > 0 ? trace.length - 1 : 0);
            }}
            disabled={trace.length < 2}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
          >
            Show Full
          </button>
          <label className="plotter-checkbox-label" style={{ userSelect: 'none', border: '1px solid var(--border-color)', padding: '0.25rem 0.5rem', background: 'rgba(255, 255, 255, 0.02)' }}>
            <input
              type="checkbox"
              checked={swapAxes}
              onChange={(event) => setSwapAxes(event.target.checked)}
              style={{ marginRight: '0.25rem' }}
            />
            <span>Swap Lat / Long</span>
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
                  <text x={CENTER} y={24} textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontWeight="600">
                    {swapAxes ? '+Ay (Lat)' : '+Ax (Long)'}
                  </text>
                  <text x={CENTER} y={DIAGRAM_SIZE - 12} textAnchor="middle" fill="var(--text-secondary)" fontSize="9" fontWeight="600">
                    {swapAxes ? '-Ay (Lat)' : '-Ax (Long)'}
                  </text>
                  <text x={12} y={CENTER + 3} textAnchor="start" fill="var(--text-secondary)" fontSize="9" fontWeight="600">
                    {swapAxes ? '+Ax (Long)' : '+Ay (Lat)'}
                  </text>
                  <text x={DIAGRAM_SIZE - 12} y={CENTER + 3} textAnchor="end" fill="var(--text-secondary)" fontSize="9" fontWeight="600">
                    {swapAxes ? '-Ax (Long)' : '-Ay (Lat)'}
                  </text>

                  {displayedTrace.slice(1).map((point, index) => {
                    const previous = displayedTrace[index];
                    const progress = displayedTrace.length <= 1 ? 1 : index / (displayedTrace.length - 1);
                    const opacity = 0.12 + progress * 0.88;
                    const x1 = CENTER + clampPlayback(previous.x, -2.5, 2.5) * (RADIUS / 2);
                    const y1 = CENTER - clampPlayback(previous.y, -2.5, 2.5) * (RADIUS / 2);
                    const x2 = CENTER + clampPlayback(point.x, -2.5, 2.5) * (RADIUS / 2);
                    const y2 = CENTER - clampPlayback(point.y, -2.5, 2.5) * (RADIUS / 2);

                    return (
                      <line
                        key={`${previous.index}-${point.index}`}
                        x1={x1.toFixed(1)}
                        y1={y1.toFixed(1)}
                        x2={x2.toFixed(1)}
                        y2={y2.toFixed(1)}
                        stroke={selectedSensor?.color || '#00e5ff'}
                        strokeOpacity={opacity}
                        strokeWidth="2"
                        strokeLinecap="round"
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
                  {displayedTrace.slice(1).map((point, index) => {
                    const previous = displayedTrace[index];
                    const progress = displayedTrace.length <= 1 ? 1 : index / (displayedTrace.length - 1);
                    const opacity = 0.12 + progress * 0.88;
                    const x1 = 38 + ((index / Math.max(displayedTrace.length - 1, 1)) * 294);
                    const x2 = 38 + (((index + 1) / Math.max(displayedTrace.length - 1, 1)) * 294);
                    const prevValue = viewMode === 'lat' ? previous.rawAy : previous.rawAx;
                    const nextValue = viewMode === 'lat' ? point.rawAy : point.rawAx;
                    const y1 = 180 - (clampPlayback(prevValue, -2.5, 2.5) * 55);
                    const y2 = 180 - (clampPlayback(nextValue, -2.5, 2.5) * 55);
                    return (
                      <line
                        key={`${previous.index}-${point.index}`}
                        x1={x1.toFixed(1)}
                        y1={y1.toFixed(1)}
                        x2={x2.toFixed(1)}
                        y2={y2.toFixed(1)}
                        stroke={selectedSensor?.color || '#00e5ff'}
                        strokeOpacity={opacity}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    );
                  })}
                </svg>
              )}
            </div>

            {/* Replay Stats List */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Playback Time</span>
                <strong style={{ fontSize: '1.25rem', fontFamily: 'var(--font-mono)' }}>{formatPlaybackSeconds(playbackDurationMs)}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Duration</span>
                <strong style={{ fontSize: '1.25rem', fontFamily: 'var(--font-mono)' }}>{formatPlaybackSeconds(totalDurationMs)}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Current Index</span>
                <strong style={{ fontSize: '1.25rem', fontFamily: 'var(--font-mono)' }}>{currentPoint ? `${currentIndex + 1} / ${trace.length}` : '--'}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Cursor Time</span>
                <strong style={{ fontSize: '1.25rem', fontFamily: 'var(--font-mono)' }}>{currentPoint ? formatPlaybackTimestamp(currentPoint.timestamp) : '--'}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Lateral G</span>
                <strong style={{ fontSize: '1.25rem', fontFamily: 'var(--font-mono)', color: '#00e5ff' }}>{currentPoint ? currentPoint.rawAy.toFixed(3) : '--'}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Longitudinal G</span>
                <strong style={{ fontSize: '1.25rem', fontFamily: 'var(--font-mono)', color: '#ff2a4d' }}>{currentPoint ? currentPoint.rawAx.toFixed(3) : '--'}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            <input
              type="range"
              min="0"
              max={Math.max(trace.length - 1, 0)}
              value={currentIndex}
              onChange={(event) => {
                setIsPlaying(false);
                setPlaybackIndex(Number(event.target.value));
              }}
              style={{
                width: '100%',
                cursor: 'pointer',
                accentColor: 'var(--color-info)'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Faded trace shows earlier positions</span>
              <span>Solid cursor tracks active vector</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
