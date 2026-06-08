import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Line } from 'react-chartjs-2';
import { Maximize2, Minimize2 } from 'lucide-react';
import { crosshairPlugin } from '../utils/chartInteractionPlugins';

/**
 * Drop-in replacement for react-chartjs-2's <Line> that adds:
 *   - dashed vertical crosshair following the cursor
 *   - drag horizontally to zoom the X axis
 *   - drag vertically to zoom the Y axis
 *   - double-click to reset to fit
 *   - fullscreen zoom-in toggle mode via portal
 *
 * Zoom ranges are held in React state and merged into the chart options on
 * every render, so they survive react-chartjs-2 replacing chart.options.
 */
export default function ZoomableLine({
  options,
  data,
  plugins = [],
  title = '',
  description = ''
}) {
  const chartRef = useRef(null);
  const dragStateRef = useRef(null);
  const renderRafRef = useRef(0);
  const [dragRect, setDragRect] = useState(null);
  const [xRange, setXRange] = useState({ min: null, max: null });
  const [yRange, setYRange] = useState({ min: null, max: null });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  const scheduleRender = useCallback(() => {
    if (renderRafRef.current) return;
    renderRafRef.current = requestAnimationFrame(() => {
      renderRafRef.current = 0;
      const chart = chartRef.current;
      if (chart) chart.render();
    });
  }, []);

  useEffect(() => () => {
    if (renderRafRef.current) cancelAnimationFrame(renderRafRef.current);
  }, []);

  const mergedOptions = useMemo(() => {
    const baseScales = options?.scales || {};
    const xScale = baseScales.x || {};
    const yScale = baseScales.y || {};
    return {
      ...options,
      scales: {
        ...baseScales,
        x: {
          ...xScale,
          min: xRange.min != null ? xRange.min : xScale.min,
          max: xRange.max != null ? xRange.max : xScale.max
        },
        y: {
          ...yScale,
          min: yRange.min != null ? yRange.min : yScale.min,
          max: yRange.max != null ? yRange.max : yScale.max
        }
      }
    };
  }, [options, xRange, yRange]);

  const getChartPoint = useCallback((evt) => {
    const chart = chartRef.current;
    if (!chart || !chart.canvas) return null;
    const rect = chart.canvas.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
      chart
    };
  }, []);

  const isInChartArea = useCallback((chart, x, y) => {
    const xs = chart.scales.x;
    const ys = chart.scales.y;
    return xs && ys && x >= xs.left && x <= xs.right && y >= ys.top && y <= ys.bottom;
  }, []);

  const handleMouseMove = useCallback((evt) => {
    const pt = getChartPoint(evt);
    if (!pt) return;
    const { x, y, chart } = pt;

    if (isInChartArea(chart, x, y)) {
      chart.$crosshairX = x;
    } else {
      chart.$crosshairX = null;
    }

    const ds = dragStateRef.current;
    if (ds) {
      const dx = Math.abs(x - ds.startX);
      const dy = Math.abs(y - ds.startY);
      let mode = ds.mode;
      if (mode === null && (dx > 5 || dy > 5)) {
        mode = dx >= dy ? 'x' : 'y';
      }
      const xs = chart.scales.x;
      const ys = chart.scales.y;
      const clampedX = Math.max(xs.left, Math.min(xs.right, x));
      const clampedY = Math.max(ys.top, Math.min(ys.bottom, y));
      dragStateRef.current = { ...ds, currentX: clampedX, currentY: clampedY, mode };
      if (mode) {
        setDragRect({
          mode,
          area: { left: xs.left, right: xs.right, top: ys.top, bottom: ys.bottom },
          x1: ds.startX,
          y1: ds.startY,
          x2: clampedX,
          y2: clampedY
        });
      }
    }
    scheduleRender();
  }, [getChartPoint, isInChartArea, scheduleRender]);

  const handleMouseDown = useCallback((evt) => {
    if (evt.button !== 0) return;
    const pt = getChartPoint(evt);
    if (!pt) return;
    const { x, y, chart } = pt;
    if (!isInChartArea(chart, x, y)) return;
    dragStateRef.current = { startX: x, startY: y, currentX: x, currentY: y, mode: null };
    setDragRect(null);
  }, [getChartPoint, isInChartArea]);

  const finishDrag = useCallback(() => {
    const ds = dragStateRef.current;
    dragStateRef.current = null;
    setDragRect(null);
    if (!ds || !ds.mode) return;
    const chart = chartRef.current;
    if (!chart) return;
    const xs = chart.scales.x;
    const ys = chart.scales.y;
    if (ds.mode === 'x') {
      const minPx = Math.min(ds.startX, ds.currentX);
      const maxPx = Math.max(ds.startX, ds.currentX);
      if (maxPx - minPx < 5) return;
      const min = xs.getValueForPixel(minPx);
      const max = xs.getValueForPixel(maxPx);
      if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
        setXRange({ min, max });
      }
    } else {
      const minPx = Math.min(ds.startY, ds.currentY);
      const maxPx = Math.max(ds.startY, ds.currentY);
      if (maxPx - minPx < 5) return;
      const max = ys.getValueForPixel(minPx);
      const min = ys.getValueForPixel(maxPx);
      if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
        setYRange({ min, max });
      }
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    finishDrag();
  }, [finishDrag]);

  const handleMouseLeave = useCallback(() => {
    const chart = chartRef.current;
    if (chart) {
      chart.$crosshairX = null;
      scheduleRender();
    }
  }, [scheduleRender]);

  const handleDoubleClick = useCallback(() => {
    setXRange({ min: null, max: null });
    setYRange({ min: null, max: null });
  }, []);

  useEffect(() => {
    const onUp = () => {
      if (dragStateRef.current) finishDrag();
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [finishDrag]);

  const mergedPlugins = useMemo(() => [crosshairPlugin, ...plugins], [plugins]);

  const renderChartContent = () => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        cursor: dragRect ? 'crosshair' : 'default',
        userSelect: 'none'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      <Line ref={chartRef} options={mergedOptions} data={data} plugins={mergedPlugins} />
      {dragRect && (
        <div
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            background: 'rgba(59, 130, 246, 0.18)',
            border: '1px solid rgba(59, 130, 246, 0.7)',
            left: dragRect.mode === 'x'
              ? Math.min(dragRect.x1, dragRect.x2)
              : dragRect.area.left,
            top: dragRect.mode === 'y'
              ? Math.min(dragRect.y1, dragRect.y2)
              : dragRect.area.top,
            width: dragRect.mode === 'x'
              ? Math.abs(dragRect.x2 - dragRect.x1)
              : dragRect.area.right - dragRect.area.left,
            height: dragRect.mode === 'y'
              ? Math.abs(dragRect.y2 - dragRect.y1)
              : dragRect.area.bottom - dragRect.area.top
          }}
        />
      )}
    </div>
  );

  if (isFullscreen) {
    return createPortal(
      <div className="fullscreen-chart-overlay">
        <div className="fullscreen-chart-header">
          <div className="fullscreen-chart-title-group">
            <h2 className="fullscreen-chart-title">{title || options?.plugins?.title?.text || 'Telemetry Analysis'}</h2>
            {description && <p className="fullscreen-chart-desc">{description}</p>}
          </div>
          <button 
            type="button" 
            className="fullscreen-close-btn"
            onClick={() => setIsFullscreen(false)}
          >
            <Minimize2 size={14} /> Close
          </button>
        </div>
        <div className="fullscreen-chart-body">
          {renderChartContent()}
        </div>
        <div className="fullscreen-chart-footer">
          <span>Click and drag horizontally or vertically to zoom. Double-click to reset.</span>
          <span>Press <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>ESC</kbd> to exit fullscreen</span>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {renderChartContent()}
      <button 
        type="button" 
        className="chart-fullscreen-btn" 
        onClick={() => setIsFullscreen(true)}
        title="Maximize Chart"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  );
}
