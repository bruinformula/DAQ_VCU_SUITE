import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function MapViewer() {
  const mapContainer = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    if (map.current) return; // initialize map only once
    
    // In the real deployment, this would point to the local FastAPI server
    // hosting the .mbtiles or static vector pbf files.
    // For local development, we use a default style.
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [-118.445, 34.068], // UCLA / Bruin Racing default center
      zoom: 14
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    
    // Car marker
    const markerEl = document.createElement('div');
    markerEl.className = 'car-marker';
    markerEl.style.backgroundColor = '#00e5ff';
    markerEl.style.width = '12px';
    markerEl.style.height = '12px';
    markerEl.style.borderRadius = '50%';
    markerEl.style.boxShadow = '0 0 10px #00e5ff';

    new maplibregl.Marker({ element: markerEl })
      .setLngLat([-118.445, 34.068])
      .addTo(map.current);

    return () => {
      map.current.remove();
      map.current = null;
    };
  }, []);

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
