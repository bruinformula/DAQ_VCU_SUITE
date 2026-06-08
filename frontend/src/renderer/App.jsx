import React, { useState, useMemo, useCallback } from 'react';
import { useTelemetry } from './context/TelemetryContext';
import ConnectionBar from './components/ConnectionBar';

// Telemetry Visualizer Tabs
import Overview from './components/Overview';
import CornerOverlays from './components/CornerOverlays';
import Drivetrain from './components/Drivetrain';
import ImuMotion from './components/ImuMotion';
import TractiveSystem from './components/TractiveSystem';
import CustomPlotter from './components/CustomPlotter';
import TrackMap from './components/TrackMap';
import DataTable from './components/DataTable';
import GGDiagram from './components/GGDiagram';
import GPSPlayback from './components/GPSPlayback';

// Debug GUI Tabs
import LiveConsole from './components/LiveConsole';
import DeployFirmware from './components/DeployFirmware';

import { LayoutDashboard, Layers, BarChart3, Map, Table, Upload, AlertCircle, Activity, Compass, Zap, Terminal, Cpu } from 'lucide-react';

// Helper to detect stale runs for a specific board or device
function detectBoardDropouts(data, boardType, globalGaps, startTs) {
  const gaps = [...globalGaps];
  if (!data || data.length < 2) return gaps;

  let cols = [];
  let color = 'rgba(239, 68, 68, 0.12)';
  let borderColor = 'rgba(239, 68, 68, 0.4)';
  let textColor = '#ef4444';
  let label = 'DROP';

  if (boardType === 'sdu0') {
    cols = ['sdu[0].shock', 'sdu[0].wrpm', 'sdu[0].brake'];
    color = 'rgba(249, 115, 22, 0.12)';
    borderColor = 'rgba(249, 115, 22, 0.4)';
    textColor = '#f97316';
    label = 'FL DROP';
  } else if (boardType === 'sdu1') {
    cols = ['sdu[1].shock', 'sdu[1].wrpm', 'sdu[1].brake'];
    color = 'rgba(6, 182, 212, 0.12)';
    borderColor = 'rgba(6, 182, 212, 0.4)';
    textColor = '#06b6d4';
    label = 'FR DROP';
  } else if (boardType === 'sdu2') {
    cols = ['sdu[2].shock', 'sdu[2].wrpm', 'sdu[2].brake'];
    color = 'rgba(16, 185, 129, 0.12)';
    borderColor = 'rgba(16, 185, 129, 0.4)';
    textColor = '#10b981';
    label = 'RL DROP';
  } else if (boardType === 'sdu3') {
    cols = ['sdu[3].shock', 'sdu[3].wrpm', 'sdu[3].brake'];
    color = 'rgba(139, 92, 246, 0.12)';
    borderColor = 'rgba(139, 92, 246, 0.4)';
    textColor = '#8b5cf6';
    label = 'RR DROP';
  } else if (boardType === 'gps') {
    cols = ['gps.lat', 'gps.lon', 'gps.vel'];
    color = 'rgba(6, 182, 212, 0.12)';
    borderColor = 'rgba(6, 182, 212, 0.4)';
    textColor = '#06b6d4';
    label = 'GPS DROP';
  } else if (boardType === 'inverter') {
    cols = ['inv.tq_fb', 'inv.idc', 'inv.rpm', 'inv.mot_t'];
    color = 'rgba(239, 68, 68, 0.12)';
    borderColor = 'rgba(239, 68, 68, 0.4)';
    textColor = '#ef4444';
    label = 'INV DROP';
  } else if (boardType === 'bms') {
    cols = ['bms.v', 'bms.i', 'bms.soc'];
    color = 'rgba(16, 185, 129, 0.12)';
    borderColor = 'rgba(16, 185, 129, 0.4)';
    textColor = '#10b981';
    label = 'BMS DROP';
  } else if (boardType === 'tspmu0') {
    cols = ['tspmu[0].p1', 'tspmu[0].p2'];
    color = 'rgba(245, 158, 11, 0.12)';
    borderColor = 'rgba(245, 158, 11, 0.4)';
    textColor = '#f59e0b';
    label = 'TSPMU0 DROP';
  } else if (boardType === 'tspmu1') {
    cols = ['tspmu[1].p1', 'tspmu[1].p2'];
    color = 'rgba(16, 185, 129, 0.12)';
    borderColor = 'rgba(16, 185, 129, 0.4)';
    textColor = '#10b981';
    label = 'TSPMU1 DROP';
  } else if (boardType === 'tshmu') {
    cols = ['tshmu.flow1', 'tshmu.flow2'];
    color = 'rgba(236, 72, 153, 0.12)';
    borderColor = 'rgba(236, 72, 153, 0.4)';
    textColor = '#ec4899';
    label = 'FLOW DROP';
  } else if (boardType === 'imu') {
    cols = ['imu.ax', 'imu.ay', 'imu.az'];
    color = 'rgba(234, 179, 8, 0.12)';
    borderColor = 'rgba(234, 179, 8, 0.4)';
    textColor = '#eab308';
    label = 'IMU DROP';
  }

  const presentCols = cols.filter(col => data[0][col] !== undefined);
  if (presentCols.length === 0) return gaps;

  let streakStartIdx = -1;
  const minStreak = 30; // 3.0 seconds at 10Hz

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];

    let allConstant = true;
    for (const col of presentCols) {
      if (prev[col] !== curr[col] || prev[col] === undefined || prev[col] === '') {
        allConstant = false;
        break;
      }
    }

    if (allConstant) {
      if (streakStartIdx === -1) {
        streakStartIdx = i - 1;
      }
    } else {
      if (streakStartIdx !== -1) {
        const streakLength = i - streakStartIdx;
        if (streakLength >= minStreak) {
          const startTime = parseFloat(data[streakStartIdx].ts);
          const endTime = parseFloat(data[i - 1].ts);
          if (!isNaN(startTime) && !isNaN(endTime)) {
            const isGlobal = globalGaps.some(g => Math.abs(g.startTime - startTime) < 0.1);
            if (!isGlobal) {
              gaps.push({
                startTime,
                endTime,
                duration: endTime - startTime,
                color,
                borderColor,
                textColor,
                label
              });
            }
          }
        }
        streakStartIdx = -1;
      }
    }
  }

  if (streakStartIdx !== -1) {
    const streakLength = data.length - streakStartIdx;
    if (streakLength >= minStreak) {
      const startTime = parseFloat(data[streakStartIdx].ts);
      const endTime = parseFloat(data[data.length - 1].ts);
      if (!isNaN(startTime) && !isNaN(endTime)) {
        const isGlobal = globalGaps.some(g => Math.abs(g.startTime - startTime) < 0.1);
        if (!isGlobal) {
          gaps.push({
            startTime,
            endTime,
            duration: endTime - startTime,
            color,
            borderColor,
            textColor,
            label
          });
        }
      }
    }
  }

  return gaps;
}

export default function App() {
  const { activeDataset, loadRunFile, loading, error } = useTelemetry();
  const [activeTab, setActiveTab] = useState('liveconsole');
  const [dragActive, setDragActive] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(null);

  // Compute stats on current active dataset
  const startTs = useMemo(() => {
    if (activeDataset.length === 0) return 0;
    const firstRowTs = parseFloat(activeDataset[0].ts);
    return isNaN(firstRowTs) ? 0 : firstRowTs;
  }, [activeDataset]);

  // Scan dataset for time gaps (dropouts) where dt > 0.45 seconds
  const dropouts = useMemo(() => {
    if (activeDataset.length < 2) return [];
    const gaps = [];
    const threshold = 0.45;

    for (let i = 1; i < activeDataset.length; i++) {
      const prevTs = parseFloat(activeDataset[i - 1].ts);
      const currTs = parseFloat(activeDataset[i].ts);
      if (!isNaN(prevTs) && !isNaN(currTs)) {
        const dT = currTs - prevTs;
        if (dT > threshold) {
          gaps.push({
            startIndex: i - 1,
            endIndex: i,
            startTime: prevTs,
            endTime: currTs,
            duration: dT,
            color: 'rgba(239, 68, 68, 0.12)',
            borderColor: 'rgba(239, 68, 68, 0.4)',
            textColor: '#ef4444',
            label: 'LOG DROP'
          });
        }
      }
    }
    return gaps;
  }, [activeDataset]);

  // Precompute board-specific dropouts
  const boardDropouts = useMemo(() => {
    const boards = ['gps', 'inverter', 'imu', 'sdu0', 'sdu1', 'sdu2', 'sdu3', 'tspmu0', 'tspmu1', 'tshmu', 'bms'];
    const result = {};
    boards.forEach(b => {
      result[b] = detectBoardDropouts(activeDataset, b, dropouts, startTs);
    });
    return result;
  }, [activeDataset, dropouts, startTs]);

  // Drag and Drop handlers
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if the dragged items are actual files (from the OS) and not internal UI elements
    const isFileDrag = e.dataTransfer.types && (
      typeof e.dataTransfer.types.contains === 'function'
        ? e.dataTransfer.types.contains('Files')
        : Array.from(e.dataTransfer.types).includes('Files')
    );
    if (!isFileDrag) return;

    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const isFileDrag = e.dataTransfer.types && (
      typeof e.dataTransfer.types.contains === 'function'
        ? e.dataTransfer.types.contains('Files')
        : Array.from(e.dataTransfer.types).includes('Files')
    );
    if (!isFileDrag) return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const filePath = file.path;
      if (filePath && (filePath.endsWith('.csv') || filePath.endsWith('.jsonl'))) {
        loadRunFile(filePath);
        setActiveTab('overview');
      } else {
        alert('Please drop a valid telemetry run file (.csv or .jsonl)');
      }
    }
  }, [loadRunFile]);

  const renderActiveTabContent = () => {
    if (loading) {
      return (
        <div className="glass-panel text-center py-20 animate-pulse" style={{ gridColumn: 'span 2' }}>
          <ActivitySpinner />
          <p className="mt-4 text-slate-400" style={{ fontSize: '0.9rem', marginTop: '1rem' }}>Loading and parsing telemetry run file...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="glass-panel text-center py-10" style={{ borderLeft: '4px solid var(--color-danger)' }}>
          <AlertCircle className="mx-auto mb-4 text-red-500" size={48} />
          <h3 className="text-xl font-bold mb-2">Error Parsing Data</h3>
          <p className="text-slate-400 mb-4">{error}</p>
        </div>
      );
    }

    switch (activeTab) {
      case 'liveconsole':
        return <LiveConsole />;
      case 'overview':
        return <Overview data={activeDataset} dropouts={dropouts} startTs={startTs} />;
      case 'overlays':
        return <CornerOverlays data={activeDataset} boardDropouts={boardDropouts} startTs={startTs} />;
      case 'drivetrain':
        return <Drivetrain data={activeDataset} boardDropouts={boardDropouts} startTs={startTs} />;
      case 'imu':
        return <ImuMotion data={activeDataset} boardDropouts={boardDropouts} startTs={startTs} />;
      case 'tractive':
        return <TractiveSystem data={activeDataset} boardDropouts={boardDropouts} startTs={startTs} />;
      case 'plotter':
        return <CustomPlotter data={activeDataset} boardDropouts={boardDropouts} startTs={startTs} />;
      case 'trackmap':
        return (
          <TrackMap
            data={activeDataset}
            hoveredIndex={hoveredIndex}
            setHoveredIndex={setHoveredIndex}
          />
        );
      case 'table':
        return <DataTable data={activeDataset} />;
      case 'ggdiagram': {
        const cols = activeDataset.length > 0 ? Object.keys(activeDataset[0]) : [];
        return <GGDiagram samples={activeDataset} availableSignalIds={cols} />;
      }
      case 'gpsplayback': {
        const cols = activeDataset.length > 0 ? Object.keys(activeDataset[0]) : [];
        return <GPSPlayback samples={activeDataset} availableSignalIds={cols} />;
      }
      case 'deploy':
        return <DeployFirmware />;
      default:
        return <LiveConsole />;
    }
  };

  return (
    <div className="app-container" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <div className="sticky-header-container">
        {/* Global Connection Bar */}
        <ConnectionBar />
      </div>

      {/* Navigation Tabs */}
      <nav className="glass-panel no-hover" style={{
        margin: '0 0 1rem 0',
        padding: '0.35rem',
        borderRadius: '10px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.25rem',
        border: '1px solid var(--border-color)',
        backgroundColor: 'rgba(25, 30, 45, 0.6)'
      }}>
        <button
          onClick={() => setActiveTab('liveconsole')}
          className={`nav-button ${activeTab === 'liveconsole' ? 'active' : ''}`}
        >
          <Terminal size={14} /> Live Console
        </button>
        <button
          onClick={() => setActiveTab('overview')}
          className={`nav-button ${activeTab === 'overview' ? 'active' : ''}`}
        >
          <LayoutDashboard size={14} /> Overview
        </button>
        <button
          onClick={() => setActiveTab('overlays')}
          className={`nav-button ${activeTab === 'overlays' ? 'active' : ''}`}
        >
          <Layers size={14} /> Corner Overlays
        </button>
        <button
          onClick={() => setActiveTab('drivetrain')}
          className={`nav-button ${activeTab === 'drivetrain' ? 'active' : ''}`}
        >
          <Activity size={14} /> Drivetrain
        </button>
        <button
          onClick={() => setActiveTab('imu')}
          className={`nav-button ${activeTab === 'imu' ? 'active' : ''}`}
        >
          <Compass size={14} /> IMU & Motion
        </button>
        <button
          onClick={() => setActiveTab('tractive')}
          className={`nav-button ${activeTab === 'tractive' ? 'active' : ''}`}
        >
          <Zap size={14} /> Tractive System
        </button>
        <button
          onClick={() => setActiveTab('plotter')}
          className={`nav-button ${activeTab === 'plotter' ? 'active' : ''}`}
        >
          <BarChart3 size={14} /> Custom Plotter
        </button>
        <button
          onClick={() => setActiveTab('trackmap')}
          className={`nav-button ${activeTab === 'trackmap' ? 'active' : ''}`}
        >
          <Map size={14} /> Track Map
        </button>
        <button
          onClick={() => setActiveTab('ggdiagram')}
          className={`nav-button ${activeTab === 'ggdiagram' ? 'active' : ''}`}
        >
          <Compass size={14} /> G-G Replay
        </button>
        <button
          onClick={() => setActiveTab('gpsplayback')}
          className={`nav-button ${activeTab === 'gpsplayback' ? 'active' : ''}`}
        >
          <Map size={14} /> GPS Replay Studio
        </button>
        <button
          onClick={() => setActiveTab('table')}
          className={`nav-button ${activeTab === 'table' ? 'active' : ''}`}
        >
          <Table size={14} /> Spreadsheet
        </button>
        <button
          onClick={() => setActiveTab('deploy')}
          className={`nav-button ${activeTab === 'deploy' ? 'active' : ''}`}
        >
          <Cpu size={14} /> Deploy Firmware
        </button>
      </nav>

      {/* Main Workspace with Drag & Drop Log Uploader */}
      <main
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        style={{ flex: 1, position: 'relative' }}
      >
        {dragActive && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 999,
              background: 'rgba(9, 13, 22, 0.95)',
              border: '2px dashed var(--color-info)',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              backdropFilter: 'blur(6px)'
            }}
          >
            <Upload size={48} className="text-blue-500 animate-bounce" />
            <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>Drop Telemetry Log to Load</h3>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Accepts parsed/raw CSV or JSONL formats</p>
          </div>
        )}

        {renderActiveTabContent()}
      </main>
    </div>
  );
}

function ActivitySpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div
        style={{
          width: '40px',
          height: '40px',
          border: '4px solid rgba(59,130,246,0.1)',
          borderTopColor: '#3b82f6',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }}
      ></div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
