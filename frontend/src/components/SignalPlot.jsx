import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { formatSignalValue, getSignalDefinition } from '../signals';

function buildPlotData(samples, signalDefs) {
  const columns = [[]];
  signalDefs.forEach(() => columns.push([]));

  samples.forEach((sample) => {
    columns[0].push((sample.ts || 0) * 1000);
    signalDefs.forEach((signal, index) => {
      const value = sample[signal.id];
      const numericValue = typeof value === 'boolean' ? Number(value) : value;
      columns[index + 1].push(typeof numericValue === 'number' ? numericValue : null);
    });
  });

  return columns;
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

export default function SignalPlot({
  title,
  signalIds,
  historyRef,
  staticSamples,
  isConnected,
  emptyMessage = 'Waiting for data...',
}) {
  const chartRef = useRef(null);
  const plotRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const animationFrameRef = useRef(null);
  const sampleSignatureRef = useRef('');
  const lockedIndexRef = useRef(null);
  const [cursorSnapshot, setCursorSnapshot] = useState(null);

  const signalDefs = useMemo(
    () => signalIds.map(getSignalDefinition),
    [signalIds],
  );

  useEffect(() => {
    if (!chartRef.current || signalDefs.length === 0) {
      return undefined;
    }

    const units = [...new Set(signalDefs.map(signal => signal.unit || 'value'))];
    const axes = [
      {
        stroke: 'rgba(255,255,255,0.6)',
        grid: { stroke: 'rgba(255,255,255,0.08)' },
        values: (u, values) => values.map(value => new Date(value).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
        })),
      },
    ];
    const scales = { x: { time: true } };

    units.forEach((unit, index) => {
      scales[unit] = { auto: true };
      axes.push({
        scale: unit,
        side: index % 2 === 0 ? 3 : 1,
        stroke: 'rgba(255,255,255,0.55)',
        grid: { show: index === 0, stroke: 'rgba(255,255,255,0.05)' },
        size: 84,
      });
    });

    const plot = new uPlot({
      width: chartRef.current.clientWidth || 400,
      height: chartRef.current.clientHeight || 220,
      scales,
      axes,
      series: [
        { label: 'Time' },
        ...signalDefs.map(signal => ({
          label: signal.name,
          stroke: signal.color,
          width: 2,
          scale: signal.unit || 'value',
        })),
      ],
      cursor: { drag: { x: false, y: false } },
      legend: { show: false },
      hooks: {
        ready: [
          (u) => {
            const updateFromIndex = (index) => {
              const times = u.data[0] || [];
              const timestamp = times[index];
              if (timestamp === undefined) {
                setCursorSnapshot(null);
                return;
              }

              setCursorSnapshot({
                timestamp,
                values: signalDefs.map((signal, signalIndex) => ({
                  signal,
                  value: u.data[signalIndex + 1]?.[index] ?? null,
                })),
              });
            };

            u.over.addEventListener('mousemove', () => {
              if (lockedIndexRef.current !== null) return;
              if (u.cursor.idx != null) {
                updateFromIndex(u.cursor.idx);
              }
            });

            u.over.addEventListener('mouseleave', () => {
              if (lockedIndexRef.current === null) {
                setCursorSnapshot(null);
              }
            });

            u.over.addEventListener('click', () => {
              if (u.cursor.idx == null) return;
              if (lockedIndexRef.current === u.cursor.idx) {
                lockedIndexRef.current = null;
                return;
              }
              lockedIndexRef.current = u.cursor.idx;
              updateFromIndex(u.cursor.idx);
            });
          },
        ],
      },
    }, buildPlotData([], signalDefs), chartRef.current);

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
      lockedIndexRef.current = null;
    };
  }, [signalDefs]);

  useEffect(() => {
    if (staticSamples) {
      if (!plotRef.current) return;
      plotRef.current.setData(buildPlotData(staticSamples, signalDefs));
      return;
    }

    const tick = () => {
      const samples = historyRef?.current || [];
      const lastTs = samples[samples.length - 1]?.ts ?? 0;
      const signature = `${samples.length}:${lastTs}`;
      if (plotRef.current && sampleSignatureRef.current !== signature) {
        sampleSignatureRef.current = signature;
        plotRef.current.setData(buildPlotData(samples, signalDefs));
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    if (isConnected) {
      tick();
    }

    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [historyRef, isConnected, signalDefs, staticSamples]);

  const hasData = staticSamples ? staticSamples.length > 0 : (historyRef?.current?.length || 0) > 0;

  return (
    <section className="plot-card glass">
      <div className="plot-card-header">
        <div>
          <h3>{title}</h3>
          <p>{signalDefs.map(signal => signal.name).join(' • ')}</p>
        </div>
        <div className="plot-cursor-readout">
          {cursorSnapshot ? (
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
            <div className="plot-cursor-time">Click a graph to lock a cursor readout</div>
          )}
        </div>
      </div>
      <div className="plot-frame">
        <div ref={chartRef} className="plot-canvas" />
        {!hasData ? <div className="plot-empty">{emptyMessage}</div> : null}
      </div>
    </section>
  );
}
