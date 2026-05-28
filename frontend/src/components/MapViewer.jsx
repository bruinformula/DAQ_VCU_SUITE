import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function MapViewer({ telemetryRef, isConnected }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);

  useEffect(() => {
    if (map.current) return; // initialize map only once
    
    // In the real deployment, this would point to the local FastAPI server
    // hosting the .mbtiles or static vector pbf files.
    // For local development, we use a default style.
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [-118.445, 34.068], // UCLA / Bruin Racing default center
      zoom: 16
    });

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    
    // Car marker
    const markerEl = document.createElement('div');
    markerEl.className = 'car-marker';
    markerEl.style.backgroundColor = '#00e5ff';
    markerEl.style.width = '14px';
    markerEl.style.height = '14px';
    markerEl.style.borderRadius = '50%';
    markerEl.style.border = '2px solid #fff';
    markerEl.style.boxShadow = '0 0 12px #00e5ff';
    markerEl.style.transition = 'transform 0.1s linear';

    marker.current = new maplibregl.Marker({ element: markerEl, rotationAlignment: 'map' })
      .setLngLat([-118.445, 34.068])
      .addTo(map.current);

    map.current.on('load', () => {
      // Add breadcrumb trail source
      map.current.addSource('trail', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      });

      map.current.addLayer({
        id: 'trail-line',
        type: 'line',
        source: 'trail',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#ff2a4d',
          'line-width': 4,
          'line-opacity': 0.8
        }
      });
    });

    return () => {
      map.current.remove();
      map.current = null;
    };
  }, []);

  // Update map in a high-speed loop bypassing React
  useEffect(() => {
    let animationFrame;
    let trailCoords = [];
    let lastTs = 0;

    const updateMap = () => {
      if (isConnected && telemetryRef.current && map.current && marker.current) {
        const data = telemetryRef.current;
        if (data.ts > lastTs && data.gps && data.gps.lat !== 0) {
          lastTs = data.ts;
          const lngLat = [data.gps.lon, data.gps.lat];
          
          marker.current.setLngLat(lngLat);
          marker.current.setRotation(data.gps.hdg || 0);

          // Build breadcrumb trail (store up to 1000 points)
          trailCoords.push(lngLat);
          if (trailCoords.length > 1000) trailCoords.shift();

          const trailSource = map.current.getSource('trail');
          if (trailSource) {
            trailSource.setData({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: trailCoords
              }
            });
          }
          
          // Optionally auto-center map
          // map.current.easeTo({ center: lngLat, duration: 200, padding: 50 });
        }
      }
      animationFrame = requestAnimationFrame(updateMap);
    };

    animationFrame = requestAnimationFrame(updateMap);
    return () => cancelAnimationFrame(animationFrame);
  }, [isConnected, telemetryRef]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div 
        ref={mapContainer} 
        style={{ position: 'absolute', inset: 0, borderRadius: '0 0 12px 0', overflow: 'hidden' }} 
      />
      {/* Title overlay */}
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        background: 'rgba(20, 20, 23, 0.8)',
        padding: '8px 16px',
        borderRadius: '8px',
        color: '#fff',
        fontFamily: 'monospace',
        zIndex: 1,
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        LIVE GPS TRACKING
      </div>
    </div>
  );
}
