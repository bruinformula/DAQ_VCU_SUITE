import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { formatSignalValue, getSignalDefinition } from '../utils/signals';
import {
  clampPlayback,
  findClosestIndexByTimestamp,
  formatPlaybackSeconds,
  formatPlaybackTimestamp,
  gMagnitude,
  gToColor,
  normalizeSampleTimestamps,
} from '../utils/logPlaybackUtils';

const SATELLITE_STYLE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      maxzoom: 19
    }
  },
  layers: [
    {
      id: 'satellite-tiles',
      type: 'raster',
      source: 'satellite',
      minzoom: 0,
      maxzoom: 19
    }
  ]
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
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
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
  const lastFittedRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedSignalId, setSelectedSignalId] = useState('sdu[0].shock');
  const [selectedSignalIds, setSelectedSignalIds] = useState(['sdu[0].shock']);
  const [traceColors, setTraceColors] = useState({});
  const [mapLayout, setMapLayout] = useState('balanced');
  const [mapHealthy, setMapHealthy] = useState(false);

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
      const lat = parseFloat(sample['gps.lat']);
      const lon = parseFloat(sample['gps.lon']);
      if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) {
        return null;
      }
      return {
        index,
        timestamp: timestamps[index] ?? 0,
        lat,
        lon,
        alt: parseFloat(sample['gps.alt']) || 0,
        vel: parseFloat(sample['gps.vel']) || 0,
        hdg: parseFloat(sample['gps.hdg']) || 0,
        sats: parseInt(sample['gps.sats'], 10) || 0,
        fixQuality: parseInt(sample['gps.fix_quality'], 10) || 0,
        rtkState: sample['gps.rtk_state'] || '',
        hdop: parseFloat(sample['gps.hdop']) || 99.9,
        headingAccuracy: parseFloat(sample['gps.heading_accuracy_deg']) || 0,
        baseline: parseFloat(sample['gps.baseline_m']) || 0,
        headingSource: sample['gps.heading_source'] || '',
        signalValues: Object.fromEntries(
          selectedSignalIds.map((signalId) => [signalId, parseFloat(sample[signalId])]),
        ),
        gMag: gMagnitude(sample, 'imu[0].ax', 'imu[0].ay') || gMagnitude(sample, 'imu.ax', 'imu.ay') || 0,
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
    setPlaybackIndex(0);
    setIsPlaying(false);
  }, [samples]);

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
      style: SATELLITE_STYLE,
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
    markerEl.style.width = '16px';
    markerEl.style.height = '16px';
    markerEl.style.borderRadius = '50%';
    markerEl.style.background = '#00f0ff';
    markerEl.style.border = '2px solid #ffffff';
    markerEl.style.boxShadow = '0 0 10px #00f0ff';

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
          'line-color': 'rgba(0, 240, 255, 0.15)',
          'line-width': 1.1,
          'line-opacity': 0.8,
        },
      });
      map.addLayer({
        id: 'gps-playback-line-glow',
        type: 'line',
        source: 'gps-playback-line',
        paint: {
          'line-color': 'rgba(0, 240, 255, 0.25)',
          'line-width': 10,
          'line-blur': 1.5,
          'line-opacity': 0.7,
        },
      });
      map.addLayer({
        id: 'gps-playback-line-core',
        type: 'line',
        source: 'gps-playback-line',
        paint: {
          'line-color': '#f8fafc',
          'line-width': 3.5,
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'gps-playback-track-points',
        type: 'circle',
        source: 'gps-playback-track',
        paint: {
          'circle-radius': 4.5,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.95,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.8)',
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

    map.on('idle', () => {
      if (map.isStyleLoaded()) {
        setMapHealthy(true);
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

  // Fit bounds ONLY when a new track/run is loaded (i.e. start point changes)
  // to prevent jittering during active playback or live streaming.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !points.length) return;

    const startPoint = points[0];
    const trackId = `${startPoint.lat},${startPoint.lon},${startPoint.timestamp}`;

    if (lastFittedRef.current !== trackId) {
      const bounds = points.reduce(
        (acc, point) => acc.extend([point.lon, point.lat]),
        new maplibregl.LngLatBounds(
          [points[0].lon, points[0].lat],
          [points[0].lon, points[0].lat],
        ),
      );
      
      const fit = () => {
        map.fitBounds(bounds, { padding: 60, duration: 1000, maxZoom: 17 });
      };

      if (map.isStyleLoaded()) {
        fit();
      } else {
        map.once('load', fit);
      }
      lastFittedRef.current = trackId;
    }
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

  if (points.length === 0) {
    return (
      <div className="glass-panel text-center py-12 animated-fade-in">
        <h3 className="text-xl font-semibold mb-2">No GPS Track Coordinates Found</h3>
        <p className="text-slate-400">The current run file does not contain valid gps.lat and gps.lon channels.</p>
      </div>
    );
  }

  return (
    <section
      ref={shellRef}
      className="glass-panel animated-fade-in"
      style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: '0.25rem' }}>GPS Replay Studio</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem' }}>
            Interactive path playback comparing G-forces, RTK positional quality indicators, and custom telemetry overlays in sync.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="select-input" value={selectedSignalId} onChange={(event) => setSelectedSignalId(event.target.value)} style={{ padding: '0.25rem 2rem 0.25rem 0.75rem', fontSize: '0.8rem' }}>
            {signalOptions.map((signalId) => {
              const signal = getSignalDefinition(signalId);
              return <option key={signalId} value={signalId}>{signal.name}</option>;
            })}
          </select>
          <button
            type="button"
            className="button"
            onClick={addSignalOverlay}
            disabled={!selectedSignalId}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
          >
            Add Overlay
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              if (playbackIndex >= points.length - 1) setPlaybackIndex(0);
              setIsPlaying((current) => !current);
            }}
            disabled={points.length < 2}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
          >
            {isPlaying ? 'Pause' : (playbackIndex >= points.length - 1 ? 'Replay' : 'Play')}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setIsPlaying(false);
              setPlaybackIndex(points.length > 0 ? points.length - 1 : 0);
            }}
            disabled={points.length < 2}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
          >
            Full Lap
          </button>
          <button
            type="button"
            className="button"
            onClick={toggleFullscreen}
            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
          >
            {isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          </button>
          <select
            className="select-input"
            value={mapLayout}
            onChange={(event) => {
              setMapLayout(event.target.value);
              window.setTimeout(() => mapRef.current?.resize(), 80);
            }}
            style={{ padding: '0.25rem 2rem 0.25rem 0.75rem', fontSize: '0.8rem' }}
          >
            <option value="track">Track Focus</option>
            <option value="balanced">Balanced</option>
            <option value="data">Data Focus</option>
          </select>
        </div>
      </div>

      {selectedSignalIds.length ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {signalDefs.map((signalDef) => (
              <button
                key={signalDef.id}
                type="button"
                className="button"
                onClick={() => removeSignalOverlay(signalDef.id)}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.05)' }}
              >
                Remove {signalDef.name}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {signalDefs.map((signalDef) => (
              <label key={signalDef.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <input
                  type="color"
                  value={traceColors[signalDef.id] || signalDef.color}
                  onChange={(event) => setTraceColors((current) => ({
                    ...current,
                    [signalDef.id]: event.target.value,
                  }))}
                  style={{ border: 'none', background: 'transparent', width: '20px', height: '20px', cursor: 'pointer' }}
                />
                <span>{signalDef.name}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: mapLayout === 'track' ? '2.5fr 1fr' : mapLayout === 'data' ? '1fr 2.5fr' : '1.2fr 1fr', gap: '1.5rem', minHeight: '480px' }}>
        <div style={{ position: 'relative', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', minHeight: '400px' }}>
          <div ref={mapNodeRef} style={{ width: '100%', height: '100%', minHeight: '400px' }} />
          <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(15, 23, 42, 0.9)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Time Stamp</span>
            <strong style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>{currentPoint ? formatPlaybackTimestamp(currentPoint.timestamp) : '--'}</strong>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '0.25rem' }}>RTK Fix State</span>
            <strong style={{ fontSize: '0.85rem', color: '#00ff7f' }}>{currentPoint ? rtkStatusLabel(currentPoint.fixQuality, currentPoint.rtkState) : 'OFFLINE'}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Playback</span>
              <strong style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>{formatPlaybackSeconds(currentDuration)}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Duration</span>
              <strong style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>{formatPlaybackSeconds(totalDuration)}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Sats</span>
              <strong style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>{currentPoint?.sats ?? '--'}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>HDOP</span>
              <strong style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>{currentPoint?.hdop != null ? currentPoint.hdop.toFixed(2) : '--'}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Heading Acc</span>
              <strong style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>{currentPoint?.headingAccuracy != null ? `${currentPoint.headingAccuracy.toFixed(1)}°` : '--'}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.15)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Baseline</span>
              <strong style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>{currentPoint?.baseline != null ? `${currentPoint.baseline.toFixed(3)}m` : '--'}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', flex: 1 }}>
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600 }}>Linked Signal Playback</h4>
            <div style={{ position: 'relative', width: '100%', flex: 1, minHeight: '180px' }}>
              <svg viewBox="0 0 560 220" style={{ width: '100%', height: '100%', overflow: 'visible', display: 'block' }}>
                <line x1="28" y1="188" x2="532" y2="188" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2" />
                <line x1="28" y1="24" x2="28" y2="188" stroke="rgba(255,255,255,0.12)" strokeWidth="1.2" />
                {signalDefs.map((signalDef) => {
                  const series = signalSeriesMap[signalDef.id] || [];
                  const color = traceColors[signalDef.id] || signalDef.color;
                  return (
                    <path
                      key={signalDef.id}
                      d={buildReplaySignalPath(series, yMin, yMax)}
                      fill="none"
                      stroke={color}
                      strokeWidth={signalDef.id === selectedSignalId ? 3 : 1.8}
                      strokeLinecap="round"
                      strokeOpacity={signalDef.id === selectedSignalId ? 1 : 0.6}
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
                          r={signalDef.id === selectedSignalId ? 5 : 3.5}
                          fill={traceColors[signalDef.id] || signalDef.color}
                          stroke="#ffffff"
                          strokeOpacity="0.8"
                          strokeWidth="1"
                        />
                      );
                    })}
                    <line x1={28 + ((clampPlayback(playbackIndex, 0, Math.max(points.length - 1, 0)) / Math.max(points.length - 1, 1)) * 500)} y1="24" x2={28 + ((clampPlayback(playbackIndex, 0, Math.max(points.length - 1, 0)) / Math.max(points.length - 1, 1)) * 500)} y2="188" stroke="rgba(0,240,255,0.35)" strokeDasharray="3 3" />
                  </>
                ) : null}
              </svg>
            </div>
            
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {signalDefs.map((signalDef) => {
                const value = currentPoint?.signalValues?.[signalDef.id];
                return (
                  <div key={signalDef.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
                    <span
                      style={{ display: 'block', width: '8px', height: '8px', borderRadius: '50%', background: traceColors[signalDef.id] || signalDef.color }}
                    />
                    <strong style={{ color: 'var(--text-secondary)' }}>{signalDef.name}:</strong>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{typeof value === 'number' ? `${formatSignalValue(signalDef, value)} ${signalDef.unit}` : '--'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
        <input
          type="range"
          min="0"
          max={Math.max(points.length - 1, 0)}
          value={clampPlayback(playbackIndex, 0, Math.max(points.length - 1, 0))}
          onChange={(event) => {
            setIsPlaying(false);
            setPlaybackIndex(Number(event.target.value));
          }}
          style={{ width: '100%', cursor: 'pointer', accentColor: 'var(--color-info)' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span>Scrub to move map indicator and side graph together</span>
          <span>Click map track points to snap replay cursor</span>
        </div>
      </div>
    </section>
  );
}
