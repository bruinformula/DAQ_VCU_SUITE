import { useEffect, useMemo, useState } from 'react';

const DIAGRAM_SIZE = 360;
const CENTER = DIAGRAM_SIZE / 2;
const RADIUS = 150;

function normalizeSampleTimestamps(samples) {
  const rawTimestamps = samples.map((sample) => (
    typeof sample?.ts === 'number' && Number.isFinite(sample.ts) ? sample.ts : null
  ));
  const positiveTimestamps = rawTimestamps.filter((value) => value != null && value > 0);

  if (positiveTimestamps.length === 0) {
    return samples.map((_, index) => index * 100);
  }

  const epochLike = positiveTimestamps[0] > 1e8;
  const fallbackMs = positiveTimestamps[0] * 1000;
  let previousMs = fallbackMs;

  return rawTimestamps.map((value, index) => {
    let timestampMs;

    if (value == null) {
      timestampMs = index === 0 ? fallbackMs : previousMs;
    } else if (epochLike) {
      timestampMs = value > 0 ? value * 1000 : previousMs;
    } else {
      timestampMs = value * 1000;
    }

    if (!Number.isFinite(timestampMs)) {
      timestampMs = previousMs;
    }

    if (index > 0 && timestampMs < previousMs) {
      timestampMs = previousMs;
    }

    previousMs = timestampMs;
    return timestampMs;
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatTimestamp(timestampMs) {
  if (!timestampMs) return '--';
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)} s`;
}

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

  const availableSensors = useMemo(() => (
    sensorOptions.filter((sensor) => availableSignalIds.includes(sensor.ax) && availableSignalIds.includes(sensor.ay))
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

    return samples.map((sample, index) => {
      const ax = sample[selectedSensor.ax];
      const ay = sample[selectedSensor.ay];
      if (typeof ax !== 'number' || typeof ay !== 'number' || !Number.isFinite(ax) || !Number.isFinite(ay)) {
        return null;
      }
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

  const currentIndex = clamp(playbackIndex, 0, Math.max(trace.length - 1, 0));
  const displayedTrace = trace.slice(0, currentIndex + 1);
  const currentPoint = displayedTrace[displayedTrace.length - 1] || null;
  const totalDurationMs = trace.length > 1 ? trace[trace.length - 1].timestamp - trace[0].timestamp : 0;
  const playbackDurationMs = displayedTrace.length > 1
    ? displayedTrace[displayedTrace.length - 1].timestamp - displayedTrace[0].timestamp
    : 0;

  return (
    <section className="gg-shell glass">
      <div className="gg-header">
        <div>
          <h3>G-G Diagram Replay</h3>
          <p>Playback the accel envelope over time, then finish with the full trace shaded from early light to late dark.</p>
        </div>
        <div className="gg-header-controls">
          <select
            className="plot-overlay-select"
            value={selectedSensor?.id ?? ''}
            onChange={(event) => setSensorId(Number(event.target.value))}
            disabled={availableSensors.length === 0}
          >
            {availableSensors.length === 0 ? (
              <option value="">No IMU accel pair in this CSV</option>
            ) : availableSensors.map((sensor) => (
              <option key={sensor.id} value={sensor.id}>{sensor.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="plot-tool-btn"
            onClick={() => {
              if (currentIndex >= trace.length - 1) {
                setPlaybackIndex(0);
              }
              setIsPlaying((current) => !current);
            }}
            disabled={trace.length < 2}
          >
            {isPlaying ? 'Pause' : (currentIndex >= trace.length - 1 ? 'Replay' : 'Play')}
          </button>
          <button
            type="button"
            className="plot-tool-btn"
            onClick={() => {
              setIsPlaying(false);
              setPlaybackIndex(trace.length > 0 ? trace.length - 1 : 0);
            }}
            disabled={trace.length < 2}
          >
            Show Full Trace
          </button>
          <label className="plot-toggle">
            <input
              type="checkbox"
              checked={swapAxes}
              onChange={(event) => setSwapAxes(event.target.checked)}
            />
            <span>Swap Lat / Long</span>
          </label>
        </div>
      </div>

      {trace.length === 0 ? (
        <div className="gg-empty">This CSV does not contain a usable lateral/longitudinal accel pair for the selected IMU.</div>
      ) : (
        <>
          <div className="gg-body">
            <div className="gg-diagram-card">
              <svg viewBox={`0 0 ${DIAGRAM_SIZE} ${DIAGRAM_SIZE}`} className="gg-diagram">
                <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.24)" strokeWidth="2" />
                <circle cx={CENTER} cy={CENTER} r={RADIUS * 0.5} fill="none" stroke="rgba(255,255,255,0.14)" strokeDasharray="4 4" />
                <line x1={CENTER} y1={CENTER - RADIUS} x2={CENTER} y2={CENTER + RADIUS} stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
                <line x1={CENTER - RADIUS} y1={CENTER} x2={CENTER + RADIUS} y2={CENTER} stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" />
                <text x={CENTER} y={28} textAnchor="middle" className="gg-axis-label">
                  {swapAxes ? '+Ay' : '+Ax'}
                </text>
                <text x={CENTER} y={DIAGRAM_SIZE - 16} textAnchor="middle" className="gg-axis-label">
                  {swapAxes ? '-Ay' : '-Ax'}
                </text>
                <text x={20} y={CENTER + 5} textAnchor="start" className="gg-axis-label">
                  {swapAxes ? '+Ax' : '+Ay'}
                </text>
                <text x={DIAGRAM_SIZE - 20} y={CENTER + 5} textAnchor="end" className="gg-axis-label">
                  {swapAxes ? '-Ax' : '-Ay'}
                </text>

                {displayedTrace.slice(1).map((point, index) => {
                  const previous = displayedTrace[index];
                  const progress = displayedTrace.length <= 1 ? 1 : index / (displayedTrace.length - 1);
                  const opacity = 0.16 + progress * 0.84;
                  const x1 = CENTER + clamp(previous.x, -2, 2) * (RADIUS / 2);
                  const y1 = CENTER - clamp(previous.y, -2, 2) * (RADIUS / 2);
                  const x2 = CENTER + clamp(point.x, -2, 2) * (RADIUS / 2);
                  const y2 = CENTER - clamp(point.y, -2, 2) * (RADIUS / 2);

                  return (
                    <line
                      key={`${previous.index}-${point.index}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={selectedSensor?.color || '#00e5ff'}
                      strokeOpacity={opacity}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  );
                })}

                {currentPoint ? (
                  <circle
                    cx={CENTER + clamp(currentPoint.x, -2, 2) * (RADIUS / 2)}
                    cy={CENTER - clamp(currentPoint.y, -2, 2) * (RADIUS / 2)}
                    r="5.5"
                    fill={selectedSensor?.color || '#00e5ff'}
                    stroke="#ffffff"
                    strokeOpacity="0.6"
                    strokeWidth="1"
                  />
                ) : null}
              </svg>
            </div>

            <div className="gg-stats">
              <div className="gg-stat-card">
                <span>Playback Time</span>
                <strong>{formatSeconds(playbackDurationMs)}</strong>
              </div>
              <div className="gg-stat-card">
                <span>Total Duration</span>
                <strong>{formatSeconds(totalDurationMs)}</strong>
              </div>
              <div className="gg-stat-card">
                <span>Current Sample</span>
                <strong>{currentPoint ? `${currentIndex + 1} / ${trace.length}` : '--'}</strong>
              </div>
              <div className="gg-stat-card">
                <span>Cursor Time</span>
                <strong>{currentPoint ? formatTimestamp(currentPoint.timestamp) : '--'}</strong>
              </div>
              <div className="gg-stat-card">
                <span>Lateral G</span>
                <strong>{currentPoint ? currentPoint.rawAy.toFixed(2) : '--'}</strong>
              </div>
              <div className="gg-stat-card">
                <span>Longitudinal G</span>
                <strong>{currentPoint ? currentPoint.rawAx.toFixed(2) : '--'}</strong>
              </div>
            </div>
          </div>

          <div className="gg-slider-row">
            <input
              className="gg-slider"
              type="range"
              min="0"
              max={Math.max(trace.length - 1, 0)}
              value={currentIndex}
              onChange={(event) => {
                setIsPlaying(false);
                setPlaybackIndex(Number(event.target.value));
              }}
            />
            <div className="gg-slider-caption">
              <span>Earlier readings fade lighter.</span>
              <span>Newer readings deepen toward the active color.</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
