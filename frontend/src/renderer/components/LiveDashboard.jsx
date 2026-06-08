import React, { useState, useEffect, useRef } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { 
  Settings, Eye, EyeOff, Activity, Gauge, Thermometer, Zap, 
  AlertTriangle, Cpu, HelpCircle, ShieldAlert, Sliders, Check,
  GripVertical
} from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function LiveDashboard() {
  const { latestValues, connectionState, diagnostics, logStatus } = useTelemetry();
  
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const liveCoordsRef = useRef([]);
  const sessionMaxCellTempRef = useRef(0);
  const sessionMaxPowerRef = useRef(0);
  const [followVehicle, setFollowVehicle] = useState(true);
  
  // Settings Drawer & Edit Mode state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Card Visibilities (persisted to localStorage)
  const [visibilities, setVisibilities] = useState(() => {
    const saved = localStorage.getItem('telemetry:dashboard:visibility');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.liveMap === undefined) parsed.liveMap = true;
        if (parsed.boardsHealth === undefined) parsed.boardsHealth = true;
        return parsed;
      } catch (e) {}
    }
    return {
      chassis: true,
      liveMap: true,
      boardsHealth: true,
      bms: true,
      inverter: true,
      vcu: true,
      flowPressures: true,
      piStatus: true
    };
  });

  // Alert Thresholds (persisted to localStorage)
  const [thresholds, setThresholds] = useState(() => {
    const saved = localStorage.getItem('telemetry:dashboard:thresholds');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      brakeTempMax: 350,
      coolantFlowMin: 4.0,
      motorTempMax: 95,
      batterySocMin: 20,
      cellVoltageMin: 3.0
    };
  });

  // Save configurations when changed
  useEffect(() => {
    localStorage.setItem('telemetry:dashboard:visibility', JSON.stringify(visibilities));
  }, [visibilities]);

  useEffect(() => {
    localStorage.setItem('telemetry:dashboard:thresholds', JSON.stringify(thresholds));
  }, [thresholds]);

  const DEFAULT_CARD_ORDER = [
    'chassis',
    'liveMap',
    'bms',
    'inverter',
    'vcu',
    'flowPressures',
    'piStatus',
    'boardsHealth'
  ];

  const [cardOrder, setCardOrder] = useState(() => {
    const saved = localStorage.getItem('telemetry:dashboard:order');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === DEFAULT_CARD_ORDER.length) {
          const hasAll = DEFAULT_CARD_ORDER.every(card => parsed.includes(card));
          if (hasAll) return parsed;
        }
      } catch (e) {}
    }
    return DEFAULT_CARD_ORDER;
  });

  const [draggedCardId, setDraggedCardId] = useState(null);
  const [dragEnabledCard, setDragEnabledCard] = useState(null);

  useEffect(() => {
    localStorage.setItem('telemetry:dashboard:order', JSON.stringify(cardOrder));
  }, [cardOrder]);

  const handleDragStart = (e, cardId) => {
    setDraggedCardId(cardId);
    e.dataTransfer.setData('text/plain', cardId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedCardId(null);
    setDragEnabledCard(null);
  };

  const handleDragOver = (e, targetCardId) => {
    e.preventDefault();
    if (!draggedCardId || draggedCardId === targetCardId) return;

    const newOrder = [...cardOrder];
    const draggedIdx = newOrder.indexOf(draggedCardId);
    const targetIdx = newOrder.indexOf(targetCardId);
    if (draggedIdx !== -1 && targetIdx !== -1) {
      newOrder.splice(draggedIdx, 1);
      newOrder.splice(targetIdx, 0, draggedCardId);
      setCardOrder(newOrder);
    }
  };

  // Helper to format values safely
  const val = (key, decimals = 1, fallback = '--') => {
    const v = latestValues[key];
    if (v === undefined || v === null || isNaN(Number(v))) return fallback;
    return Number(v).toFixed(decimals);
  };

  const toggleVisibility = (key) => {
    setVisibilities(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleThresholdChange = (key, value) => {
    setThresholds(prev => ({ ...prev, [key]: parseFloat(value) }));
  };

  // Pre-calculations for visual widgets
  const soc = Number(latestValues['bms.soc'] || 0);
  const rpm = Number(latestValues['inv.rpm'] || 0);
  const flow1 = Number(latestValues['tshmu.flow1'] || 0);
  const flow2 = Number(latestValues['tshmu.flow2'] || 0);
  const flowAvg = (flow1 + flow2) / 2;

  // Session peak calculations
  const currentHiTemp = Number(latestValues['bms.hi_t'] || 0);
  if (currentHiTemp > sessionMaxCellTempRef.current) {
    sessionMaxCellTempRef.current = currentHiTemp;
  }
  const bmsV = Number(latestValues['bms.v'] || 0);
  const bmsI = Number(latestValues['bms.i'] || 0);
  const currentPowerKw = Math.max(0, (bmsV * bmsI) / 1000);
  if (currentPowerKw > sessionMaxPowerRef.current) {
    sessionMaxPowerRef.current = currentPowerKw;
  }

  // Latency tracker based on online boards average age
  const getAverageLatency = () => {
    if (!diagnostics || !Array.isArray(diagnostics.boards)) return null;
    const onlineBoards = diagnostics.boards.filter(b => b.lastSeenAgeMs !== null && b.lastSeenAgeMs < 2000);
    if (onlineBoards.length === 0) return null;
    const sum = onlineBoards.reduce((acc, b) => acc + b.lastSeenAgeMs, 0);
    return sum / onlineBoards.length;
  };

  const isCoolingOffline = flowAvg === 0 && (rpm > 100 || Number(latestValues['inv.idc'] || 0) > 5) && connectionState.connected;

  // IMU G-Force coordinates (Front, COG/Middle, Rear)
  const hasCogImu = latestValues['imu[0].ax'] !== undefined || latestValues['imu.ax'] !== undefined;
  const cogAx = latestValues['imu[0].ax'] !== undefined ? Number(latestValues['imu[0].ax'] || 0) : Number(latestValues['imu.ax'] || 0);
  const cogAy = latestValues['imu[0].ay'] !== undefined ? Number(latestValues['imu[0].ay'] || 0) : Number(latestValues['imu.ay'] || 0);

  const hasFrontImu = latestValues['imu[1].ax'] !== undefined;
  const frontAx = Number(latestValues['imu[1].ax'] || 0);
  const frontAy = Number(latestValues['imu[1].ay'] || 0);

  const hasRearImu = latestValues['imu[2].ax'] !== undefined;
  const rearAx = Number(latestValues['imu[2].ax'] || 0);
  const rearAy = Number(latestValues['imu[2].ay'] || 0);

  // Status Alerts
  const alerts = [];
  if (soc < thresholds.batterySocMin && connectionState.connected) {
    alerts.push(`Low State of Charge: ${soc.toFixed(1)}%`);
  }
  if (flowAvg > 0 && flowAvg < thresholds.coolantFlowMin && connectionState.connected) {
    alerts.push(`Coolant flow low: ${flowAvg.toFixed(1)} L/min`);
  }
  
  // SDU Corner checks
  const corners = ['FL', 'FR', 'RL', 'RR'];
  const sduIndices = [0, 1, 2, 3];
  
  sduIndices.forEach(idx => {
    const brake = Number(latestValues[`sdu[${idx}].brake`] || 0);
    if (brake > thresholds.brakeTempMax && connectionState.connected) {
      alerts.push(`${corners[idx]} Brake Temp Critical: ${brake.toFixed(1)}°C`);
    }
  });

  const motorTemp = Number(latestValues['inv.mot_t'] || 0);
  if (motorTemp > thresholds.motorTempMax && connectionState.connected) {
    alerts.push(`Motor Temperature High: ${motorTemp.toFixed(1)}°C`);
  }

  const lowCellV = Number(latestValues['bms.lo_cv'] || 4.2);
  if (lowCellV < thresholds.cellVoltageMin && connectionState.connected) {
    alerts.push(`Low Cell Voltage Alert: ${lowCellV.toFixed(3)} V`);
  }

  // Corner Layout Color helpers
  const getBrakeColor = (temp) => {
    if (!connectionState.connected || temp === 0) return 'var(--text-secondary)';
    if (temp > thresholds.brakeTempMax) return '#ef4444'; // Red
    if (temp > thresholds.brakeTempMax * 0.8) return '#f59e0b'; // Yellow/Amber
    return '#10b981'; // Green
  };

  const getTireColor = (sduIdx) => {
    const t0 = latestValues[`sdu[${sduIdx}].tire[0]`];
    const t1 = latestValues[`sdu[${sduIdx}].tire[1]`];
    const t2 = latestValues[`sdu[${sduIdx}].tire[2]`];
    const t3 = latestValues[`sdu[${sduIdx}].tire[3]`];
    
    if (t0 === undefined && t1 === undefined && t2 === undefined && t3 === undefined) {
      return 'rgba(255, 255, 255, 0.08)';
    }
    
    const avg = (Number(t0 || 0) + Number(t1 || 0) + Number(t2 || 0) + Number(t3 || 0)) / 4;
    if (avg === 0) return 'rgba(255, 255, 255, 0.08)';
    
    const hue = Math.max(0, 220 - Math.min(180, avg * 2));
    return `hsl(${hue}, 85%, 50%)`;
  };

  // Satellite imagery style
  const SATELLITE_STYLE = {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: 'Tiles &copy; Esri',
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

  useEffect(() => {
    if (!visibilities.liveMap || !mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: SATELLITE_STYLE,
      center: [-118.445, 34.068],
      zoom: 16,
      pitch: 30,
      attributionControl: false
    });
    mapRef.current = map;

    // Custom marker element
    const markerEl = document.createElement('div');
    markerEl.style.width = '12px';
    markerEl.style.height = '12px';
    markerEl.style.borderRadius = '50%';
    markerEl.style.background = '#00f0ff';
    markerEl.style.border = '2px solid #ffffff';
    markerEl.style.boxShadow = '0 0 8px #00f0ff';

    markerRef.current = new maplibregl.Marker({ element: markerEl })
      .setLngLat([-118.445, 34.068])
      .addTo(map);

    map.on('load', () => {
      // Add source for live path trail
      map.addSource('live-trail', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [] },
          properties: {}
        }
      });

      // Add line layer for the trail
      map.addLayer({
        id: 'live-trail-line',
        type: 'line',
        source: 'live-trail',
        paint: {
          'line-color': '#00f0ff',
          'line-width': 3.5,
          'line-opacity': 0.8
        }
      });
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
    };
  }, [visibilities.liveMap]);

  const lat = parseFloat(latestValues['gps.lat']);
  const lon = parseFloat(latestValues['gps.lon']);
  const hdg = parseFloat(latestValues['gps.hdg']) || 0;

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) return;

    // Position marker
    marker.setLngLat([lon, lat]);

    // Append to live coords ref if it's different from the last point
    const coords = liveCoordsRef.current;
    const lastPoint = coords[coords.length - 1];
    if (!lastPoint || Math.abs(lastPoint[0] - lon) > 0.000001 || Math.abs(lastPoint[1] - lat) > 0.000001) {
      coords.push([lon, lat]);
      // Limit trail to last 800 points for performance
      if (coords.length > 800) {
        coords.shift();
      }

      // Update trail data
      if (map.isStyleLoaded()) {
        const source = map.getSource('live-trail');
        if (source) {
          source.setData({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: {}
          });
        }
      }
    }

    // Centering Map to follow vehicle
    if (followVehicle) {
      map.easeTo({
        center: [lon, lat],
        bearing: hdg || map.getBearing(),
        duration: 150
      });
    }
  }, [lat, lon, hdg, followVehicle]);

  const recenterMap = () => {
    const map = mapRef.current;
    if (!map || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) return;
    setFollowVehicle(true);
    map.easeTo({
      center: [lon, lat],
      zoom: 17,
      duration: 500
    });
  };

  const getRtkStatus = () => {
    const state = latestValues['gps.rtk_state'];
    if (state) return String(state).replace(/_/g, ' ').toUpperCase();
    const quality = Number(latestValues['gps.fix_quality']);
    return {
      0: 'NO FIX',
      1: 'GPS',
      2: 'DGPS',
      4: 'RTK FIX',
      5: 'RTK FLOAT',
    }[quality] || `Q${quality ?? '--'}`;
  };
  const EXPECTED_BOARDS = [
    { key: '2-0', name: 'SDU FL', type: 2, id: 0 },
    { key: '2-1', name: 'SDU FR', type: 2, id: 1 },
    { key: '2-2', name: 'SDU RL', type: 2, id: 2 },
    { key: '2-3', name: 'SDU RR', type: 2, id: 3 },
    { key: '4-0', name: 'TSHMU Flow', type: 4, id: 0 },
    { key: '6-0', name: 'TSPMU FL', type: 6, id: 0 },
    { key: '6-1', name: 'TSPMU FR', type: 6, id: 1 },
    { key: '7-0', name: 'GPS / SMU', type: 7, id: 0 }
  ];

  const getBoardStatus = (expected) => {
    if (!diagnostics || !Array.isArray(diagnostics.boards)) {
      return { state: 'offline', msg: 'OFFLINE', count: 0, rate: 0, drops: 0 };
    }
    
    const board = diagnostics.boards.find(
      b => b.boardType === expected.type && b.boardId === expected.id
    );
    
    if (!board) {
      return { state: 'offline', msg: 'OFFLINE', count: 0, rate: 0, drops: 0 };
    }
    
    const isOnline = board.lastSeenAgeMs !== null && board.lastSeenAgeMs < 2000;
    if (!isOnline) {
      return { state: 'offline', msg: 'STALE', count: board.fastCount + board.slowCount, rate: 0, drops: board.counterMismatchCount };
    }
    
    if (board.counterMismatch) {
      return { 
        state: 'degraded', 
        msg: 'DROPS DETECTED', 
        count: board.fastCount + board.slowCount, 
        rate: board.fast?.rateHz || 0,
        drops: board.counterMismatchCount
      };
    }
    
    return {
      state: 'online',
      msg: 'ONLINE',
      count: board.fastCount + board.slowCount,
      rate: board.fast?.rateHz || 0,
      drops: board.counterMismatchCount
    };
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', height: '100%', position: 'relative' }}>
      
      {/* Top Warning Banner if any active alerts */}
      {alerts.length > 0 && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid var(--color-danger)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          color: '#fca5a5',
          fontSize: '0.85rem',
          boxShadow: '0 0 15px rgba(239, 68, 68, 0.1)',
          animation: 'pulse 2s infinite'
        }}>
          <ShieldAlert size={18} className="text-red-500 animate-bounce" />
          <div style={{ flex: 1 }}>
            <strong>CRITICAL TELEMETRY ALERT:</strong> {alerts.join(' | ')}
          </div>
        </div>
      )}

      {/* Grid Dashboard */}
      <div className="live-dashboard-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: '1rem',
        overflowY: 'auto',
        paddingRight: '4px'
      }}>

        {/* 1. CHASSIS CORNERS ATLAS */}
        {visibilities.chassis && (
          <div className="glass-panel no-hover" 
            draggable={dragEnabledCard === 'chassis'}
            onDragStart={(e) => handleDragStart(e, 'chassis')}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, 'chassis')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              gridColumn: 'span 2',
              border: alerts.some(a => a.includes('Brake')) ? '1px solid var(--color-danger)' : '1px solid var(--border-color)',
              boxShadow: alerts.some(a => a.includes('Brake')) ? '0 0 20px rgba(239, 68, 68, 0.15)' : 'none',
              order: cardOrder.indexOf('chassis'),
              opacity: draggedCardId === 'chassis' ? 0.4 : 1,
              transition: 'opacity 0.2s ease'
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div 
                  onMouseDown={() => setDragEnabledCard('chassis')}
                  onMouseUp={() => setDragEnabledCard(null)}
                  style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0.1rem', color: 'var(--text-secondary)', opacity: 0.6 }}
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
                <Gauge size={16} className="text-cyan-400" style={{ marginLeft: '0.25rem' }} />
                <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chassis Atlas</h3>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SDU & Corner Data</span>
            </div>

            {/* Corner Columns around vehicle silhouette */}
            <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr 250px', gap: '1rem', alignItems: 'center' }}>
              
              {/* Left Corners: FL, RL */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* FL */}
                <div style={{ borderLeft: '3px solid var(--color-fl)', paddingLeft: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: '#ffedd5' }}>
                    <span>FRONT LEFT</span>
                    <span style={{ color: getBrakeColor(Number(val('sdu[0].brake', 1, 0))) }}>
                      Rotor: {val('sdu[0].brake', 1)} °C
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 0.5rem', marginTop: '0.35rem', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    <span>Speed: <strong style={{ color: 'var(--text-primary)' }}>{val('sdu[0].wrpm', 0)} RPM</strong></span>
                    <span>Shock: <strong style={{ color: 'var(--text-primary)' }}>{val('sdu[0].shock', 1)} mm</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                    <span>Tire Surface</span>
                  </div>
                  {/* Tire Temps Heatmap */}
                  <div style={{ display: 'flex', gap: '2px', height: '6px', borderRadius: '3px', overflow: 'hidden', marginTop: '0.15rem' }}>
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[0].tire[3]', 0, 0)) * 2)}, 80%, 50%)` }} title="Amb" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[0].tire[1]', 0, 0)) * 2)}, 80%, 50%)` }} title="Min" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[0].tire[2]', 0, 0)) * 2)}, 80%, 50%)` }} title="Ctr" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[0].tire[0]', 0, 0)) * 2)}, 80%, 50%)` }} title="Max" />
                  </div>
                </div>

                {/* RL */}
                <div style={{ borderLeft: '3px solid var(--color-rl)', paddingLeft: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: '#dcfce7' }}>
                    <span>REAR LEFT</span>
                    <span style={{ color: getBrakeColor(Number(val('sdu[2].brake', 1, 0))) }}>
                      Rotor: {val('sdu[2].brake', 1)} °C
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 0.5rem', marginTop: '0.35rem', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    <span>Speed: <strong style={{ color: 'var(--text-primary)' }}>{val('sdu[2].wrpm', 0)} RPM</strong></span>
                    <span>Shock: <strong style={{ color: 'var(--text-primary)' }}>{val('sdu[2].shock', 1)} mm</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                    <span>Tire Surface</span>
                  </div>
                  {/* Tire Temps Heatmap */}
                  <div style={{ display: 'flex', gap: '2px', height: '6px', borderRadius: '3px', overflow: 'hidden', marginTop: '0.15rem' }}>
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[2].tire[3]', 0, 0)) * 2)}, 80%, 50%)` }} title="Amb" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[2].tire[1]', 0, 0)) * 2)}, 80%, 50%)` }} title="Min" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[2].tire[2]', 0, 0)) * 2)}, 80%, 50%)` }} title="Ctr" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[2].tire[0]', 0, 0)) * 2)}, 80%, 50%)` }} title="Max" />
                  </div>
                </div>
              </div>

              {/* Center Vehicle Silhouette + Live G-Force Meter */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <svg width="100" height="150" viewBox="0 0 100 150" style={{ position: 'absolute', pointerEvents: 'none' }}>
                  <path d="M 35 10 L 65 10 L 70 30 L 70 120 L 65 140 L 35 140 L 30 120 L 30 30 Z" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
                  <rect x="15" y="25" width="12" height="20" rx="3" fill={getTireColor(0)} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                  <rect x="73" y="25" width="12" height="20" rx="3" fill={getTireColor(1)} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                  <rect x="12" y="105" width="15" height="25" rx="3" fill={getTireColor(2)} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                  <rect x="73" y="105" width="15" height="25" rx="3" fill={getTireColor(3)} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                </svg>

                {/* G-G Bubble Meter (Vector chart) */}
                <div style={{ position: 'relative', width: '120px', height: '120px', borderRadius: '50%', border: '1px solid rgba(255, 255, 255, 0.1)', background: 'rgba(0, 0, 0, 0.2)', overflow: 'hidden' }}>
                  <svg width="120" height="120" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                    {/* Crosshairs */}
                    <line x1="10" y1="60" x2="110" y2="60" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                    <line x1="60" y1="10" x2="60" y2="110" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                    
                    {/* Concentric Reference Rings */}
                    <circle cx="60" cy="60" r="17.5" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 2" />
                    <text x="60" y="46.5" fill="rgba(255,255,255,0.2)" fontSize="6" textAnchor="middle" fontWeight="bold">0.5G</text>

                    <circle cx="60" cy="60" r="35" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 3" />
                    <text x="60" y="29" fill="rgba(255,255,255,0.25)" fontSize="6" textAnchor="middle" fontWeight="bold">1.0G</text>

                    <circle cx="60" cy="60" r="52.5" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="2 2" />
                    <text x="60" y="11.5" fill="rgba(255,255,255,0.2)" fontSize="6" textAnchor="middle" fontWeight="bold">1.5G</text>
                  </svg>
                  
                  {/* COG IMU Bubble (Cyan) */}
                  {hasCogImu && (
                    <div style={{
                      position: 'absolute',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: 'radial-gradient(circle, #00e5ff 0%, #008699 100%)',
                      boxShadow: '0 0 8px #00e5ff',
                      top: `calc(50% - 5px - ${Math.max(-45, Math.min(45, cogAx * 35))}px)`,
                      left: `calc(50% - 5px + ${Math.max(-45, Math.min(45, cogAy * 35))}px)`,
                      transition: 'all 0.08s ease-out',
                      border: '1px solid rgba(255,255,255,0.3)',
                      zIndex: 3
                    }} title="COG IMU" />
                  )}

                  {/* Front IMU Bubble (Green) */}
                  {hasFrontImu && (
                    <div style={{
                      position: 'absolute',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: 'radial-gradient(circle, #00ff7f 0%, #00994d 100%)',
                      boxShadow: '0 0 8px #00ff7f',
                      top: `calc(50% - 5px - ${Math.max(-45, Math.min(45, frontAx * 35))}px)`,
                      left: `calc(50% - 5px + ${Math.max(-45, Math.min(45, frontAy * 35))}px)`,
                      transition: 'all 0.08s ease-out',
                      border: '1px solid rgba(255,255,255,0.3)',
                      zIndex: 2
                    }} title="Front IMU" />
                  )}

                  {/* Rear IMU Bubble (Red) */}
                  {hasRearImu && (
                    <div style={{
                      position: 'absolute',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: 'radial-gradient(circle, #ff2a4d 0%, #99001a 100%)',
                      boxShadow: '0 0 8px #ff2a4d',
                      top: `calc(50% - 5px - ${Math.max(-45, Math.min(45, rearAx * 35))}px)`,
                      left: `calc(50% - 5px + ${Math.max(-45, Math.min(45, rearAy * 35))}px)`,
                      transition: 'all 0.08s ease-out',
                      border: '1px solid rgba(255,255,255,0.3)',
                      zIndex: 2
                    }} title="Rear IMU" />
                  )}

                  <span style={{ position: 'absolute', bottom: '6px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.55rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {Math.sqrt(cogAx*cogAx + cogAy*cogAy).toFixed(2)} G (COG)
                  </span>
                </div>
              </div>

              {/* Right Corners: FR, RR */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* FR */}
                <div style={{ borderRight: '3px solid var(--color-fr)', paddingRight: '0.75rem', textAlign: 'right' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: '#ecfeff', flexDirection: 'row-reverse' }}>
                    <span>FRONT RIGHT</span>
                    <span style={{ color: getBrakeColor(Number(val('sdu[1].brake', 1, 0))) }}>
                      Rotor: {val('sdu[1].brake', 1)} °C
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 0.5rem', marginTop: '0.35rem', fontSize: '0.7rem', color: 'var(--text-secondary)', direction: 'rtl' }}>
                    <span>Speed: <strong style={{ color: 'var(--text-primary)' }}>{val('sdu[1].wrpm', 0)} RPM</strong></span>
                    <span>Shock: <strong style={{ color: 'var(--text-primary)' }}>{val('sdu[1].shock', 1)} mm</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.4rem', direction: 'rtl' }}>
                    <span>Tire Surface</span>
                  </div>
                  {/* Tire Temps Heatmap */}
                  <div style={{ display: 'flex', gap: '2px', height: '6px', borderRadius: '3px', overflow: 'hidden', marginTop: '0.15rem', flexDirection: 'row-reverse' }}>
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[1].tire[3]', 0, 0)) * 2)}, 80%, 50%)` }} title="Amb" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[1].tire[1]', 0, 0)) * 2)}, 80%, 50%)` }} title="Min" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[1].tire[2]', 0, 0)) * 2)}, 80%, 50%)` }} title="Ctr" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[1].tire[0]', 0, 0)) * 2)}, 80%, 50%)` }} title="Max" />
                  </div>
                </div>

                {/* RR */}
                <div style={{ borderRight: '3px solid var(--color-rr)', paddingRight: '0.75rem', textAlign: 'right' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: '#fae8ff', flexDirection: 'row-reverse' }}>
                    <span>REAR RIGHT</span>
                    <span style={{ color: getBrakeColor(Number(val('sdu[3].brake', 1, 0))) }}>
                      Rotor: {val('sdu[3].brake', 1)} °C
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem 0.5rem', marginTop: '0.35rem', fontSize: '0.7rem', color: 'var(--text-secondary)', direction: 'rtl' }}>
                    <span>Speed: <strong style={{ color: 'var(--text-primary)' }}>{val('sdu[3].wrpm', 0)} RPM</strong></span>
                    <span>Shock: <strong style={{ color: 'var(--text-primary)' }}>{val('sdu[3].shock', 1)} mm</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.6rem', color: 'var(--text-secondary)', marginTop: '0.4rem', direction: 'rtl' }}>
                    <span>Tire Surface</span>
                  </div>
                  {/* Tire Temps Heatmap */}
                  <div style={{ display: 'flex', gap: '2px', height: '6px', borderRadius: '3px', overflow: 'hidden', marginTop: '0.15rem', flexDirection: 'row-reverse' }}>
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[3].tire[3]', 0, 0)) * 2)}, 80%, 50%)` }} title="Amb" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[3].tire[1]', 0, 0)) * 2)}, 80%, 50%)` }} title="Min" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[3].tire[2]', 0, 0)) * 2)}, 80%, 50%)` }} title="Ctr" />
                    <div style={{ flex: 1, background: `hsl(${220 - Math.min(180, Number(val('sdu[3].tire[0]', 0, 0)) * 2)}, 80%, 50%)` }} title="Max" />
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ECU Connection & Logging Health Card */}
        {visibilities.boardsHealth && (
          <div className="glass-panel no-hover" 
            draggable={dragEnabledCard === 'boardsHealth'}
            onDragStart={(e) => handleDragStart(e, 'boardsHealth')}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, 'boardsHealth')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              border: '1px solid var(--border-color)',
              minHeight: '280px',
              order: cardOrder.indexOf('boardsHealth'),
              opacity: draggedCardId === 'boardsHealth' ? 0.4 : 1,
              transition: 'opacity 0.2s ease'
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div 
                  onMouseDown={() => setDragEnabledCard('boardsHealth')}
                  onMouseUp={() => setDragEnabledCard(null)}
                  style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0.1rem', color: 'var(--text-secondary)', opacity: 0.6 }}
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
                <Activity size={16} className="text-blue-400" style={{ marginLeft: '0.25rem' }} />
                <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>ECU Logging & Health</h3>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CAN Bus Transceivers</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.55rem', flex: 1, overflowY: 'auto' }}>
              {EXPECTED_BOARDS.map((eb) => {
                const status = getBoardStatus(eb);
                let badgeColor = 'rgba(255,255,255,0.05)';
                let badgeTextColor = 'var(--text-secondary)';
                let statusDot = 'rgba(255,255,255,0.2)';
                
                if (status.state === 'online') {
                  badgeColor = 'rgba(0, 255, 127, 0.05)';
                  badgeTextColor = '#a7f3d0';
                  statusDot = '#00ff7f';
                } else if (status.state === 'degraded') {
                  badgeColor = 'rgba(245, 158, 11, 0.08)';
                  badgeTextColor = '#fde047';
                  statusDot = '#f59e0b';
                } else if (status.msg === 'STALE') {
                  badgeColor = 'rgba(239, 68, 68, 0.05)';
                  badgeTextColor = '#fca5a5';
                  statusDot = '#ef4444';
                }

                return (
                  <div
                    key={eb.key}
                    style={{
                      background: 'rgba(0,0,0,0.15)',
                      border: `1px solid ${status.state === 'online' ? 'rgba(0, 255, 127, 0.15)' : 'var(--border-color)'}`,
                      borderRadius: '6px',
                      padding: '0.45rem 0.65rem',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: '0.2rem'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>{eb.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <span style={{ display: 'block', width: '5px', height: '5px', borderRadius: '50%', background: statusDot, boxShadow: status.state === 'online' ? `0 0 6px ${statusDot}` : 'none' }} />
                        <span style={{ fontSize: '0.5rem', fontWeight: 700, color: badgeTextColor, textTransform: 'uppercase' }}>
                          {status.msg}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-secondary)' }}>
                      <span>Frames: <strong style={{ color: 'var(--text-primary)' }}>{status.count}</strong></span>
                      {status.state !== 'offline' && status.rate > 0 && (
                        <span style={{ color: 'var(--color-info)' }}>{status.rate} Hz</span>
                      )}
                    </div>

                    {status.drops > 0 && (
                      <div style={{ fontSize: '0.55rem', color: 'var(--color-warning)', borderTop: '1px solid rgba(245,158,11,0.15)', paddingTop: '0.1rem', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Drops:</span>
                        <strong>{status.drops}</strong>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Live GPS Map Card */}
        {visibilities.liveMap && (
          <div className="glass-panel no-hover" 
            draggable={dragEnabledCard === 'liveMap'}
            onDragStart={(e) => handleDragStart(e, 'liveMap')}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, 'liveMap')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              height: '100%',
              minHeight: '280px',
              border: '1px solid var(--border-color)',
              position: 'relative',
              order: cardOrder.indexOf('liveMap'),
              opacity: draggedCardId === 'liveMap' ? 0.4 : 1,
              transition: 'opacity 0.2s ease'
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div 
                  onMouseDown={() => setDragEnabledCard('liveMap')}
                  onMouseUp={() => setDragEnabledCard(null)}
                  style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0.1rem', color: 'var(--text-secondary)', opacity: 0.6 }}
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
                <Activity size={16} className="text-emerald-400" style={{ marginLeft: '0.25rem' }} />
                <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live GPS Map</h3>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={followVehicle} onChange={(e) => setFollowVehicle(e.target.checked)} />
                  <span>Follow</span>
                </label>
                <button onClick={recenterMap} className="button" style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}>
                  Recenter
                </button>
              </div>
            </div>

            {/* Map Container */}
            <div style={{ flex: 1, position: 'relative', borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)', background: '#090d16' }}>
              <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '200px' }} />
              
              {/* Floating GPS readouts overlay */}
              <div style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                background: 'rgba(9, 13, 22, 0.85)',
                backdropFilter: 'blur(4px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '0.35rem 0.5rem',
                borderRadius: '4px',
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.15rem',
                fontSize: '0.65rem'
              }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Speed: <strong style={{ color: '#fff' }}>{val('gps.vel', 1, '0.0')} m/s</strong>
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Fix: <strong style={{ color: '#00ff7f' }}>{getRtkStatus()}</strong>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 2. BMS BATTERY CORE */}
        {visibilities.bms && (
          <div className="glass-panel no-hover" 
            draggable={dragEnabledCard === 'bms'}
            onDragStart={(e) => handleDragStart(e, 'bms')}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, 'bms')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              border: soc < thresholds.batterySocMin || lowCellV < thresholds.cellVoltageMin ? '1px solid var(--color-danger)' : '1px solid var(--border-color)',
              boxShadow: soc < thresholds.batterySocMin || lowCellV < thresholds.cellVoltageMin ? '0 0 20px rgba(239, 68, 68, 0.15)' : 'none',
              order: cardOrder.indexOf('bms'),
              opacity: draggedCardId === 'bms' ? 0.4 : 1,
              transition: 'opacity 0.2s ease'
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div 
                  onMouseDown={() => setDragEnabledCard('bms')}
                  onMouseUp={() => setDragEnabledCard(null)}
                  style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0.1rem', color: 'var(--text-secondary)', opacity: 0.6 }}
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
                <Zap size={16} className="text-emerald-400" style={{ marginLeft: '0.25rem' }} />
                <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>BMS Status</h3>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Orion Pack Stats</span>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
              {/* Radial SOC progress */}
              <div style={{ position: 'relative', width: '80px', height: '80px' }}>
                <svg width="80" height="80" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3.5" />
                  <circle cx="18" cy="18" r="16" fill="none" 
                    stroke={soc < thresholds.batterySocMin ? 'var(--color-danger)' : 'var(--color-success)'} 
                    strokeWidth="3.5" 
                    strokeDasharray={`${soc}, 100`} 
                    strokeLinecap="round"
                    transform="rotate(-90 18 18)"
                  />
                </svg>
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>{val('bms.soc', 0)}%</span>
                  <span style={{ fontSize: '0.5rem', color: 'var(--text-secondary)', fontWeight: 600 }}>SOC</span>
                </div>
              </div>

              {/* Voltage & Current */}
              {/* Voltage & Current & Power */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.15rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Voltage</span>
                  <strong style={{ fontSize: '0.85rem' }}>{val('bms.v', 1)} V</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.15rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Current</span>
                  <strong style={{ fontSize: '0.85rem' }}>{val('bms.i', 1)} A</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.15rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Power Draw</span>
                  <strong style={{ fontSize: '0.85rem', color: currentPowerKw > 80 ? '#ef4444' : 'var(--text-primary)' }}>
                    {currentPowerKw.toFixed(1)} kW
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Session Peak</span>
                  <strong style={{ fontSize: '0.85rem', color: sessionMaxPowerRef.current > 80 ? '#ef4444' : '#00f0ff' }}>
                    {sessionMaxPowerRef.current.toFixed(1)} kW
                  </strong>
                </div>
              </div>
            </div>

            {/* Min/Max/Avg cell readouts with vertical separator */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.75rem', background: 'rgba(0,0,0,0.15)', padding: '0.55rem', borderRadius: '6px', fontSize: '0.7rem', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>CELL TEMPERATURES</span>
                <span>Average: <strong>{val('bms.avg_t', 1)} °C</strong></span>
                <span>High (Peak): <strong style={{ color: 'var(--color-warning)' }}>{val('bms.hi_t', 1)} °C</strong></span>
                <span>Low: <strong>{val('bms.lo_t', 1)} °C</strong></span>
                <span>Session Peak: <strong>{sessionMaxCellTempRef.current > 0 ? `${sessionMaxCellTempRef.current.toFixed(1)} °C` : '--'}</strong></span>
              </div>
              <div style={{ width: '1px', background: 'rgba(255,255,255,0.08)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>CELL VOLTAGES</span>
                <span>Average: <strong>{val('bms.avg_cv', 3)} V</strong></span>
                <span>High: <strong>{val('bms.hi_cv', 3)} V</strong></span>
                <span>Low: <strong style={{ color: lowCellV < thresholds.cellVoltageMin ? 'var(--color-danger)' : 'var(--text-primary)' }}>{val('bms.lo_cv', 3)} V</strong></span>
                <span>Delta: <strong style={{ color: (Number(latestValues['bms.hi_cv'] || 0) - Number(latestValues['bms.lo_cv'] || 0)) > 0.08 ? '#f59e0b' : 'var(--text-primary)' }}>
                  {latestValues['bms.hi_cv'] !== undefined && latestValues['bms.lo_cv'] !== undefined 
                    ? `${(Number(latestValues['bms.hi_cv'] || 0) - Number(latestValues['bms.lo_cv'] || 0)).toFixed(3)} V` 
                    : '--'}
                </strong></span>
              </div>
            </div>
          </div>
        )}

        {/* 3. MOTOR & INVERTER */}
        {visibilities.inverter && (
          <div className="glass-panel no-hover" 
            draggable={dragEnabledCard === 'inverter'}
            onDragStart={(e) => handleDragStart(e, 'inverter')}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, 'inverter')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              border: motorTemp > thresholds.motorTempMax ? '1px solid var(--color-danger)' : '1px solid var(--border-color)',
              boxShadow: motorTemp > thresholds.motorTempMax ? '0 0 20px rgba(239, 68, 68, 0.15)' : 'none',
              order: cardOrder.indexOf('inverter'),
              opacity: draggedCardId === 'inverter' ? 0.4 : 1,
              transition: 'opacity 0.2s ease'
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div 
                  onMouseDown={() => setDragEnabledCard('inverter')}
                  onMouseUp={() => setDragEnabledCard(null)}
                  style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0.1rem', color: 'var(--text-secondary)', opacity: 0.6 }}
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
                <Activity size={16} className="text-blue-400" style={{ marginLeft: '0.25rem' }} />
                <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Inverter & Motor</h3>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cascadia PM100</span>
            </div>

            {/* Motor RPM Ring progress bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Motor Speed</span>
                <strong>{val('inv.rpm', 0)} RPM</strong>
              </div>
              <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, (rpm / 6500) * 100)}%`,
                  background: 'linear-gradient(to right, var(--color-success) 0%, var(--color-warning) 70%, var(--color-danger) 100%)',
                  borderRadius: '4px',
                  transition: 'width 0.1s ease-out'
                }} />
              </div>
            </div>

            {/* Temperatures */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Motor Temp</span>
                <strong style={{ fontSize: '1rem', color: motorTemp > thresholds.motorTempMax ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                  {val('inv.mot_t', 1)} °C
                </strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Inverter Coolant</span>
                <strong style={{ fontSize: '1rem' }}>{val('inv.cool_t', 1)} °C</strong>
              </div>
            </div>

            {/* Torque & DC Bus */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px', fontSize: '0.7rem' }}>
              <div>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>TORQUE CONTROLS</span>
                <div style={{ marginTop: '0.2rem' }}>Command: <strong>{val('inv.tq_cmd', 1)} Nm</strong></div>
                <div>Feedback: <strong>{val('inv.tq_fb', 1)} Nm</strong></div>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>DC BUS MONITOR</span>
                <div style={{ marginTop: '0.2rem' }}>Bus Voltage: <strong>{val('inv.vdc', 1)} V</strong></div>
                <div>Bus Current: <strong>{val('inv.idc', 1)} A</strong></div>
              </div>
            </div>
          </div>
        )}

        {/* 4. VCU CONTROL SYSTEM */}
        {visibilities.vcu && (
          <div className="glass-panel no-hover" 
            draggable={dragEnabledCard === 'vcu'}
            onDragStart={(e) => handleDragStart(e, 'vcu')}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, 'vcu')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              border: '1px solid var(--border-color)',
              order: cardOrder.indexOf('vcu'),
              opacity: draggedCardId === 'vcu' ? 0.4 : 1,
              transition: 'opacity 0.2s ease'
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div 
                  onMouseDown={() => setDragEnabledCard('vcu')}
                  onMouseUp={() => setDragEnabledCard(null)}
                  style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0.1rem', color: 'var(--text-secondary)', opacity: 0.6 }}
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
                <Activity size={16} className="text-purple-400" style={{ marginLeft: '0.25rem' }} />
                <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>VCU Dashboard</h3>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vehicle Control Unit</span>
            </div>

            {/* APPS & BSE Pedals */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '0.2rem' }}>
                  <span>APPS 1/2</span>
                  <strong>{val('vcu.apps1', 0)}%</strong>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${val('vcu.apps1', 0, 0)}%`, background: 'var(--color-success)', borderRadius: '3px' }} />
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '0.2rem' }}>
                  <span>Brake (BSE)</span>
                  <strong>{val('vcu.bse', 0)}%</strong>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${val('vcu.bse', 0, 0)}%`, background: '#f97316', borderRadius: '3px' }} />
                </div>
              </div>
            </div>

            {/* Glowing State LEDs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.25rem', textAlign: 'center', fontSize: '0.65rem' }}>
              {/* RTD */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: Number(latestValues['vcu.rtd'] || 0) === 1 ? '#10b981' : 'rgba(255,255,255,0.03)',
                  border: Number(latestValues['vcu.rtd'] || 0) === 1 ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.15)',
                  boxShadow: Number(latestValues['vcu.rtd'] || 0) === 1 ? '0 0 10px #10b981' : 'none',
                  transition: 'all 0.2s ease'
                }} />
                <span>RTD</span>
              </div>
              
              {/* IMD */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: Number(latestValues['vcu.imd_fault'] || 0) === 1 ? '#ef4444' : '#10b981',
                  border: Number(latestValues['vcu.imd_fault'] || 0) === 1 ? '1px solid #ef4444' : '1px solid #10b981',
                  boxShadow: Number(latestValues['vcu.imd_fault'] || 0) === 1 ? '0 0 10px #ef4444' : '0 0 6px rgba(16, 185, 129, 0.4)',
                  transition: 'all 0.2s ease'
                }} />
                <span>IMD Good</span>
              </div>

              {/* Precharge */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: Number(latestValues['vcu.precharge'] || 0) === 1 ? '#f59e0b' : 'rgba(255,255,255,0.03)',
                  border: Number(latestValues['vcu.precharge'] || 0) === 1 ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.15)',
                  boxShadow: Number(latestValues['vcu.precharge'] || 0) === 1 ? '0 0 10px #f59e0b' : 'none',
                  transition: 'all 0.2s ease'
                }} />
                <span>P-Chg</span>
              </div>

              {/* AIR+ */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: Number(latestValues['vcu.air_pos'] || 0) === 1 ? '#10b981' : 'rgba(255,255,255,0.03)',
                  border: Number(latestValues['vcu.air_pos'] || 0) === 1 ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.15)',
                  boxShadow: Number(latestValues['vcu.air_pos'] || 0) === 1 ? '0 0 10px #10b981' : 'none',
                  transition: 'all 0.2s ease'
                }} />
                <span>AIR+</span>
              </div>

              {/* AIR- */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: Number(latestValues['vcu.air_neg'] || 0) === 1 ? '#10b981' : 'rgba(255,255,255,0.03)',
                  border: Number(latestValues['vcu.air_neg'] || 0) === 1 ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.15)',
                  boxShadow: Number(latestValues['vcu.air_neg'] || 0) === 1 ? '0 0 10px #10b981' : 'none',
                  transition: 'all 0.2s ease'
                }} />
                <span>AIR-</span>
              </div>
            </div>
          </div>
        )}

        {/* 5. FLOW & AUX TSPMU PRESSURE BOARDS */}
        {visibilities.flowPressures && (
          <div className="glass-panel no-hover" 
            draggable={dragEnabledCard === 'flowPressures'}
            onDragStart={(e) => handleDragStart(e, 'flowPressures')}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, 'flowPressures')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              border: isCoolingOffline ? '1px solid #ef4444' : (flowAvg > 0 && flowAvg < thresholds.coolantFlowMin ? '1px solid var(--color-danger)' : '1px solid var(--border-color)'),
              boxShadow: isCoolingOffline ? '0 0 20px rgba(239, 68, 68, 0.3)' : (flowAvg > 0 && flowAvg < thresholds.coolantFlowMin ? '0 0 20px rgba(239, 68, 68, 0.15)' : 'none'),
              order: cardOrder.indexOf('flowPressures'),
              opacity: draggedCardId === 'flowPressures' ? 0.4 : 1,
              transition: 'opacity 0.2s ease'
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div 
                  onMouseDown={() => setDragEnabledCard('flowPressures')}
                  onMouseUp={() => setDragEnabledCard(null)}
                  style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0.1rem', color: 'var(--text-secondary)', opacity: 0.6 }}
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
                <Thermometer size={16} className="text-yellow-400" style={{ marginLeft: '0.25rem' }} />
                <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Flow & Pressures</h3>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>TSHMU / TSPMU</span>
            </div>

            {isCoolingOffline && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid #ef4444',
                color: '#fca5a5',
                padding: '0.4rem 0.6rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                textAlign: 'center',
                animation: 'pulse 1.5s infinite',
                boxShadow: '0 0 10px rgba(239, 68, 68, 0.3)'
              }}>
                ⚠️ COOLING SYSTEM OFFLINE
              </div>
            )}

            {/* Flow values */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Coolant Flow 1</span>
                <strong style={{ fontSize: '1rem', display: 'block' }}>{val('tshmu.flow1', 1)} L/min</strong>
              </div>
              <div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Coolant Flow 2</span>
                <strong style={{ fontSize: '1rem', display: 'block' }}>{val('tshmu.flow2', 1)} L/min</strong>
              </div>
            </div>

            {/* TSPMU pressure and temps */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'rgba(0,0,0,0.15)', padding: '0.5rem', borderRadius: '6px', fontSize: '0.7rem' }}>
              <div>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>TSPMU BOARD 0</span>
                <div style={{ marginTop: '0.2rem' }}>P1: <strong>{val('tspmu[0].p1', 0)} Pa</strong></div>
                <div>P2: <strong>{val('tspmu[0].p2', 0)} Pa</strong></div>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>TSPMU BOARD 1</span>
                <div style={{ marginTop: '0.2rem' }}>P1: <strong>{val('tspmu[1].p1', 0)} Pa</strong></div>
                <div>P2: <strong>{val('tspmu[1].p2', 0)} Pa</strong></div>
              </div>
            </div>
          </div>
        )}

        {/* 6. PI HARDWARE & NETWORK DIAGNOSTICS */}
        {visibilities.piStatus && (
          <div className="glass-panel no-hover" 
            draggable={dragEnabledCard === 'piStatus'}
            onDragStart={(e) => handleDragStart(e, 'piStatus')}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, 'piStatus')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              border: '1px solid var(--border-color)',
              order: cardOrder.indexOf('piStatus'),
              opacity: draggedCardId === 'piStatus' ? 0.4 : 1,
              transition: 'opacity 0.2s ease'
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <div 
                  onMouseDown={() => setDragEnabledCard('piStatus')}
                  onMouseUp={() => setDragEnabledCard(null)}
                  style={{ cursor: 'grab', display: 'flex', alignItems: 'center', padding: '0.1rem', color: 'var(--text-secondary)', opacity: 0.6 }}
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
                <Cpu size={16} className="text-orange-400" style={{ marginLeft: '0.25rem' }} />
                <h3 style={{ margin: 0, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>RPi System Status</h3>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pi & Diagnostic Statistics</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.15rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Parsed Rate</span>
                  <strong>{diagnostics.framesPerSecond ? diagnostics.framesPerSecond.toFixed(0) : 0} FPS</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.15rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Bitrate</span>
                  <strong>{diagnostics.bytesPerSecond ? (diagnostics.bytesPerSecond / 1024).toFixed(1) : 0} KB/s</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Errors</span>
                  <strong style={{ color: diagnostics.parseErrors > 0 ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                    {diagnostics.parseErrors || 0}
                  </strong>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', borderLeft: '1px solid rgba(255,255,255,0.05)', paddingLeft: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.15rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Local Log</span>
                  <strong style={{ color: logStatus.active ? 'var(--color-success)' : 'var(--text-secondary)' }}>
                    {logStatus.active ? 'ACTIVE' : 'OFF'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.15rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Wifi link</span>
                  <strong>{connectionState.connected ? 'CONNECTED' : 'OFFLINE'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.15rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ping</span>
                  <strong style={{ color: getAverageLatency() > 100 ? '#ef4444' : '#10b981' }}>
                    {getAverageLatency() !== null ? `${getAverageLatency().toFixed(0)} ms` : '--'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Baud rate</span>
                  <strong>{connectionState.baudRate || 115200}</strong>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Floating Action Button for Settings */}
      <button 
        onClick={() => setIsSettingsOpen(true)}
        className="button"
        style={{
          position: 'absolute',
          top: '-3.25rem',
          right: '0',
          padding: '0.45rem 0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.35rem',
          fontSize: '0.8rem',
          border: '1px solid var(--border-color)'
        }}
      >
        <Settings size={14} />
        <span>Dashboard Settings</span>
      </button>

      {/* Settings Sliding Drawer Panel */}
      {isSettingsOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '350px',
          height: '100%',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(20px)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
          zIndex: 1000,
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          animation: 'slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}>
          {/* Drawer Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sliders size={18} className="text-blue-500" />
              <span>Dashboard Configurations</span>
            </h3>
            <button 
              onClick={() => setIsSettingsOpen(false)}
              className="button" 
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
            >
              Close
            </button>
          </div>

          {/* Toggle Card Visibilities */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>TOGGLE WIDGET VISIBILITY</span>
            
            {Object.keys(visibilities).map(key => (
              <label 
                key={key} 
                className="plotter-checkbox-label"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.8rem',
                  padding: '0.35rem',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  background: visibilities[key] ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                  border: visibilities[key] ? '1px solid rgba(59, 130, 246, 0.15)' : '1px solid transparent'
                }}
              >
                <input 
                  type="checkbox" 
                  checked={visibilities[key]} 
                  onChange={() => toggleVisibility(key)} 
                  style={{ display: 'none' }}
                />
                <div style={{
                  width: '14px',
                  height: '14px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: visibilities[key] ? '#3b82f6' : 'transparent'
                }}>
                  {visibilities[key] && <Check size={10} strokeWidth={3} />}
                </div>
                <span style={{ textTransform: 'capitalize' }}>
                  {key.replace(/([A-Z])/g, ' $1')}
                </span>
              </label>
            ))}
          </div>

          {/* Warning Threshold Sliders */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', flex: 1, paddingBottom: '1rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>WARNING THRESHOLDS</span>
            
            {/* Brake Temp Max */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span>Max Brake Temp</span>
                <strong>{thresholds.brakeTempMax} °C</strong>
              </div>
              <input 
                type="range" 
                min="100" 
                max="600" 
                step="10"
                value={thresholds.brakeTempMax} 
                onChange={(e) => handleThresholdChange('brakeTempMax', e.target.value)}
                style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', outline: 'none' }}
              />
            </div>

            {/* Coolant Flow Min */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span>Min Coolant Flow</span>
                <strong>{thresholds.coolantFlowMin.toFixed(1)} L/min</strong>
              </div>
              <input 
                type="range" 
                min="1.0" 
                max="10.0" 
                step="0.5"
                value={thresholds.coolantFlowMin} 
                onChange={(e) => handleThresholdChange('coolantFlowMin', e.target.value)}
                style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', outline: 'none' }}
              />
            </div>

            {/* Motor Temp Max */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span>Max Motor Temp</span>
                <strong>{thresholds.motorTempMax} °C</strong>
              </div>
              <input 
                type="range" 
                min="50" 
                max="130" 
                step="5"
                value={thresholds.motorTempMax} 
                onChange={(e) => handleThresholdChange('motorTempMax', e.target.value)}
                style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', outline: 'none' }}
              />
            </div>

            {/* Cell Voltage Min */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span>Min Cell Voltage</span>
                <strong>{thresholds.cellVoltageMin.toFixed(2)} V</strong>
              </div>
              <input 
                type="range" 
                min="2.5" 
                max="3.8" 
                step="0.05"
                value={thresholds.cellVoltageMin} 
                onChange={(e) => handleThresholdChange('cellVoltageMin', e.target.value)}
                style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', outline: 'none' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
