import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { formatSignalValue, getSignalDefinition } from '../signals';
import {
  clampPlayback,
  findClosestIndexByTimestamp,
  formatPlaybackSeconds,
  formatPlaybackTimestamp,
  gMagnitude,
  gToColor,
  normalizeSampleTimestamps,
} from './logPlaybackUtils';

const STREET_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#17232d' } },
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
      paint: {
        'raster-saturation': -0.18,
        'raster-contrast': 0.14,
        'raster-brightness-min': 0.18,
        'raster-brightness-max': 0.94,
      },
    },
  ],
};

function rtkStatusLabel(quality, state) {
  if (state) return String(state).replace(/_/g, ' ').toUpperCase();
  return ({
    0: 'NO FIX',
    1: 'GPS',
    2: 'DGPS',
    4: 'RTK FIX',
    5: 'RTK FLOAT',
  }[quality] || `Q${quality ?? '--'}`);
}

function buildReplaySignalPath(points, yMin, yMax) {
  if (points.length < 2) return '';
  return points.map((point, index) => {
    const x = 28 + (index / Math.max(points.length - 1, 1)) * 500;
    const normalized = yMax === yMin ? 0.5 : (point.value - yMin) / (yMax - yMin);
    const y = 188 - (normalized * 156);
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
}

function buildReplayGridFeature(bounds) {
  if (!bounds) {
    return { type: 'FeatureCollection', features: [] };
  }

  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const width = east - west;
  const height = north - south;

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features = [];

  const addLine = (coords) => {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coords,
      },
      properties: {},
    });
  };

  addLine([[west, south], [east, south], [east, north], [west, north], [west, south]]);

  for (let i = 1; i < 4; i += 1) {
    const x = west + (width * i / 4);
    const y = south + (height * i / 4);
    addLine([[x, south], [x, north]]);
    addLine([[west, y], [east, y]]);
  }

  const cx = west + width / 2;
  const cy = south + height / 2;
  addLine([[cx, south], [cx, north]]);
  addLine([[west, cy], [east, cy]]);

  return {
    type: 'FeatureCollection',
    features,
  };
}

function updateTrackSource(map, replayPoints) {
  if (!map?.isStyleLoaded()) return;
  const pointSource = map.getSource('gps-playback-track');
  const lineSource = map.getSource('gps-playback-line');
  const gridSource = map.getSource('gps-playback-grid');
  if (!pointSource || !lineSource || !gridSource) return;

  pointSource.setData({
    type: 'FeatureCollection',
    features: replayPoints.map((point) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
      properties: {
        timestamp: point.timestamp,
        color: gToColor(point.gMag),
      },
    })),
  });
  lineSource.setData({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: replayPoints.map((point) => [point.lon, point.lat]),
    },
    properties: {},
  });

  if (replayPoints.length) {
    const bounds = replayPoints.reduce(
      (acc, point) => acc.extend([point.lon, point.lat]),
      new maplibregl.LngLatBounds(
        [replayPoints[0].lon, replayPoints[0].lat],
        [replayPoints[0].lon, replayPoints[0].lat],
      ),
    );
    gridSource.setData(buildReplayGridFeature(bounds));
    map.fitBounds(bounds, { padding: 60, duration: 0, maxZoom: 17 });
  } else {
    gridSource.setData({ type: 'FeatureCollection', features: [] });
  }
}

export default function GPSPlayback({ samples = [], availableSignalIds = [] }) {
  const shellRef = useRef(null);
  const mapRef = useRef(null);
  const mapNodeRef = useRef(null);
  const markerRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const pointsRef = useRef([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedSignalId, setSelectedSignalId] = useState('sdu[0].shock');
  const [selectedSignalIds, setSelectedSignalIds] = useState(['sdu[0].shock']);
  const [traceColors, setTraceColors] = useState({});
  const [mapLayout, setMapLayout] = useState('balanced');
  const [mapHealthy, setMapHealthy] = useState(false);
  const [basemapHealthy, setBasemapHealthy] = useState(false);

  const signalOptions = useMemo(() => (
    availableSignalIds.filter((signalId) => signalId !== 'ts')
  ), [availableSignalIds]);

  useEffect(() => {
    if (!signalOptions.length) return;
    if (!signalOptions.includes(selectedSignalId)) {
      setSelectedSignalId(signalOptions[0]);
    }
  }, [selectedSignalId, signalOptions]);

  useEffect(() => {
    if (!signalOptions.length) {
      setSelectedSignalIds([]);
      return;
    }

    setSelectedSignalIds((current) => {
      const filtered = current.filter((signalId) => signalOptions.includes(signalId));
      if (filtered.length) return filtered;
      return [signalOptions[0]];
    });
  }, [signalOptions]);

  const points = useMemo(() => {
    const timestamps = normalizeSampleTimestamps(samples);
    return samples.map((sample, index) => {
      const lat = sample['gps.lat'];
      const lon = sample['gps.lon'];
      if (typeof lat !== 'number' || typeof lon !== 'number' || lat === 0 || lon === 0) {
        return null;
      }
      return {
        index,
        timestamp: timestamps[index] ?? 0,
        lat,
        lon,
        alt: sample['gps.alt'],
        vel: sample['gps.vel'],
        hdg: sample['gps.hdg'],
        sats: sample['gps.sats'],
        fixQuality: sample['gps.fix_quality'],
        rtkState: sample['gps.rtk_state'],
        hdop: sample['gps.hdop'],
        headingAccuracy: sample['gps.heading_accuracy_deg'],
        baseline: sample['gps.baseline_m'],
        headingSource: sample['gps.heading_source'],
        signalValues: Object.fromEntries(
          selectedSignalIds.map((signalId) => [signalId, sample[signalId]]),
        ),
        gMag: gMagnitude(sample, 'imu[0].ax', 'imu[0].ay'),
      };
    }).filter(Boolean);
  }, [samples, selectedSignalIds]);

  const signalSeriesMap = useMemo(() => (
    Object.fromEntries(selectedSignalIds.map((signalId) => [
      signalId,
      points
        .filter((point) => typeof point.signalValues?.[signalId] === 'number' && Number.isFinite(point.signalValues[signalId]))
        .map((point) => ({ index: point.index, timestamp: point.timestamp, value: point.signalValues[signalId] })),
    ]))
  ), [points, selectedSignalIds]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    if (playbackIndex >= points.length) {
      setPlaybackIndex(Math.max(points.length - 1, 0));
    }
  }, [playbackIndex, points.length]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenNow = document.fullscreenElement === shellRef.current;
      setIsFullscreen(fullscreenNow);
      window.setTimeout(() => mapRef.current?.resize(), 120);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isPlaying || points.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setPlaybackIndex((current) => {
        if (current >= points.length - 1) {
          setIsPlaying(false);
          return points.length - 1;
        }
        return current + 1;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [isPlaying, points.length]);

  useEffect(() => {
    if (mapRef.current || !mapNodeRef.current) return undefined;
    const map = new maplibregl.Map({
      container: mapNodeRef.current,
      style: STREET_STYLE,
      center: [-118.445, 34.068],
      zoom: 15,
      pitch: 40,
      bearing: -8,
      antialias: true,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');

    const markerEl = document.createElement('div');
    markerEl.className = 'gps-playback-marker';
    markerRef.current = new maplibregl.Marker({ element: markerEl, rotationAlignment: 'map' }).setLngLat([-118.445, 34.068]).addTo(map);

    const syncMap = () => {
      try {
        map.resize();
        if (map.isStyleLoaded()) {
          updateTrackSource(map, pointsRef.current);
        }
        setMapHealthy(true);
      } catch (error) {
        console.error('GPS playback map resize/sync error', error);
      }
    };

    map.on('load', () => {
      map.addSource('gps-playback-track', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('gps-playback-line', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      });
      map.addSource('gps-playback-grid', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'gps-playback-grid-layer',
        type: 'line',
        source: 'gps-playback-grid',
        paint: {
          'line-color': 'rgba(134, 219, 255, 0.18)',
          'line-width': 1.1,
          'line-opacity': 0.92,
        },
      });
      map.addLayer({
        id: 'gps-playback-line-glow',
        type: 'line',
        source: 'gps-playback-line',
        paint: {
          'line-color': 'rgba(0, 229, 255, 0.28)',
          'line-width': 10,
          'line-blur': 1.2,
          'line-opacity': 0.72,
        },
      });
      map.addLayer({
        id: 'gps-playback-line-core',
        type: 'line',
        source: 'gps-playback-line',
        paint: {
          'line-color': '#f8fafc',
          'line-width': 3.8,
          'line-opacity': 0.92,
        },
      });
      map.addLayer({
        id: 'gps-playback-track-points',
        type: 'circle',
        source: 'gps-playback-track',
        paint: {
          'circle-radius': 4.6,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.96,
          'circle-stroke-width': 1.4,
          'circle-stroke-color': 'rgba(255,255,255,0.88)',
        },
      });
      map.on('click', 'gps-playback-track-points', (event) => {
        const feature = event.features?.[0];
        const targetTs = feature?.properties?.timestamp;
        if (targetTs == null) return;
        const timestamps = pointsRef.current.map((point) => point.timestamp);
        setIsPlaying(false);
        setPlaybackIndex(findClosestIndexByTimestamp(timestamps, Number(targetTs)));
      });
      updateTrackSource(map, pointsRef.current);
      setMapHealthy(true);
    });

    map.on('styledata', () => {
      if (map.isStyleLoaded()) {
        syncMap();
      }
    });

    map.on('sourcedata', (event) => {
      if (event.sourceId === 'osm' && event.isSourceLoaded) {
        setBasemapHealthy(true);
      }
    });

    map.on('idle', () => {
      if (map.isStyleLoaded()) {
        setMapHealthy(true);
      }
    });

    map.on('error', (event) => {
      console.error('GPS playback map error', event?.error || event);
      if (event?.sourceId === 'osm') {
        setBasemapHealthy(false);
      }
    });

    resizeObserverRef.current = new ResizeObserver(() => {
      requestAnimationFrame(syncMap);
    });
    resizeObserverRef.current.observe(mapNodeRef.current);
    window.addEventListener('resize', syncMap);
    const resizeTimers = [
      window.setTimeout(syncMap, 0),
      window.setTimeout(syncMap, 120),
      window.setTimeout(syncMap, 600),
    ];

    return () => {
      resizeTimers.forEach((timerId) => window.clearTimeout(timerId));
      window.removeEventListener('resize', syncMap);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    updateTrackSource(mapRef.current, points);
  }, [points]);

  useEffect(() => {
    requestAnimationFrame(() => mapRef.current?.resize());
  }, [mapLayout, isFullscreen]);

  const currentPoint = points[clampPlayback(playbackIndex, 0, Math.max(points.length - 1, 0))] || null;

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !currentPoint) return;
    marker.setLngLat([currentPoint.lon, currentPoint.lat]);
    marker.setRotation(currentPoint.hdg || 0);
    map.easeTo({
      center: [currentPoint.lon, currentPoint.lat],
      bearing: currentPoint.hdg || map.getBearing(),
      duration: 180,
      essential: true,
    });
  }, [currentPoint]);

  const signalDefs = useMemo(() => (
    selectedSignalIds.map((signalId) => getSignalDefinition(signalId))
  ), [selectedSignalIds]);
  const activeSignalDef = getSignalDefinition(selectedSignalId);
  const yValues = Object.values(signalSeriesMap).flat().map((point) => point.value);
  const yMin = yValues.length ? Math.min(...yValues) : 0;
  const yMax = yValues.length ? Math.max(...yValues) : 1;
  const totalDuration = points.length > 1 ? points[points.length - 1].timestamp - points[0].timestamp : 0;
  const currentDuration = currentPoint ? currentPoint.timestamp - points[0].timestamp : 0;

  const addSignalOverlay = () => {
    if (!selectedSignalId) return;
    setSelectedSignalIds((current) => (
      current.includes(selectedSignalId) ? current : [...current, selectedSignalId]
    ));
  };

  const removeSignalOverlay = (signalId) => {
    setSelectedSignalIds((current) => current.filter((entry) => entry !== signalId));
  };

  const toggleFullscreen = async () => {
    if (!shellRef.current) return;
    if (document.fullscreenElement === shellRef.current) {
      await document.exitFullscreen();
      return;
    }
    await shellRef.current.requestFullscreen();
  };

  return (
    <section
      ref={shellRef}
      className={`gps-playback-shell glass gps-playback-layout-${mapLayout}`}
    >
      <div className="gps-playback-header">
        <div>
          <h3>GPS Replay Studio</h3>
          <p>Replay the lap on a map with RTK context, G-coded track points, and a synchronized side graph.</p>
        </div>
        <div className="gps-playback-controls">
          <select className="plot-overlay-select" value={selectedSignalId} onChange={(event) => setSelectedSignalId(event.target.value)}>
            {signalOptions.map((signalId) => {
              const signal = getSignalDefinition(signalId);
              return <option key={signalId} value={signalId}>{signal.name}</option>;
            })}
          </select>
          <button
            type="button"
            className="plot-tool-btn"
            onClick={addSignalOverlay}
            disabled={!selectedSignalId}
          >
            Add Signal
          </button>
          <button
            type="button"
            className="plot-tool-btn"
            onClick={() => {
              if (playbackIndex >= points.length - 1) setPlaybackIndex(0);
              setIsPlaying((current) => !current);
            }}
            disabled={points.length < 2}
          >
            {isPlaying ? 'Pause' : (playbackIndex >= points.length - 1 ? 'Replay' : 'Play')}
          </button>
          <button
            type="button"
            className="plot-tool-btn"
            onClick={() => {
              setIsPlaying(false);
              setPlaybackIndex(points.length > 0 ? points.length - 1 : 0);
            }}
            disabled={points.length < 2}
          >
            Show Full Lap
          </button>
          <button
            type="button"
            className="plot-tool-btn"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          </button>
          <select
            className="plot-overlay-select gps-layout-select"
            value={mapLayout}
            onChange={(event) => {
              setMapLayout(event.target.value);
              window.setTimeout(() => mapRef.current?.resize(), 80);
            }}
          >
            <option value="track">Track Focus</option>
            <option value="balanced">Balanced</option>
            <option value="data">Data Focus</option>
          </select>
        </div>
      </div>

      {selectedSignalIds.length ? (
        <div className="gps-playback-trace-bar">
          <div className="plot-overlay-chips">
            {signalDefs.map((signalDef) => (
              <button
                key={signalDef.id}
                type="button"
                className="plot-overlay-chip"
                onClick={() => removeSignalOverlay(signalDef.id)}
              >
                Remove {signalDef.name}
              </button>
            ))}
          </div>
          <div className="plot-color-grid">
            {signalDefs.map((signalDef) => (
              <label key={signalDef.id} className="plot-color-chip">
                <input
                  type="color"
                  value={traceColors[signalDef.id] || signalDef.color}
                  onChange={(event) => setTraceColors((current) => ({
                    ...current,
                    [signalDef.id]: event.target.value,
                  }))}
                />
                <span>{signalDef.name}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="gps-playback-grid">
        <div className="gps-playback-map-card">
          <div ref={mapNodeRef} className="gps-playback-map" />
          <div className="gps-playback-map-overlay">
            <span>{currentPoint ? formatPlaybackTimestamp(currentPoint.timestamp) : '--'}</span>
            <strong>{currentPoint ? rtkStatusLabel(currentPoint.fixQuality, currentPoint.rtkState) : 'NO GPS'}</strong>
          </div>
          {!basemapHealthy ? (
            <div className="gps-playback-map-status gps-playback-map-status-warning">
              Track-only fallback
            </div>
          ) : null}
          {!mapHealthy ? (
            <div className="gps-playback-map-status gps-playback-map-status-soft">
              Rendering map
            </div>
          ) : null}
        </div>

        <div className="gps-playback-side">
          <div className="gps-playback-rtk-panel">
            <div className="gps-playback-stat"><span>Playback</span><strong>{formatPlaybackSeconds(currentDuration)}</strong></div>
            <div className="gps-playback-stat"><span>Total</span><strong>{formatPlaybackSeconds(totalDuration)}</strong></div>
            <div className="gps-playback-stat"><span>Fix</span><strong>{currentPoint ? rtkStatusLabel(currentPoint.fixQuality, currentPoint.rtkState) : '--'}</strong></div>
            <div className="gps-playback-stat"><span>Satellites</span><strong>{currentPoint?.sats ?? '--'}</strong></div>
            <div className="gps-playback-stat"><span>HDOP</span><strong>{currentPoint?.hdop != null ? currentPoint.hdop.toFixed(2) : '--'}</strong></div>
            <div className="gps-playback-stat"><span>Heading Acc</span><strong>{currentPoint?.headingAccuracy != null ? `${currentPoint.headingAccuracy.toFixed(2)} deg` : '--'}</strong></div>
            <div className="gps-playback-stat"><span>Baseline</span><strong>{currentPoint?.baseline != null ? `${currentPoint.baseline.toFixed(3)} m` : '--'}</strong></div>
            <div className="gps-playback-stat"><span>Heading Src</span><strong>{currentPoint?.headingSource || '--'}</strong></div>
            <div className="gps-playback-stat gps-playback-stat-wide"><span>Coordinates</span><strong>{currentPoint ? `${currentPoint.lat.toFixed(6)}, ${currentPoint.lon.toFixed(6)}` : '--'}</strong></div>
          </div>

          <div className="gps-playback-side-plot">
            <div className="gps-playback-side-header">
              <h4>Linked Signal Playback</h4>
              <span>{signalDefs.length} trace{signalDefs.length === 1 ? '' : 's'} synced to map replay</span>
            </div>
            <svg viewBox="0 0 560 220" className="gps-playback-side-svg">
              <line x1="28" y1="188" x2="532" y2="188" stroke="rgba(255,255,255,0.16)" strokeWidth="1.4" />
              <line x1="28" y1="24" x2="28" y2="188" stroke="rgba(255,255,255,0.16)" strokeWidth="1.4" />
              {signalDefs.map((signalDef) => {
                const series = signalSeriesMap[signalDef.id] || [];
                const color = traceColors[signalDef.id] || signalDef.color;
                return (
                  <path
                    key={signalDef.id}
                    d={buildReplaySignalPath(series, yMin, yMax)}
                    fill="none"
                    stroke={color}
                    strokeWidth={signalDef.id === selectedSignalId ? 3.2 : 2.2}
                    strokeLinecap="round"
                    strokeOpacity={signalDef.id === selectedSignalId ? 1 : 0.78}
                  />
                );
              })}
              {currentPoint ? (
                <>
                  {signalDefs.map((signalDef) => {
                    const series = signalSeriesMap[signalDef.id] || [];
                    if (!series.length) return null;
                    const nearest = series.reduce((best, point) => (
                      Math.abs(point.timestamp - currentPoint.timestamp) < Math.abs(best.timestamp - currentPoint.timestamp) ? point : best
                    ), series[0]);
                    const idx = series.indexOf(nearest);
                    const x = 28 + (idx / Math.max(series.length - 1, 1)) * 500;
                    const normalized = yMax === yMin ? 0.5 : (nearest.value - yMin) / (yMax - yMin);
                    const y = 188 - (normalized * 156);
                    return (
                      <circle
                        key={`${signalDef.id}-cursor`}
                        cx={x}
                        cy={y}
                        r={signalDef.id === selectedSignalId ? 5.2 : 4.2}
                        fill={traceColors[signalDef.id] || signalDef.color}
                        stroke="#ffffff"
                        strokeOpacity="0.72"
                        strokeWidth="1"
                      />
                    );
                  })}
                  <line x1={28 + ((clampPlayback(playbackIndex, 0, Math.max(points.length - 1, 0)) / Math.max(points.length - 1, 1)) * 500)} y1="24" x2={28 + ((clampPlayback(playbackIndex, 0, Math.max(points.length - 1, 0)) / Math.max(points.length - 1, 1)) * 500)} y2="188" stroke="rgba(0,229,255,0.38)" strokeDasharray="4 4" />
                </>
              ) : null}
            </svg>
            <div className="gps-playback-side-values">
              {signalDefs.map((signalDef) => {
                const value = currentPoint?.signalValues?.[signalDef.id];
                return (
                  <div key={signalDef.id} className="gps-playback-trace-value">
                    <span
                      className="gps-playback-trace-dot"
                      style={{ background: traceColors[signalDef.id] || signalDef.color }}
                    />
                    <strong>{signalDef.name}</strong>
                    <span>{typeof value === 'number' ? `${formatSignalValue(signalDef, value)} ${signalDef.unit}` : '--'}</span>
                  </div>
                );
              })}
            </div>
            <div className="gps-playback-side-caption">
              <span>Map clicks snap the replay head and this graph together.</span>
              <span>Track points are color-coded by COG G magnitude.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="gg-slider-row gps-playback-slider-row">
        <input
          className="gg-slider"
          type="range"
          min="0"
          max={Math.max(points.length - 1, 0)}
          value={clampPlayback(playbackIndex, 0, Math.max(points.length - 1, 0))}
          onChange={(event) => {
            setIsPlaying(false);
            setPlaybackIndex(Number(event.target.value));
          }}
        />
        <div className="gg-slider-caption">
          <span>Scrub the replay head to move both the map and side graph together.</span>
          <span>Choose any logged signal to compare against position over time.</span>
        </div>
      </div>
    </section>
  );
}
