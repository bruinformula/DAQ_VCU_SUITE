import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Compass, Zap } from 'lucide-react';

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

export default function TrackMap({ data, hoveredIndex, setHoveredIndex }) {
  const [metric, setMetric] = useState('gps.vel'); // default to velocity
  const [hoverTooltip, setHoverTooltip] = useState(null);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  // Filter valid GPS points
  const gpsPoints = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.filter(row => {
      const lat = parseFloat(row['gps.lat']);
      const lon = parseFloat(row['gps.lon']);
      return !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;
    }).map((row, idx, arr) => ({
      ...row,
      originalIndex: data.indexOf(row) // capture true original index for synchronization
    }));
  }, [data]);

  // Compute metric range
  const metricRange = useMemo(() => {
    if (gpsPoints.length === 0) return { min: 0, max: 1 };
    const values = gpsPoints.map(p => parseFloat(p[metric]) || 0);
    return {
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }, [gpsPoints, metric]);

  // Use refs to bypass stale closures in asynchronous load and timeout events
  const gpsPointsRef = useRef(gpsPoints);
  const metricRef = useRef(metric);
  const metricRangeRef = useRef(metricRange);
  const dataRef = useRef(data);

  useEffect(() => {
    gpsPointsRef.current = gpsPoints;
  }, [gpsPoints]);

  useEffect(() => {
    metricRef.current = metric;
  }, [metric]);

  useEffect(() => {
    metricRangeRef.current = metricRange;
  }, [metricRange]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Update GeoJSON features (lines + start/end points) when data or metric changes
  const triggerSourceUpdate = useCallback(() => {
    const mapInstance = mapRef.current;
    if (!mapInstance || !mapInstance.isStyleLoaded()) return;

    const points = gpsPointsRef.current;
    const activeMetric = metricRef.current;
    const range = metricRangeRef.current;

    // 1. Update GPS Route (Multi-segment LineStrings to allow segment coloring)
    const routeSource = mapInstance.getSource('gps-route');
    if (routeSource && points.length > 1) {
      const features = [];
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [parseFloat(p1['gps.lon']), parseFloat(p1['gps.lat'])],
              [parseFloat(p2['gps.lon']), parseFloat(p2['gps.lat'])]
            ]
          },
          properties: {
            value: parseFloat(p1[activeMetric]) || 0,
            originalIndex: p1.originalIndex
          }
        });
      }

      routeSource.setData({
        type: 'FeatureCollection',
        features
      });

      // Update line color paint properties dynamically based on range
      let { min, max } = range;
      // Guard against min === max to prevent MapLibre interpolation crashes
      if (min === max) {
        min = min - 1;
        max = max + 1;
      }
      const half = (min + max) / 2;

      mapInstance.setPaintProperty('gps-line', 'line-color', [
        'interpolate',
        ['linear'],
        ['get', 'value'],
        min, '#3b82f6', // blue (cool/slow)
        half, '#eab308', // yellow (mid)
        max, '#ef4444'  // red (hot/fast)
      ]);
    }

    // 2. Update Start & Finish points
    const startEndSource = mapInstance.getSource('start-end-points');
    if (startEndSource && points.length > 0) {
      const startPt = points[0];
      const endPt = points[points.length - 1];

      startEndSource.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [parseFloat(startPt['gps.lon']), parseFloat(startPt['gps.lat'])]
            },
            properties: {
              label: 'START',
              color: '#10b981' // green
            }
          },
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [parseFloat(endPt['gps.lon']), parseFloat(endPt['gps.lat'])]
            },
            properties: {
              label: 'FINISH',
              color: '#ef4444' // red
            }
          }
        ]
      });
    }
  }, []); // Empty dependencies array ensures function reference never changes

  // Initialize MapLibre Map when GPS data becomes available
  useEffect(() => {
    if (gpsPoints.length === 0 || !mapContainerRef.current || mapRef.current) return;

    const defaultCenter = [parseFloat(gpsPoints[0]['gps.lon']), parseFloat(gpsPoints[0]['gps.lat'])];

    const mapInstance = new maplibregl.Map({
      container: mapContainerRef.current,
      style: SATELLITE_STYLE,
      center: defaultCenter,
      zoom: 17,
      maxZoom: 18.5,
      pitch: 0,
      attributionControl: false
    });

    mapRef.current = mapInstance;

    // Controls
    mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    const setupMapLayers = () => {
      // Route line source
      if (!mapInstance.getSource('gps-route')) {
        mapInstance.addSource('gps-route', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        mapInstance.addLayer({
          id: 'gps-line',
          type: 'line',
          source: 'gps-route',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-width': 6,
            'line-opacity': 0.95
          }
        });
      }

      // Hovered point source
      if (!mapInstance.getSource('hovered-pos')) {
        mapInstance.addSource('hovered-pos', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        mapInstance.addLayer({
          id: 'hover-halo',
          type: 'circle',
          source: 'hovered-pos',
          paint: {
            'circle-radius': 12,
            'circle-color': 'rgba(255, 255, 255, 0.35)',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff'
          }
        });

        mapInstance.addLayer({
          id: 'hover-center',
          type: 'circle',
          source: 'hovered-pos',
          paint: {
            'circle-radius': 5,
            'circle-color': '#3b82f6',
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff'
          }
        });
      }

      // Start/End source
      if (!mapInstance.getSource('start-end-points')) {
        mapInstance.addSource('start-end-points', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        mapInstance.addLayer({
          id: 'start-end-circles',
          type: 'circle',
          source: 'start-end-points',
          paint: {
            'circle-radius': 7,
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff'
          }
        });

        mapInstance.addLayer({
          id: 'start-end-labels',
          type: 'symbol',
          source: 'start-end-points',
          layout: {
            'text-field': ['get', 'label'],
            'text-size': 11,
            'text-offset': [0, 1.3],
            'text-anchor': 'top'
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 2
          }
        });
      }

      // Bidirectional Time Scrubbing (Hover line to update app index)
      mapInstance.off('mousemove', 'gps-line');
      mapInstance.on('mousemove', 'gps-line', (e) => {
        if (e.features && e.features.length > 0) {
          const origIdx = e.features[0].properties.originalIndex;
          if (origIdx !== undefined) {
            setHoveredIndex(origIdx);
            const currentData = dataRef.current;
            const row = currentData && currentData[origIdx];
            if (row) {
              const speedMps = parseFloat(row['gps.vel']);
              const fl = parseFloat(row['sdu[0].brake']);
              const fr = parseFloat(row['sdu[1].brake']);
              const rl = parseFloat(row['sdu[2].brake']);
              const rr = parseFloat(row['sdu[3].brake']);
              setHoverTooltip({
                x: e.point.x,
                y: e.point.y,
                speedMph: isNaN(speedMps) ? null : speedMps * 2.23694,
                fl: isNaN(fl) ? null : fl,
                fr: isNaN(fr) ? null : fr,
                rl: isNaN(rl) ? null : rl,
                rr: isNaN(rr) ? null : rr
              });
            }
          }
        }
      });

      mapInstance.off('mouseleave', 'gps-line');
      mapInstance.on('mouseleave', 'gps-line', () => {
        setHoveredIndex(null);
        setHoverTooltip(null);
      });

      mapInstance.on('mouseenter', 'gps-line', () => {
        mapInstance.getCanvas().style.cursor = 'crosshair';
      });
      mapInstance.on('mouseleave', 'gps-line', () => {
        mapInstance.getCanvas().style.cursor = '';
      });

      // Execute source data load immediately and in multiple timeout intervals
      // to guarantee rendering is painted as soon as the style is fully ready
      triggerSourceUpdate();
      setTimeout(triggerSourceUpdate, 50);
      setTimeout(triggerSourceUpdate, 200);
      setTimeout(triggerSourceUpdate, 600);
    };

    // Safe load verification
    if (mapInstance.isStyleLoaded()) {
      setupMapLayers();
    } else {
      mapInstance.on('load', setupMapLayers);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [gpsPoints.length > 0, triggerSourceUpdate]);

  // Fit bounds when the GPS route changes (e.g. file switched)
  useEffect(() => {
    const mapInstance = mapRef.current;
    if (!mapInstance || gpsPoints.length === 0) return;

    const lats = gpsPoints.map(p => parseFloat(p['gps.lat']));
    const lons = gpsPoints.map(p => parseFloat(p['gps.lon']));
    const bounds = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)]
    ];

    const fit = () => {
      mapInstance.fitBounds(bounds, { padding: 40, duration: 1200, maxZoom: 18.5 });
    };

    if (mapInstance.isStyleLoaded()) {
      fit();
    } else {
      mapInstance.once('load', fit);
    }
  }, [gpsPoints]);

  // Trigger data updates when selected metric or log data switches
  useEffect(() => {
    triggerSourceUpdate();
  }, [metric, gpsPoints, triggerSourceUpdate]);

  // Sync hovered crosshair on map when scrubbing charts
  useEffect(() => {
    const mapInstance = mapRef.current;
    if (!mapInstance || !mapInstance.getSource('hovered-pos')) return;

    if (hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < data.length) {
      const row = data[hoveredIndex];
      const lat = parseFloat(row['gps.lat']);
      const lon = parseFloat(row['gps.lon']);

      if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
        mapInstance.getSource('hovered-pos').setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [lon, lat]
              }
            }
          ]
        });
        return;
      }
    }

    // Reset hover indicator
    mapInstance.getSource('hovered-pos').setData({
      type: 'FeatureCollection',
      features: []
    });
  }, [hoveredIndex, data]);

  const formatMetricVal = (val) => {
    if (metric === 'gps.vel') return `${(val * 2.23694).toFixed(1)} mph`;
    return `${val.toFixed(1)} °C`;
  };

  if (gpsPoints.length === 0) {
    return (
      <div className="glass-panel text-center py-12 animated-fade-in">
        <Compass className="mx-auto mb-4 text-slate-400" size={48} />
        <h3 className="text-xl font-semibold mb-2">No GPS Data Found</h3>
        <p className="text-slate-400">The active log does not contain valid gps.lat and gps.lon channels required to render the map.</p>
      </div>
    );
  }

  return (
    <div className="glass-panel animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 className="section-title" style={{ marginBottom: '0.5rem' }}>Global Satellite Track Map</h2>
        <p className="text-slate-400" style={{ fontSize: '0.875rem' }}>
          Interactive Esri World Imagery satellite map. Hover over the track line or the charts to track performance on-course.
        </p>
      </div>

      <div className="track-map-container">
        {/* Render MapLibre Container */}
        <div style={{ position: 'relative', height: '500px', width: '100%' }}>
          <div
            ref={mapContainerRef}
            className="track-canvas-wrapper"
            style={{ height: '500px', width: '100%', borderRadius: '8px', overflow: 'hidden' }}
          />
          {hoverTooltip && (
            <div
              style={{
                position: 'absolute',
                left: Math.min(hoverTooltip.x + 14, 9999),
                top: Math.max(hoverTooltip.y - 12, 0),
                transform: 'translateY(-100%)',
                pointerEvents: 'none',
                background: 'rgba(15, 23, 42, 0.95)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '6px',
                padding: '0.5rem 0.65rem',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                lineHeight: 1.45,
                whiteSpace: 'nowrap',
                boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
                zIndex: 5
              }}
            >
              <div style={{ color: '#60a5fa', fontWeight: 600, marginBottom: '0.2rem' }}>
                Speed: {hoverTooltip.speedMph != null ? `${hoverTooltip.speedMph.toFixed(1)} mph` : '—'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: '0.65rem', rowGap: '0.1rem' }}>
                <span style={{ color: '#f97316' }}>FL brake:</span>
                <span>{hoverTooltip.fl != null ? `${hoverTooltip.fl.toFixed(1)} °C` : '—'}</span>
                <span style={{ color: '#06b6d4' }}>FR brake:</span>
                <span>{hoverTooltip.fr != null ? `${hoverTooltip.fr.toFixed(1)} °C` : '—'}</span>
                <span style={{ color: '#10b981' }}>RL brake:</span>
                <span>{hoverTooltip.rl != null ? `${hoverTooltip.rl.toFixed(1)} °C` : '—'}</span>
                <span style={{ color: '#8b5cf6' }}>RR brake:</span>
                <span>{hoverTooltip.rr != null ? `${hoverTooltip.rr.toFixed(1)} °C` : '—'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Control side panel */}
        <div className="track-controls">
          <div>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Color Heatmap Channel
            </h4>
            <div className="radio-group">
              <label className={`radio-option ${metric === 'gps.vel' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="metric"
                  checked={metric === 'gps.vel'}
                  onChange={() => setMetric('gps.vel')}
                  style={{ display: 'none' }}
                />
                <Zap size={16} className="text-blue-400" />
                <span>GPS Speed (mph)</span>
              </label>

              <label className={`radio-option ${metric === 'sdu[0].brake' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="metric"
                  checked={metric === 'sdu[0].brake'}
                  onChange={() => setMetric('sdu[0].brake')}
                  style={{ display: 'none' }}
                />
                <Compass size={16} className="text-orange-400" />
                <span>FL Brake Temp (°C)</span>
              </label>

              <label className={`radio-option ${metric === 'sdu[1].brake' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="metric"
                  checked={metric === 'sdu[1].brake'}
                  onChange={() => setMetric('sdu[1].brake')}
                  style={{ display: 'none' }}
                />
                <Compass size={16} className="text-cyan-400" />
                <span>FR Brake Temp (°C)</span>
              </label>

              <label className={`radio-option ${metric === 'sdu[2].brake' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="metric"
                  checked={metric === 'sdu[2].brake'}
                  onChange={() => setMetric('sdu[2].brake')}
                  style={{ display: 'none' }}
                />
                <Compass size={16} className="text-emerald-400" />
                <span>RL Brake Temp (°C)</span>
              </label>

              <label className={`radio-option ${metric === 'sdu[3].brake' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="metric"
                  checked={metric === 'sdu[3].brake'}
                  onChange={() => setMetric('sdu[3].brake')}
                  style={{ display: 'none' }}
                />
                <Compass size={16} className="text-purple-400" />
                <span>RR Brake Temp (°C)</span>
              </label>
            </div>
          </div>

          {/* Color Scale Legend */}
          <div style={{ marginTop: 'auto', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <h5 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Gradient Scale
            </h5>
            <div style={{ height: '12px', borderRadius: '4px', background: 'linear-gradient(to right, #3b82f6, #eab308, #ef4444)', width: '100%', marginBottom: '0.5rem' }}></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
              <span>Min: {formatMetricVal(metricRange.min)}</span>
              <span>Max: {formatMetricVal(metricRange.max)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
