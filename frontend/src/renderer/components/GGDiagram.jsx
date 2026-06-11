import { useEffect, useMemo, useState } from 'react';
import {
  clampPlayback,
} from '../utils/logPlaybackUtils';

const DIAGRAM_SIZE = 360;
const CENTER = DIAGRAM_SIZE / 2;
const RADIUS = 150;

const SENSOR_FRAMES = {
  0: { latKey: 'imu[0].ax', latSign: 1, longKey: 'imu[0].ay', longSign: 1 },
  1: { latKey: 'imu[1].ax', latSign: -1, longKey: 'imu[1].ay', longSign: -1 },
};

const FUSED_ID = 9;

const sensorOptions = [
  { id: 0, label: 'COG IMU', color: '#00e5ff' },
  { id: 1, label: 'Front IMU', color: '#00ff7f' },
  { id: FUSED_ID, label: 'Fused (COG + Front avg)', color: '#facc15' },
];

const SMOOTHING_SECONDS = 0.3;
const FALLBACK_WINDOW_SAMPLES = 9;

function movingAverage(values, window) {
  if (values.length === 0 || window <= 1) return values.slice();
  const half = Math.floor(window / 2);
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let j = start; j <= end; j += 1) sum += values[j];
    out[i] = sum / (end - start + 1);
  }
  return out;
}

function detectChannelScale(samples, key) {
  const mags = [];
  for (const s of samples) {
    const v = Math.abs(parseFloat(s[key]));
    if (!isNaN(v)) mags.push(v);
  }
  if (mags.length < 10) return 1.0;
  mags.sort((a, b) => a - b);
  const p99 = mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.99))];
  return p99 > 6 ? 1.0 / 9.80665 : 1.0;
}

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

// FIX: Destructured common playback tracking props passed down by parent containers
export default function GGDiagram({ 
  samples = [], 
  availableSignalIds = [],
  currentTime,
  playbackTime,
  playbackIndex
}) {
  const [sensorId, setSensorId] = useState(0);
  const [swapAxes, setSwapAxes] = useState(false);
  const [viewMode, setViewMode] = useState('xy');
  const [filterNoise, setFilterNoise] = useState(true);

  const cogKeys = useMemo(() => {
    const hasIndexed = samples.some(s => s['imu[0].ax'] !== undefined) || availableSignalIds.includes('imu[0].ax');
    if (hasIndexed) return { latKey: 'imu[0].ax', longKey: 'imu[0].ay' };
    return { latKey: 'imu.ax', longKey: 'imu.ay' };
  }, [samples, availableSignalIds]);

  const sensorAvailability = useMemo(() => {
    const has = (key) => availableSignalIds.includes(key);
    const cogOk = (has('imu[0].ax') && has('imu[0].ay')) || (has('imu.ax') && has('imu.ay'));
    const frontOk = has('imu[1].ax') && has('imu[1].ay');
    return { 0: cogOk, 1: frontOk, [FUSED_ID]: cogOk && frontOk };
  }, [availableSignalIds]);

  const availableSensors = useMemo(() => (
    sensorOptions.filter((sensor) => sensorAvailability[sensor.id])
  ), [sensorAvailability]);

  useEffect(() => {
    if (availableSensors.length === 0) return;
    if (!availableSensors.some((sensor) => sensor.id === sensorId)) {
      setSensorId(availableSensors[0].id);
    }
  }, [availableSensors, sensorId]);

  const selectedSensor = availableSensors.find((sensor) => sensor.id === sensorId) || availableSensors[0] || null;

  const channelScales = useMemo(() => ({
    cogLat: detectChannelScale(samples, cogKeys.latKey),
    cogLong: detectChannelScale(samples, cogKeys.longKey),
    frontLat: detectChannelScale(samples, 'imu[1].ax'),
    frontLong: detectChannelScale(samples, 'imu[1].ay'),
  }), [samples, cogKeys]);

  const readCarFrame = useMemo(() => {
    return (sample, id) => {
      const frame = SENSOR_FRAMES[id];
      const latKey = id === 0 ? cogKeys.latKey : frame.latKey;
      const longKey = id === 0 ? cogKeys.longKey : frame.longKey;
      const latScale = id === 0 ? channelScales.cogLat : channelScales.frontLat;
      const longScale = id === 0 ? channelScales.cogLong : channelScales.frontLong;

      const rawLat = parseFloat(sample[latKey]);
      const rawLong = parseFloat(sample[longKey]);
      if (isNaN(rawLat) || isNaN(rawLong)) return null;

      return {
        lat: rawLat * latScale * frame.latSign,
        long: rawLong * longScale * frame.longSign,
      };
    };
  }, [cogKeys, channelScales]);

  const cogCalibration = useMemo(() => {
    const latPairs = [];
    const longPairs = [];
    for (const sample of samples) {
      const cog = readCarFrame(sample, 0);
      const front = readCarFrame(sample, 1);
      if (cog && front) {
        latPairs.push([cog.lat, front.lat]);
        longPairs.push([cog.long, front.long]);
      }
    }
    return { lat: fitCalibration(latPairs), long: fitCalibration(longPairs) };
  }, [samples, readCarFrame]);

  const trace = useMemo(() => {
    if (!selectedSensor) return [];

    const readCalibrated = (sample, id) => {
      const reading = readCarFrame(sample, id);
      if (!reading) return null;
      if (id === 0) {
        return {
          lat: reading.lat * cogCalibration.lat.gain + cogCalibration.lat.offset,
          long: reading.long * cogCalibration.long.gain + cogCalibration.long.offset,
        };
      }
      return reading;
    };

    return samples.map((sample, index) => {
      let lat;
      let long;

      if (selectedSensor.id === FUSED_ID) {
        const cog = readCalibrated(sample, 0);
        const front = readCalibrated(sample, 1);
        if (!cog && !front) return null;
        if (cog && front) {
          lat = (cog.lat + front.lat) / 2;
          long = (cog.long + front.long) / 2;
        } else {
          const only = cog || front;
          lat = only.lat;
          long = only.long;
        }
      } else {
        const reading = readCalibrated(sample, selectedSensor.id);
        if (!reading) return null;
        lat = reading.lat;
        long = reading.long;
      }

      return {
        x: swapAxes ? long : lat,
        y: swapAxes ? lat : long,
        lateral: lat,
        longitudinal: long,
        index,
      };
    }).filter(Boolean);
  }, [samples, selectedSensor, swapAxes, readCarFrame, cogCalibration]);

  const smoothingWindow = useMemo(() => {
    const ts = [];
    for (const s of samples) {
      const v = parseFloat(s.ts);
      if (!isNaN(v)) ts.push(v);
      if (ts.length >= 500) break;
    }
    if (ts.length < 10) return FALLBACK_WINDOW_SAMPLES;
    const dts = [];
    for (let i = 1; i < ts.length; i += 1) {
      const d = ts[i] - ts[i - 1];
      if (d > 0) dts.push(d);
    }
    if (dts.length === 0) return FALLBACK_WINDOW_SAMPLES;
    dts.sort((a, b) => a - b);
    const medianDt = dts[Math.floor(dts.length / 2)];
    const w = Math.round(SMOOTHING_SECONDS / medianDt);
    return Math.max(3, Math.min(101, w));
  }, [samples]);

  const smoothedTrace = useMemo(() => {
    if (trace.length === 0) return [];
    const latSmoothed = movingAverage(trace.map((p) => p.lateral), smoothingWindow);
    const longSmoothed = movingAverage(trace.map((p) => p.longitudinal), smoothingWindow);
    return trace.map((p, i) => ({
      ...p,
      lateral: latSmoothed[i],
      longitudinal: longSmoothed[i],
      x: swapAxes ? longSmoothed[i] : latSmoothed[i],
      y: swapAxes ? latSmoothed[i] : longSmoothed[i],
    }));
  }, [trace, swapAxes, smoothingWindow]);

  const displayTrace = filterNoise ? smoothedTrace : trace;

  // FIX: Initialized variables to real dataset extremes instead of strict 0s
  const computeExtremes = (source) => {
    if (!source || source.length === 0) {
      return { maxLat: 0, minLat: 0, maxLong: 0, minLong: 0 };
    }
    let maxLat = source[0].lateral;
    let minLat = source[0].lateral;
    let maxLong = source[0].longitudinal;
    let minLong = source[0].longitudinal;

    for (const pt of source) {
      if (pt.lateral > maxLat) maxLat = pt.lateral;
      if (pt.lateral < minLat) minLat = pt.lateral;
      if (pt.longitudinal > maxLong) maxLong = pt.longitudinal;
      if (pt.longitudinal < minLong) minLong = pt.longitudinal;
    }
    return { maxLat, minLat, maxLong, minLong };
  };

  const maxes = useMemo(() => computeExtremes(trace), [trace]);

  // FIX: Dynamic playback alignment lookups for the main crosshair point marker
  const currentPoint = useMemo(() => {
    if (displayTrace.length === 0) return null;

    // A. Match by active slice index index if available
    if (playbackIndex !== undefined) {
      const pt = displayTrace.find(p => p.index === playbackIndex);
      if (pt) return pt;
    }

    // B. Match by timestamp sync if context clocks are present
    const timeVal = currentTime ?? playbackTime;
    if (timeVal !== undefined) {
      let closest = displayTrace[0];
      let minDiff = Infinity;
      for (const pt of displayTrace) {
        const sampleTS = parseFloat(samples[pt.index]?.ts);
        if (!isNaN(sampleTS)) {
          const diff = Math.abs(sampleTS - timeVal);
          if (diff < minDiff) {
            minDiff = diff;
            closest = pt;
          }
        }
      }
      return closest;
    }

    // Fallback: Default to absolute trail end
    return displayTrace[displayTrace.length - 1] || null;
  }, [displayTrace, samples, currentTime, playbackIndex, playbackTime]);

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
          <label className="plotter-checkbox-label" style={{ userSelect: 'none', border: '1px solid var(--border-color)', padding: '0.25rem 0.5rem', background: 'rgba(255, 255, 255, 0.02)' }}>
            <input
              type="checkbox"
              checked={filterNoise}
              onChange={(event) => setFilterNoise(event.target.checked)}
              style={{ marginRight: '0.25rem' }}
            />
            <span>Filter Spikes ({SMOOTHING_SECONDS}s LPF)</span>
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

                  {displayTrace.map((point) => {
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
                  {displayTrace.map((point) => {
                    const cx = 38 + ((point.index / Math.max(displayTrace.length - 1, 1)) * 294);
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
                <h3 className="section-title" style={{ fontSize: '0.9rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Session Maxes (Absolute Peaks / Whole Range)</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-slate-400">Max Lat (L/R):</span>
                    <strong style={{ color: selectedSensor?.color }}>{maxes.minLat.toFixed(2)} / {maxes.maxLat.toFixed(2)} G</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-slate-400">Max Long (B/A):</span>
                    <strong style={{ color: selectedSensor?.color }}>{maxes.minLong.toFixed(2)} / {maxes.maxLong.toFixed(2)} G</strong>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
                    {(selectedSensor?.id === 0 || selectedSensor?.id === FUSED_ID) && cogCalibration.lat.applied ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1.4 }}>
                        COG calibrated to Front IMU: lat ×{cogCalibration.lat.gain.toFixed(3)} {cogCalibration.lat.offset >= 0 ? '+' : '−'}{Math.abs(cogCalibration.lat.offset).toFixed(3)},
                        {' '}long ×{cogCalibration.long.gain.toFixed(3)} {cogCalibration.long.offset >= 0 ? '+' : '−'}{Math.abs(cogCalibration.long.offset).toFixed(3)}
                      </div>
                    ) : null}
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