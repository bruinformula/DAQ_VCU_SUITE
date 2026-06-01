import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { formatSignalValue, getSignalDefinition } from '../signals';

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

function normalizeSeries(values) {
  const finiteValues = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (finiteValues.length === 0) {
    return values;
  }

  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);

  if (max === min) {
    return values.map((value) => (value == null ? null : 0.5));
  }

  return values.map((value) => (
    typeof value === 'number' && Number.isFinite(value)
      ? (value - min) / (max - min)
      : null
  ));
}

function buildPlotData(samples, signalDefs, options = {}) {
  const { normalize = false } = options;
  const rawColumns = [[]];
  signalDefs.forEach(() => rawColumns.push([]));
  const timestampsMs = normalizeSampleTimestamps(samples);
  let hasSignalData = false;

  samples.forEach((sample, sampleIndex) => {
    rawColumns[0].push(timestampsMs[sampleIndex] ?? 0);
    signalDefs.forEach((signal, index) => {
      const value = sample[signal.id];
      const numericValue = typeof value === 'boolean' ? Number(value) : value;
      const plottedValue = typeof numericValue === 'number' && Number.isFinite(numericValue)
        ? numericValue
        : null;
      if (plottedValue !== null) {
        hasSignalData = true;
      }
      rawColumns[index + 1].push(plottedValue);
    });
  });

  const columns = normalize
    ? [rawColumns[0], ...rawColumns.slice(1).map(normalizeSeries)]
    : rawColumns;

  return {
    columns,
    rawColumns,
    hasSignalData,
  };
}

function formatTimestamp(timestampMs) {
  if (!timestampMs) return '--';
  return new Date(timestampMs).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function clampRange(range, fullRange) {
  if (!range || !fullRange) return range;
  const [fullMin, fullMax] = fullRange;
  const width = Math.max(100, range.max - range.min);

  if (width >= fullMax - fullMin) {
    return { min: fullMin, max: fullMax };
  }

  let min = Math.max(fullMin, range.min);
  let max = Math.min(fullMax, range.max);

  if (max - min < width) {
    if (min === fullMin) {
      max = Math.min(fullMax, min + width);
    } else if (max === fullMax) {
      min = Math.max(fullMin, max - width);
    }
  }

  return { min, max };
}

function getFullRange(rawColumns) {
  const xValues = rawColumns?.[0] || [];
  if (xValues.length < 2) return null;
  return [xValues[0], xValues[xValues.length - 1]];
}

function buildCursorSnapshot(index, signalDefs, rawColumns) {
  const times = rawColumns?.[0] || [];
  const timestamp = times[index];
  if (timestamp === undefined) {
    return null;
  }

  return {
    index,
    timestamp,
    values: signalDefs.map((signal, signalIndex) => ({
      signal,
      value: rawColumns[signalIndex + 1]?.[index] ?? null,
    })),
  };
}

function renderMeasurementDelta(pointA, pointB) {
  if (!pointA || !pointB) return null;
  const dtSeconds = (pointB.timestamp - pointA.timestamp) / 1000;
  return `${dtSeconds.toFixed(3)} s`;
}

export default function SignalPlot({
  title,
  signalIds,
  historyRef,
  staticSamples,
  isConnected,
  availableSignalIds = [],
  allowOverlay = false,
  emptyMessage = 'Waiting for data...',
}) {
  const cardRef = useRef(null);
  const chartRef = useRef(null);
  const plotRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const animationFrameRef = useRef(null);
  const sampleSignatureRef = useRef('');
  const latestPlotDataRef = useRef({ columns: [[]], rawColumns: [[]], hasSignalData: false });
  const viewRangeRef = useRef(null);
  const measurementPointsRef = useRef({ a: null, b: null });
  const [cursorSnapshot, setCursorSnapshot] = useState(null);
  const [hasLiveData, setHasLiveData] = useState(false);
  const [overlaySignalId, setOverlaySignalId] = useState('');
  const [extraSignalIds, setExtraSignalIds] = useState([]);
  const [normalizeOverlay, setNormalizeOverlay] = useState(false);
  const [colorOverrides, setColorOverrides] = useState({});
  const [viewRange, setViewRange] = useState(null);
  const [measurementPoints, setMeasurementPoints] = useState({ a: null, b: null });

  useEffect(() => {
    viewRangeRef.current = viewRange;
  }, [viewRange]);

  useEffect(() => {
    measurementPointsRef.current = measurementPoints;
  }, [measurementPoints]);

  const activeSignalIds = useMemo(() => {
    const seen = new Set();
    return [...signalIds, ...extraSignalIds].filter((signalId) => {
      if (!signalId || seen.has(signalId)) return false;
      seen.add(signalId);
      return true;
    });
  }, [extraSignalIds, signalIds]);

  const signalDefs = useMemo(
    () => activeSignalIds.map((signalId) => {
      const signal = getSignalDefinition(signalId);
      return colorOverrides[signalId] ? { ...signal, color: colorOverrides[signalId] } : signal;
    }),
    [activeSignalIds, colorOverrides],
  );

  const overlayOptions = useMemo(() => (
    availableSignalIds.filter((signalId) => signalId !== 'ts' && !activeSignalIds.includes(signalId))
  ), [activeSignalIds, availableSignalIds]);

  useEffect(() => {
    if (!chartRef.current || signalDefs.length === 0) {
      return undefined;
    }

    const normalizedView = normalizeOverlay && staticSamples;
    const units = normalizedView
      ? ['normalized']
      : [...new Set(signalDefs.map((signal) => signal.unit || 'value'))];

    const axes = [
      {
        stroke: 'rgba(255,255,255,0.6)',
        grid: { stroke: 'rgba(255,255,255,0.08)' },
        values: (u, values) => values.map((value) => new Date(value).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        })),
      },
    ];
    const scales = { x: { time: true } };

    units.forEach((unit, index) => {
      scales[unit] = unit === 'normalized' ? { auto: false, range: [0, 1] } : { auto: true };
      axes.push({
        scale: unit,
        side: index % 2 === 0 ? 3 : 1,
        stroke: 'rgba(255,255,255,0.55)',
        grid: { show: index === 0, stroke: 'rgba(255,255,255,0.05)' },
        size: 84,
        values: unit === 'normalized'
          ? (u, values) => values.map((value) => value.toFixed(2))
          : undefined,
      });
    });

    const emptyPlot = buildPlotData([], signalDefs, { normalize: normalizedView });

    const plot = new uPlot({
      width: chartRef.current.clientWidth || 400,
      height: chartRef.current.clientHeight || 220,
      scales,
      axes,
      series: [
        { label: 'Time' },
        ...signalDefs.map((signal) => ({
          label: signal.name,
          stroke: signal.color,
          width: 2,
          scale: normalizedView ? 'normalized' : (signal.unit || 'value'),
        })),
      ],
      cursor: { drag: { x: true, y: false, setScale: true } },
      select: { show: true, over: true, fill: 'rgba(0,229,255,0.12)', stroke: 'rgba(0,229,255,0.4)' },
      legend: { show: false },
      hooks: {
        setScale: [
          (u, key) => {
            if (key !== 'x') return;
            const min = u.scales.x.min;
            const max = u.scales.x.max;
            if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return;
            setViewRange({ min, max });
          },
        ],
        ready: [
          (u) => {
            const updateFromIndex = (index) => {
              const snapshot = buildCursorSnapshot(index, signalDefs, latestPlotDataRef.current.rawColumns);
              setCursorSnapshot(snapshot);
            };

            u.over.addEventListener('mousemove', () => {
              if (u.cursor.idx != null) {
                updateFromIndex(u.cursor.idx);
              }
            });

            u.over.addEventListener('mouseleave', () => {
              if (!measurementPointsRef.current.a && !measurementPointsRef.current.b) {
                setCursorSnapshot(null);
              }
            });

            u.over.addEventListener('click', () => {
              if (u.cursor.idx == null) return;
              const snapshot = buildCursorSnapshot(u.cursor.idx, signalDefs, latestPlotDataRef.current.rawColumns);
              if (!snapshot) return;

              setCursorSnapshot(snapshot);
              setMeasurementPoints((current) => {
                if (!current.a || (current.a && current.b)) {
                  return { a: snapshot, b: null };
                }
                if (current.a.index === snapshot.index) {
                  return { a: current.a, b: null };
                }
                return { a: current.a, b: snapshot };
              });
            });
          },
        ],
      },
    }, emptyPlot.columns, chartRef.current);

    plotRef.current = plot;
    resizeObserverRef.current = new ResizeObserver(() => {
      if (!chartRef.current || !plotRef.current) return;
      plotRef.current.setSize({
        width: chartRef.current.clientWidth,
        height: chartRef.current.clientHeight,
      });
    });
    resizeObserverRef.current.observe(chartRef.current);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      plot.destroy();
      plotRef.current = null;
    };
  }, [normalizeOverlay, signalDefs, staticSamples]);

  useEffect(() => {
    const applyDataToPlot = (samples) => {
      if (!plotRef.current) return;
      const plotData = buildPlotData(samples, signalDefs, {
        normalize: Boolean(staticSamples && normalizeOverlay),
      });
      latestPlotDataRef.current = plotData;
      plotRef.current.setData(plotData.columns);
      setHasLiveData(plotData.hasSignalData);

      const fullRange = getFullRange(plotData.rawColumns);
      if (!fullRange) return;
      if (viewRangeRef.current) {
        const nextRange = clampRange(viewRangeRef.current, fullRange);
        plotRef.current.setScale('x', nextRange);
      } else {
        plotRef.current.setScale('x', { min: fullRange[0], max: fullRange[1] });
      }
    };

    if (staticSamples) {
      applyDataToPlot(staticSamples);
      return;
    }

    const tick = () => {
      const samples = historyRef?.current || [];
      const lastTs = samples[samples.length - 1]?.ts ?? 0;
      const signature = `${samples.length}:${lastTs}`;
      if (plotRef.current && sampleSignatureRef.current !== signature) {
        sampleSignatureRef.current = signature;
        applyDataToPlot(samples);
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [historyRef, normalizeOverlay, signalDefs, staticSamples]);

  const measurementDelta = measurementPoints.a && measurementPoints.b
    ? signalDefs.map((signal, index) => {
      const aValue = measurementPoints.a.values[index]?.value;
      const bValue = measurementPoints.b.values[index]?.value;
      if (typeof aValue !== 'number' || typeof bValue !== 'number') {
        return { signal, delta: null };
      }
      return { signal, delta: bValue - aValue };
    })
    : [];

  const hasData = hasLiveData;

  const handleAddOverlay = () => {
    if (!overlaySignalId) return;
    setExtraSignalIds((current) => (current.includes(overlaySignalId) ? current : [...current, overlaySignalId]));
    setOverlaySignalId('');
  };

  const handleRemoveOverlay = (signalId) => {
    setExtraSignalIds((current) => current.filter((id) => id !== signalId));
  };

  const handleColorChange = (signalId, color) => {
    setColorOverrides((current) => ({ ...current, [signalId]: color }));
  };

  const handleResetZoom = () => {
    viewRangeRef.current = null;
    setViewRange(null);
    const fullRange = getFullRange(latestPlotDataRef.current.rawColumns);
    if (plotRef.current && fullRange) {
      plotRef.current.setScale('x', { min: fullRange[0], max: fullRange[1] });
    }
  };

  const panView = (direction) => {
    const fullRange = getFullRange(latestPlotDataRef.current.rawColumns);
    if (!fullRange) return;
    const currentRange = viewRange || { min: fullRange[0], max: fullRange[1] };
    const width = currentRange.max - currentRange.min;
    const step = width * 0.6 * direction;
    const nextRange = clampRange({
      min: currentRange.min + step,
      max: currentRange.max + step,
    }, fullRange);
    viewRangeRef.current = nextRange;
    setViewRange(nextRange);
    if (plotRef.current) {
      plotRef.current.setScale('x', nextRange);
    }
  };

  const toggleFullscreen = async () => {
    const node = cardRef.current;
    if (!node) return;

    try {
      if (document.fullscreenElement === node) {
        await document.exitFullscreen();
      } else {
        await node.requestFullscreen();
      }
    } catch (error) {
      console.error('Unable to toggle plot fullscreen', error);
    }
  };

  return (
    <section ref={cardRef} className="plot-card glass">
      <div className="plot-card-header">
        <div className="plot-title-block">
          <h3>{title}</h3>
          <p>{signalDefs.map((signal) => signal.name).join(' • ')}</p>
          {staticSamples ? (
            <div className="plot-toolbar">
              <span className="plot-toolbar-hint">Drag across the graph to zoom the log window.</span>
              <button type="button" className="plot-tool-btn" onClick={() => panView(-1)}>Pan Left</button>
              <button type="button" className="plot-tool-btn" onClick={() => panView(1)}>Pan Right</button>
              <button type="button" className="plot-tool-btn" onClick={handleResetZoom}>Reset Zoom</button>
              <button type="button" className="plot-tool-btn" onClick={toggleFullscreen}>Full Screen</button>
            </div>
          ) : null}
        </div>
        <div className="plot-cursor-readout">
          {measurementPoints.a ? (
            <>
              <div className="plot-cursor-time">Point A · {formatTimestamp(measurementPoints.a.timestamp)}</div>
              {measurementPoints.b ? (
                <div className="plot-cursor-time">Point B · {formatTimestamp(measurementPoints.b.timestamp)}</div>
              ) : (
                <div className="plot-cursor-time">Click a second point to measure delta</div>
              )}
              {measurementPoints.b ? (
                <>
                  <div className="plot-measurement-summary">Delta T: {renderMeasurementDelta(measurementPoints.a, measurementPoints.b)}</div>
                  {measurementDelta.map(({ signal, delta }) => (
                    <div key={signal.id} className="plot-cursor-row">
                      <span>{signal.name}</span>
                      <strong>{delta == null ? '--' : `${formatSignalValue(signal, delta)} ${signal.unit}`}</strong>
                    </div>
                  ))}
                  <button type="button" className="plot-tool-btn plot-tool-btn-ghost" onClick={() => setMeasurementPoints({ a: null, b: null })}>
                    Clear Measure
                  </button>
                </>
              ) : null}
            </>
          ) : cursorSnapshot ? (
            <>
              <div className="plot-cursor-time">{formatTimestamp(cursorSnapshot.timestamp)}</div>
              {cursorSnapshot.values.map(({ signal, value }) => (
                <div key={signal.id} className="plot-cursor-row">
                  <span>{signal.name}</span>
                  <strong>{formatSignalValue(signal, value)} {signal.unit}</strong>
                </div>
              ))}
            </>
          ) : (
            <div className="plot-cursor-time">Move the cursor for values. Click once for A, again for B.</div>
          )}
        </div>
      </div>

      {staticSamples && allowOverlay ? (
        <div className="plot-analysis-panel">
          <div className="plot-analysis-copy">
            <strong>Overlay signals</strong>
            <span>Add another CSV channel on top of this chart and normalize the scales to compare correlation.</span>
          </div>
          <div className="plot-overlay-controls">
            <select
              className="plot-overlay-select"
              value={overlaySignalId}
              onChange={(event) => setOverlaySignalId(event.target.value)}
            >
              <option value="">Select a signal to overlay</option>
              {overlayOptions.map((signalId) => {
                const signal = getSignalDefinition(signalId);
                return <option key={signalId} value={signalId}>{signal.name}</option>;
              })}
            </select>
            <button type="button" className="plot-tool-btn" onClick={handleAddOverlay} disabled={!overlaySignalId}>
              Add Overlay
            </button>
            <label className="plot-toggle">
              <input
                type="checkbox"
                checked={normalizeOverlay}
                onChange={(event) => setNormalizeOverlay(event.target.checked)}
              />
              <span>Normalize overlay scales</span>
            </label>
          </div>
          {extraSignalIds.length > 0 ? (
            <div className="plot-overlay-chips">
              {extraSignalIds.map((signalId) => {
                const signal = getSignalDefinition(signalId);
                return (
                  <button
                    key={signalId}
                    type="button"
                    className="plot-overlay-chip"
                    onClick={() => handleRemoveOverlay(signalId)}
                  >
                    {signal.name} ×
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="plot-color-editor">
            <strong>Trace colors</strong>
            <div className="plot-color-grid">
              {signalDefs.map((signal) => (
                <label key={signal.id} className="plot-color-chip">
                  <input
                    type="color"
                    value={signal.color}
                    onChange={(event) => handleColorChange(signal.id, event.target.value)}
                  />
                  <span>{signal.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="plot-frame">
        <div ref={chartRef} className="plot-canvas" />
        {!hasData ? <div className="plot-empty">{emptyMessage}</div> : null}
      </div>
    </section>
  );
}
