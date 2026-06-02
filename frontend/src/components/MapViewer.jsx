import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const DEFAULT_CENTER = [-118.445, 34.068];
const DEFAULT_ZOOM = 16;
const FOLLOW_PITCH = 48;
const FOLLOW_ZOOM = 17.6;

function rtkStatusLabel(gps) {
  const state = gps?.rtk_state;
  if (!state) return 'GPS';
  switch (state) {
    case 'rtk_fixed':
      return 'RTK FIX';
    case 'rtk_float':
      return 'RTK FLOAT';
    case 'dgps':
      return 'DGPS';
    case 'gps':
      return 'GPS';
    case 'no_fix':
      return 'NO FIX';
    default:
      return String(state).replace(/_/g, ' ').toUpperCase();
  }
}

const STREET_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#0f141a',
      },
    },
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
      paint: {
        'raster-saturation': -0.15,
        'raster-contrast': 0.08,
        'raster-brightness-min': 0.08,
        'raster-brightness-max': 0.96,
      },
    },
  ],
};

function ensureTrailLayer(mapInstance) {
  if (!mapInstance.getSource('trail')) {
    mapInstance.addSource('trail', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [],
        },
      },
    });
  }

  if (!mapInstance.getLayer('trail-glow')) {
    mapInstance.addLayer({
      id: 'trail-glow',
      type: 'line',
      source: 'trail',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#00e5ff',
        'line-width': 10,
        'line-opacity': 0.18,
        'line-blur': 1.8,
      },
    });
  }

  if (!mapInstance.getLayer('trail-line')) {
    mapInstance.addLayer({
      id: 'trail-line',
      type: 'line',
      source: 'trail',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#00e5ff',
        'line-width': 4,
        'line-opacity': 0.92,
      },
    });
  }
}

export default function MapViewer({ telemetryRef, isConnected }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const resizeObserverRef = useRef(null);
  const followCarRef = useRef(true);
  const trailCoordsRef = useRef([]);
  const lastTsRef = useRef(0);
  const userMovedMapRef = useRef(false);

  const [followCar, setFollowCar] = useState(true);
  const [gpsStatus, setGpsStatus] = useState('Waiting for GPS lock');
  const [gpsReady, setGpsReady] = useState(false);
  const [mapHealthy, setMapHealthy] = useState(false);
  const gpsStatusRef = useRef('Waiting for GPS lock');
  const gpsReadyRef = useRef(false);
  const mapHealthyRef = useRef(false);

  useEffect(() => {
    followCarRef.current = followCar;
  }, [followCar]);

  useEffect(() => {
    gpsReadyRef.current = gpsReady;
  }, [gpsReady]);

  useEffect(() => {
    mapHealthyRef.current = mapHealthy;
  }, [mapHealthy]);

  useEffect(() => {
    if (map.current) return;
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: STREET_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 34,
      bearing: -12,
      antialias: true,
      attributionControl: false,
    });

    map.current = mapInstance;

    mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
    mapInstance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    const markerEl = document.createElement('div');
    markerEl.className = 'car-marker';
    markerEl.style.width = '18px';
    markerEl.style.height = '18px';
    markerEl.style.borderRadius = '999px';
    markerEl.style.background = 'radial-gradient(circle at 35% 35%, #9ef9ff 0%, #00d5ff 55%, #006d83 100%)';
    markerEl.style.border = '2px solid rgba(255,255,255,0.95)';
    markerEl.style.boxShadow = '0 0 22px rgba(0, 229, 255, 0.7)';
    markerEl.style.transition = 'transform 0.12s linear';

    marker.current = new maplibregl.Marker({ element: markerEl, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat(DEFAULT_CENTER)
      .addTo(mapInstance);

    const setMapHealth = (nextHealthy) => {
      if (mapHealthyRef.current !== nextHealthy) {
        mapHealthyRef.current = nextHealthy;
        setMapHealthy(nextHealthy);
      }
    };

    const syncMapFrame = () => {
      try {
        ensureTrailLayer(mapInstance);
        mapInstance.resize();
        setMapHealth(true);
      } catch (error) {
        console.error('Map sync error', error);
      }
    };

    mapInstance.on('load', () => {
      syncMapFrame();
    });

    mapInstance.on('styledata', () => {
      if (mapInstance.isStyleLoaded()) {
        syncMapFrame();
      }
    });

    mapInstance.on('idle', () => {
      if (mapInstance.isStyleLoaded()) {
        setMapHealth(true);
      }
    });

    mapInstance.on('render', () => {
      if (!mapHealthyRef.current && mapInstance.isStyleLoaded()) {
        setMapHealth(true);
      }
    });

    mapInstance.on('load', () => {
      ensureTrailLayer(mapInstance);
    });

    mapInstance.on('error', (event) => {
      console.error('Map render error', event?.error || event);
      setMapHealth(false);
    });

    mapInstance.on('dragstart', () => {
      userMovedMapRef.current = true;
      followCarRef.current = false;
      setFollowCar(false);
    });
    mapInstance.on('rotatestart', () => {
      userMovedMapRef.current = true;
      followCarRef.current = false;
      setFollowCar(false);
    });
    mapInstance.on('pitchstart', () => {
      userMovedMapRef.current = true;
      followCarRef.current = false;
      setFollowCar(false);
    });

    const resizeMap = () => {
      try {
        mapInstance.resize();
      } catch (error) {
        console.error('Map resize error', error);
      }
    };

    resizeObserverRef.current = new ResizeObserver(() => {
      requestAnimationFrame(resizeMap);
    });
    resizeObserverRef.current.observe(mapContainer.current);
    window.addEventListener('resize', resizeMap);

    const resizeTimers = [
      window.setTimeout(resizeMap, 0),
      window.setTimeout(resizeMap, 120),
      window.setTimeout(resizeMap, 600),
    ];

    return () => {
      resizeTimers.forEach((timerId) => window.clearTimeout(timerId));
      window.removeEventListener('resize', resizeMap);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      mapInstance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    requestAnimationFrame(() => {
      try {
        map.current.resize();
      } catch (error) {
        console.error('Map layout refresh error', error);
      }
    });
  }, [gpsReady, followCar]);

  useEffect(() => {
    let animationFrame;

    const updateMap = () => {
      const mapInstance = map.current;
      const markerInstance = marker.current;
      const data = telemetryRef.current;

      if (mapInstance && markerInstance && data?.gps) {
        const hasGpsFrames = Boolean(data.gps.present) && data.gps.lat !== 0 && data.gps.lon !== 0;
        const hasGpsFix = Boolean(data.gps.valid);
        if (gpsReadyRef.current !== hasGpsFrames) {
          gpsReadyRef.current = hasGpsFrames;
          setGpsReady(hasGpsFrames);
        }
        markerInstance.getElement().style.opacity = hasGpsFrames ? '1' : '0';
        const nextGpsStatus = hasGpsFrames
          ? `${rtkStatusLabel(data.gps)} • ${data.gps.sats || 0} sats • HDOP ${(data.gps.hdop ?? 0).toFixed(2)} • ${Math.max(0, data.gps.vel || 0).toFixed(1)} m/s`
          : isConnected
            ? 'No live GPS frames'
            : 'Telemetry link down';
        if (gpsStatusRef.current !== nextGpsStatus) {
          gpsStatusRef.current = nextGpsStatus;
          setGpsStatus(nextGpsStatus);
        }

        if (isConnected && hasGpsFrames && data.ts > lastTsRef.current) {
          lastTsRef.current = data.ts;
          const lngLat = [data.gps.lon, data.gps.lat];

          if (mapInstance.isStyleLoaded() && !mapInstance.getSource('trail')) {
            ensureTrailLayer(mapInstance);
          }

          markerInstance.setLngLat(lngLat);
          markerInstance.setRotation(data.gps.hdg || 0);

          trailCoordsRef.current = [...trailCoordsRef.current.slice(-1499), lngLat];

          const trailSource = mapInstance.getSource('trail');
          if (trailSource) {
            trailSource.setData({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: trailCoordsRef.current,
              },
            });
          }

          if (followCarRef.current) {
            mapInstance.easeTo({
              center: lngLat,
              bearing: data.gps.hdg || mapInstance.getBearing(),
              pitch: FOLLOW_PITCH,
              zoom: Math.max(mapInstance.getZoom(), FOLLOW_ZOOM),
              duration: 260,
              easing: (t) => 1 - ((1 - t) * (1 - t)),
            });
          }
        }
      }

      animationFrame = requestAnimationFrame(updateMap);
    };

    animationFrame = requestAnimationFrame(updateMap);
    return () => cancelAnimationFrame(animationFrame);
  }, [isConnected, telemetryRef]);

  const handleRecenter = () => {
    const mapInstance = map.current;
    const data = telemetryRef.current;
    if (!mapInstance || !data?.gps || !data.gps.lat || !data.gps.lon) {
      return;
    }

    userMovedMapRef.current = false;
    followCarRef.current = true;
    setFollowCar(true);
    mapInstance.easeTo({
      center: [data.gps.lon, data.gps.lat],
      bearing: data.gps.hdg || 0,
      pitch: FOLLOW_PITCH,
      zoom: Math.max(mapInstance.getZoom(), FOLLOW_ZOOM),
      duration: 450,
    });
  };

  return (
    <div className="track-map-shell">
      <div ref={mapContainer} className="track-map-canvas" />

      {!gpsReady ? (
        <div className="track-map-empty-state">
          <div className="track-map-empty-card">
            <span className="track-map-empty-kicker">GPS Offline</span>
            <strong>No valid GPS position is being received right now.</strong>
            <p>The map will snap live as soon as position and navigation frames are both present again.</p>
          </div>
        </div>
      ) : null}

      <div className="track-map-overlay track-map-title">
        <div className="track-map-kicker">Track Map</div>
        <div className="track-map-subtitle">Street basemap with tilt, rotate, breadcrumb trail, and live vehicle heading.</div>
      </div>

      <div className="track-map-overlay track-map-status">
        <div className={`track-map-pill ${isConnected ? 'is-live' : ''}`}>{isConnected ? 'LIVE LINK' : 'LINK DOWN'}</div>
        <div className={`track-map-pill ${gpsReady ? 'is-soft' : 'is-warning'}`}>
          {gpsReady ? `${gpsStatus} • ${telemetryRef.current?.gps?.valid ? 'FIX OK' : 'FIX UNCONFIRMED'}` : gpsStatus}
        </div>
        {!mapHealthy ? (
          <div className="track-map-pill is-warning">Map Rendering</div>
        ) : null}
        <button className="track-map-action" onClick={handleRecenter}>
          Follow Car
        </button>
      </div>
    </div>
  );
}
