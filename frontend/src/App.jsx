import { useEffect, useState } from 'react';
import MapViewer from './components/MapViewer';
import LogViewer from './components/LogViewer';
import SignalBrowser from './components/SignalBrowser';
import SignalPlot from './components/SignalPlot';
import { liveChartGroups } from './signals';
import { useTelemetry } from './useTelemetry';
import './index.css';

const DEFAULT_LOG_SIGNALS = [
  'bms.v',
  'bms.i',
  'bms.soc',
  'bms.avg_t',
  'bms.hi_t',
  'bms.lo_t',
  'bms.avg_cv',
  'bms.hi_cv',
  'bms.lo_cv',
  'inv.rpm',
  'inv.vdc',
  'inv.idc',
  'inv.tq_cmd',
  'inv.tq_fb',
  'inv.mot_t',
  'inv.cool_t',
  'vcu.spd',
  'vcu.req_tq',
  'vcu.apps1',
  'vcu.apps2',
  'vcu.bse',
  'vcu.rtd',
  'fusebox.dcdc_v',
  'fusebox.battery_v',
  'fusebox.lvb_soc',
  'fusebox.dcdc_temp',
  'imu[0].ax',
  'imu[0].ay',
  'imu[0].az',
  'imu[1].ax',
  'imu[1].ay',
  'imu[1].az',
  'imu[2].ax',
  'imu[2].ay',
  'imu[2].az',
];

const CORNER_POSITIONS = ['FL', 'FR', 'RL', 'RR'];

function formatValue(value, digits = 1) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) {
    return '--';
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : '--';
}

function formatBytesPerSecond(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return '--';
  }
  if (numeric >= 1024 * 1024) {
    return `${(numeric / (1024 * 1024)).toFixed(2)} MB/s`;
  }
  if (numeric >= 1024) {
    return `${(numeric / 1024).toFixed(1)} KB/s`;
  }
  return `${numeric.toFixed(0)} B/s`;
}

function sanitizeLogFilenameInput(rawValue) {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) return '';
  const withoutExtension = trimmed.replace(/\.csv$/i, '');
  return withoutExtension
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
}

function App() {
  const {
    isConnected,
    isLogging,
    connectionState,
    connectionMessage,
    activeTransport,
    telemetryRef,
    historyRef,
    targetIp,
    connect,
    connectSerial,
    disconnect,
    toggleLogging,
    fetchLogs,
    fetchLogFile,
  } = useTelemetry();

  const [liveMetrics, setLiveMetrics] = useState({
    soc: 0,
    packV: 0,
    speed: 0,
    coolant: 0,
    ax: 0,
    ay: 0,
    imus: [
      { ax: 0, ay: 0, az: 0 },
      { ax: 0, ay: 0, az: 0 },
      { ax: 0, ay: 0, az: 0 },
    ],
  });
  const [selectedLogSignals, setSelectedLogSignals] = useState(DEFAULT_LOG_SIGNALS);
  const [ipAddress, setIpAddress] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isTogglingLog, setIsTogglingLog] = useState(false);
  const [activeView, setActiveView] = useState('live');
  const [serialPorts, setSerialPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [mapPanelSize, setMapPanelSize] = useState('balanced');
  const [logFilenameInput, setLogFilenameInput] = useState('');

  useEffect(() => {
    if (targetIp) {
      setIpAddress(targetIp);
    }
  }, [targetIp]);

  const fetchSerialPorts = async () => {
    if (!window.electronAPI) return;
    const ports = await window.electronAPI.getSerialPorts();
    setSerialPorts(ports);
    if (ports.length > 0 && !selectedPort) {
      setSelectedPort(ports[0].path);
    }
  };

  useEffect(() => {
    fetchSerialPorts();
  }, []);

  const handleToggleSignal = (signalId) => {
    setSelectedLogSignals(prev =>
      prev.includes(signalId)
        ? prev.filter(id => id !== signalId)
        : [...prev, signalId],
    );
  };

  const handleAutoScan = async () => {
    if (!window.electronAPI) {
      alert('Autoscan is only available in the desktop app.');
      return;
    }

    setIsScanning(true);
    try {
      const foundIp = await window.electronAPI.scanNetwork();
      if (foundIp) {
        setIpAddress(foundIp);
        connect(foundIp);
      } else {
        alert('No telemetry hub was found on the local network.');
      }
    } catch (err) {
      console.error(err);
      alert('Autoscan failed.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleToggleLogging = async () => {
    setIsTogglingLog(true);
    try {
      const sanitizedFilename = sanitizeLogFilenameInput(logFilenameInput);
      await toggleLogging(selectedLogSignals, sanitizedFilename);
      if (!isLogging && sanitizedFilename) {
        setLogFilenameInput(sanitizedFilename);
      }
    } catch (err) {
      console.error(err);
      alert(err.message || 'Unable to change logging state.');
    } finally {
      setIsTogglingLog(false);
    }
  };

  useEffect(() => {
    let animationFrame;
    const updateMetrics = () => {
      const data = telemetryRef.current;
      setLiveMetrics({
        soc: data?.bms?.soc || 0,
        packV: data?.bms?.v || 0,
        speed: data?.inv?.rpm || 0,
        coolant: data?.inv?.cool_t || 0,
        ax: data?.imu?.ax || 0,
        ay: data?.imu?.ay || 0,
        imus: (data?.imus && data.imus.length >= 3) ? data.imus : [
          { ax: 0, ay: 0, az: 0, pitch: 0, roll: 0, yaw: 0, cal: 0 },
          { ax: 0, ay: 0, az: 0, pitch: 0, roll: 0, yaw: 0, cal: 0 },
          { ax: 0, ay: 0, az: 0, pitch: 0, roll: 0, yaw: 0, cal: 0 }
        ],
      });
      animationFrame = requestAnimationFrame(updateMetrics);
    };

    animationFrame = requestAnimationFrame(updateMetrics);
    return () => cancelAnimationFrame(animationFrame);
  }, [telemetryRef]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        handleToggleLogging();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLogSignals, isLogging, targetIp]);

  const currentLogFile = telemetryRef.current?.log_file || '';
  const sanitizedPreviewFilename = sanitizeLogFilenameInput(logFilenameInput);

  const maxG = 2.0;
  const getImuCoords = (imus, index) => {
    const imu = imus?.[index] || { ax: 0, ay: 0, az: 0 };
    const gX = imu.ay || 0;
    const gY = imu.ax || 0;
    const gMag = Math.sqrt(gX * gX + gY * gY);
    const cx = 50 + Math.max(-1, Math.min(1, gX / maxG)) * 50;
    const cy = 50 - Math.max(-1, Math.min(1, gY / maxG)) * 50;
    return { cx, cy, gMag };
  };

  const imusArray = liveMetrics.imus || [
    { ax: 0, ay: 0, az: 0 },
    { ax: 0, ay: 0, az: 0 },
    { ax: 0, ay: 0, az: 0 }
  ];
  const imuLabels = ['COG', 'Front', 'Rear'];

  const cogCoords = getImuCoords(imusArray, 0);
  const frontCoords = getImuCoords(imusArray, 1);
  const rearCoords = getImuCoords(imusArray, 2);
  const liveData = telemetryRef.current || {};
  const sduCorners = Array.isArray(liveData.sdu) ? liveData.sdu : [];
  const tspmuCorners = Array.isArray(liveData.tspmu) ? liveData.tspmu : [];
  const tshmu = liveData.tshmu || { flow1: 0, flow2: 0, jitter_us: 0, error_flags: 0, temp1: 0, temp2: 0, temp3: 0, temp4: 0, temp5: 0, temp6: 0 };
  const cornerCards = CORNER_POSITIONS.map((pos, index) => {
    const sdu = sduCorners[index] || { shock: 0, brake: 0, wrpm: 0, tire: [0, 0, 0, 0] };
    const tireTemps = Array.isArray(sdu.tire) ? sdu.tire : [0, 0, 0, 0];
    const valid = sdu.valid || {};
    return {
      pos,
      shock: valid.shock_mm ? sdu.shock : null,
      brake: valid.brake_c ? sdu.brake : null,
      wheel: valid.wheel_rpm ? sdu.wrpm : null,
      tireMax: valid.tire ? tireTemps[0] : null,
      tireMin: valid.tire ? tireTemps[1] : null,
      tireCtr: valid.tire ? tireTemps[2] : null,
      tireAmb: valid.tire ? tireTemps[3] : null,
      valid,
    };
  });
  const tspmuBoards = tspmuCorners
    .map((board, index) => ({
      boardId: index,
      pressure1: board?.p1 || 0,
      pressure2: board?.p2 || 0,
      temps: Array.isArray(board?.temps) ? board.temps : [0, 0, 0, 0],
    }))
    .filter((board, index) => index < 2 || board.pressure1 || board.pressure2 || board.temps.some(value => value));

  return (
    <div className="app-container">
      <header className="header glass">
        <div className="brand">
          <div className="brand-dot" />
          <div>
            <h1>Bruin Formula Racing</h1>
            <div className="header-subtitle">Telemetry Dashboard + Log Playback</div>
          </div>
        </div>

        <div className="header-metrics">
          <div className="header-metric">
            <span className="hm-label">PACK</span>
            <span className="hm-value">{liveMetrics.packV.toFixed(1)} <span className="hm-unit">V</span></span>
          </div>
          <div className="header-metric">
            <span className="hm-label">SOC</span>
            <span className="hm-value">{liveMetrics.soc.toFixed(1)} <span className="hm-unit">%</span></span>
          </div>
          <div className="header-metric">
            <span className="hm-label">MOTOR</span>
            <span className="hm-value">{Math.round(liveMetrics.speed)} <span className="hm-unit">RPM</span></span>
          </div>
          <div className="header-metric">
            <span className="hm-label">COOLANT</span>
            <span className="hm-value">{liveMetrics.coolant.toFixed(1)} <span className="hm-unit">°C</span></span>
          </div>
        </div>

        <div className="status-indicators">
          <div className="status-stack">
            <div className="status-item">
              <div className={`status-dot ${isConnected ? 'active' : 'disconnected'}`} />
              {connectionState.toUpperCase()}
            </div>
            <div className="status-caption">{connectionMessage}</div>
          </div>
          <div className="status-stack">
            <div className="status-item">
              <div className={`status-dot ${isLogging ? 'danger' : 'active'}`} />
              {isLogging ? 'LOGGING' : 'IDLE'}
            </div>
            <div className="status-caption">{activeTransport.toUpperCase()} {targetIp ? `• ${targetIp}` : ''}</div>
          </div>
          {isConnected ? (
            <button className="btn-disconnect" onClick={disconnect}>
              Disconnect
            </button>
          ) : null}
        </div>
      </header>

      <div className="main-body">
        <aside className="sidebar">
          <div className="sidebar-scrollable">
            <SignalBrowser
              telemetryRef={telemetryRef}
              selectedSignals={selectedLogSignals}
              onToggleSignal={handleToggleSignal}
            />
          </div>

          <div className="selection-summary">
            <div className="selection-chip">{selectedLogSignals.length} signals selected for new logs</div>
            <div className="selection-copy">
              Existing log sessions keep running on the Pi even if this app disconnects. Stop and start again to create a new file.
            </div>
            {currentLogFile ? <div className="selection-copy">Current file: {currentLogFile}</div> : null}
          </div>

          <div className="log-button-container">
            <div className="log-name-panel">
              <label className="log-name-label" htmlFor="log-name-input">Next log filename</label>
              <input
                id="log-name-input"
                className="log-name-input"
                type="text"
                value={logFilenameInput}
                onChange={(event) => setLogFilenameInput(event.target.value)}
                placeholder="BFR_Test_Day_Run_01"
                disabled={isLogging || isTogglingLog}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <div className="log-name-hint">
                {sanitizedPreviewFilename
                  ? `Will save as ${sanitizedPreviewFilename}.csv`
                  : 'Leave blank to use the automatic timestamp-based filename.'}
              </div>
            </div>
            <button
              className={`btn-log ${isLogging ? 'is-logging' : ''}`}
              onClick={handleToggleLogging}
              disabled={(!targetIp && !isConnected) || isTogglingLog}
            >
              <div className="btn-log-content">
                <span className={`log-indicator ${isLogging ? 'recording' : ''}`} />
                {isTogglingLog ? 'WORKING...' : isLogging ? 'STOP LOGGING' : 'START LOGGING'}
              </div>
            </button>
            <div className="log-subtext">
              {isLogging
                ? 'Writing a dedicated CSV session and syncing each row to disk.'
                : 'New files use the selected signal set and 12-hour timestamp naming.'}
            </div>
          </div>
        </aside>

        <main className="main-content">
          <div className="workspace-toolbar glass">
            <div className="tab-strip">
              <button
                className={`tab-button ${activeView === 'live' ? 'active' : ''}`}
                onClick={() => setActiveView('live')}
              >
                Live Dashboard
              </button>
              <button
                className={`tab-button ${activeView === 'logs' ? 'active' : ''}`}
                onClick={() => setActiveView('logs')}
              >
                Log Viewer
              </button>
            </div>
            <div className="toolbar-actions">
              <button className="toolbar-button" onClick={() => connect(ipAddress || targetIp)} disabled={!ipAddress && !targetIp}>
                Retry Link
              </button>
              <button className="toolbar-button" onClick={() => setActiveView(activeView === 'live' ? 'logs' : 'live')}>
                {activeView === 'live' ? 'Open Logs' : 'Back To Live'}
              </button>
            </div>
          </div>

          <div className="workspace-content">
            {activeView === 'live' ? (
              <div className="dashboard-scroll">
                <section className="chassis-atlas glass">
                  <div className="chassis-atlas-header">
                    <div>
                      <span className="atlas-kicker">Chassis Atlas</span>
                      <h3>Corner telemetry wrapped around the car</h3>
                      <p>SDU suspension and brake signals stay attached to each wheel, while TSPMU and TSHMU stay in their own board-level panels for MDU-style consistency.</p>
                    </div>
                    <div className="atlas-center-readout">
                      <div className="atlas-center-pill">
                        <span>TSHMU Flow 1</span>
                        <strong>{formatValue(tshmu.flow1, 1)} L/min</strong>
                      </div>
                      <div className="atlas-center-pill">
                        <span>TSHMU Flow 2</span>
                        <strong>{formatValue(tshmu.flow2, 1)} L/min</strong>
                      </div>
                    </div>
                  </div>

                  <div className="chassis-atlas-grid">
                    {cornerCards.map((corner) => (
                      <article
                        key={corner.pos}
                        className={`corner-card corner-card-${corner.pos.toLowerCase()}`}
                      >
                        <div className="corner-card-header">
                          <div>
                            <span className="corner-tag">{corner.pos}</span>
                            <h4>{corner.pos === 'FL' ? 'Front Left' : corner.pos === 'FR' ? 'Front Right' : corner.pos === 'RL' ? 'Rear Left' : 'Rear Right'}</h4>
                          </div>
                          <div className="corner-wheel-speed">
                            <span>Wheel</span>
                            <strong>{formatValue(corner.wheel, 0)} RPM</strong>
                          </div>
                        </div>

                        <div className="corner-card-metrics">
                          <div className="corner-metric">
                            <span>Shock</span>
                            <strong>{formatValue(corner.shock, 2)} mm</strong>
                          </div>
                          <div className="corner-metric">
                            <span>Brake</span>
                            <strong>{formatValue(corner.brake, 1)} °C</strong>
                          </div>
                          <div className="corner-metric">
                            <span>Tire Max</span>
                            <strong>{formatValue(corner.tireMax, 0)} °C</strong>
                          </div>
                          <div className="corner-metric">
                            <span>Tire Ctr</span>
                            <strong>{formatValue(corner.tireCtr, 0)} °C</strong>
                          </div>
                        </div>

                        <div className="corner-card-footer">
                          <span>Ambient {formatValue(corner.tireAmb, 0)} °C</span>
                          <span>Min {formatValue(corner.tireMin, 0)} °C</span>
                          <span>Peak {formatValue(corner.tireMax, 0)} °C</span>
                        </div>
                      </article>
                    ))}

                    <div className="car-silhouette-shell">
                      <div className="car-silhouette-glow" />
                      <div className="car-silhouette">
                        <div className="car-nose" />
                        <div className="car-cockpit" />
                        <div className="car-body-core" />
                        <div className="car-rear" />
                        <div className="car-wing car-wing-front" />
                        <div className="car-wing car-wing-rear" />
                        <div className="car-wheel car-wheel-fl" />
                        <div className="car-wheel car-wheel-fr" />
                        <div className="car-wheel car-wheel-rl" />
                        <div className="car-wheel car-wheel-rr" />
                      </div>

                      <div className="car-overlay">
                        <div className="car-overlay-pill">
                          <span>Live bus</span>
                          <strong>{isConnected ? 'LOCKED' : 'SEARCHING'}</strong>
                        </div>
                        <div className="car-overlay-pill">
                          <span>Parse</span>
                          <strong>{liveData?.stats?.parsed || 0}</strong>
                        </div>
                        <div className="car-overlay-pill">
                          <span>Errors</span>
                          <strong>{liveData?.stats?.errors || 0}</strong>
                        </div>
                        <div className="car-overlay-pill">
                          <span>Bytes/s</span>
                          <strong>{formatBytesPerSecond(liveData?.stats?.bytes_per_sec || 0)}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="aux-board-rack">
                    <section className="aux-board-panel">
                      <div className="aux-board-header">
                        <span className="atlas-kicker">TSPMU</span>
                        <h4>Pressure / temp boards</h4>
                        <p>Shown by board ID for consistency with the MDU decoder. We are not force-mapping these onto corners.</p>
                      </div>
                      <div className="aux-board-grid">
                        {tspmuBoards.map((board) => {
                          const maxTemp = Math.max(...board.temps.map(value => Number(value) || 0));
                          const minTemp = Math.min(...board.temps.map(value => Number(value) || 0));
                          return (
                            <article key={board.boardId} className="aux-board-card">
                              <div className="aux-board-title">
                                <span>Board {board.boardId}</span>
                                <strong>P1 {formatValue(board.pressure1, 2)} • P2 {formatValue(board.pressure2, 2)}</strong>
                              </div>
                              <div className="aux-board-temps">
                                {board.temps.map((temp, tempIndex) => (
                                  <span key={tempIndex}>T{tempIndex + 1} {formatValue(temp, 1)} °C</span>
                                ))}
                              </div>
                              <div className="aux-board-footer">
                                <span>Max {formatValue(maxTemp, 1)} °C</span>
                                <span>Min {formatValue(minTemp, 1)} °C</span>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>

                    <section className="aux-board-panel aux-board-panel-flow">
                      <div className="aux-board-header">
                        <span className="atlas-kicker">TSHMU</span>
                        <h4>Flow monitor</h4>
                        <p>Rendered from the same board packet layout we decode on the backend.</p>
                      </div>
                      <div className="flow-readout-grid">
                        <div className="flow-readout-card">
                          <span>Flow 1</span>
                          <strong>{formatValue(tshmu.flow1, 1)} L/min</strong>
                        </div>
                        <div className="flow-readout-card">
                          <span>Flow 2</span>
                          <strong>{formatValue(tshmu.flow2, 1)} L/min</strong>
                        </div>
                        <div className="flow-readout-card">
                          <span>Jitter</span>
                          <strong>{formatValue(tshmu.jitter_us, 0)} us</strong>
                        </div>
                        <div className="flow-readout-card">
                          <span>Error Flags</span>
                          <strong>{formatValue(tshmu.error_flags, 0)}</strong>
                        </div>
                      </div>
                      <div className="aux-board-temps" style={{ marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <span>V1: {formatValue(tshmu.temp1, 3)} V</span>
                        <span>V2: {formatValue(tshmu.temp2, 3)} V</span>
                        <span>V3: {formatValue(tshmu.temp3, 3)} V</span>
                        <span>V4: {formatValue(tshmu.temp4, 3)} V</span>
                        <span>V5: {formatValue(tshmu.temp5, 3)} V</span>
                        <span>V6: {formatValue(tshmu.temp6, 3)} V</span>
                      </div>
                    </section>
                  </div>
                </section>

                <div className="plot-grid">
                  {liveChartGroups.map((group) => (
                    <SignalPlot
                      key={group.id}
                      title={group.title}
                      signalIds={group.signals}
                      historyRef={historyRef}
                      isConnected={isConnected}
                      emptyMessage="Waiting for live telemetry..."
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '16px', minHeight: '460px', flexWrap: 'wrap' }}>
                  <section className={`map-shell glass map-shell-${mapPanelSize}`} style={{ minHeight: '460px' }}>
                    <div className="map-shell-header">
                      <div>
                        <h3>Track Map</h3>
                        <p>GPS stays live here while the grouped plots handle the powertrain and chassis signals.</p>
                      </div>
                      <div className="map-size-controls">
                        <button
                          className={`map-size-button ${mapPanelSize === 'balanced' ? 'active' : ''}`}
                          onClick={() => setMapPanelSize('balanced')}
                        >
                          Balanced
                        </button>
                        <button
                          className={`map-size-button ${mapPanelSize === 'wide' ? 'active' : ''}`}
                          onClick={() => setMapPanelSize('wide')}
                        >
                          Wide
                        </button>
                        <button
                          className={`map-size-button ${mapPanelSize === 'focus' ? 'active' : ''}`}
                          onClick={() => setMapPanelSize('focus')}
                        >
                          Focus
                        </button>
                      </div>
                    </div>
                    <div className="map-shell-body">
                      <MapViewer telemetryRef={telemetryRef} isConnected={isConnected} />
                    </div>
                  </section>

                  <section className={`gforce-shell glass gforce-shell-${mapPanelSize}`} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', borderRadius: '18px', minHeight: '460px', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: '100%', textAlign: 'center', marginBottom: '8px' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>G-Force Meter</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '4px 0 0' }}>Real-time acceleration vector</p>
                    </div>
                    
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                      <div className="g-meter-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '14px', border: '1px solid var(--border-color)', width: '100%', maxWidth: '220px' }}>
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '8px', letterSpacing: '0.06em' }}>G-Force (2.0G)</span>
                        <svg className="g-meter-svg" width="140" height="140" viewBox="0 0 100 100" style={{ display: 'block', overflow: 'visible' }}>
                          {/* Circular borders representing G zones */}
                          <circle cx="50" cy="50" r="50" fill="none" stroke="var(--text-secondary)" strokeOpacity="0.3" strokeWidth="1.5"></circle>
                          <circle cx="50" cy="50" r="25" fill="none" stroke="var(--text-secondary)" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2,2"></circle>
                          
                          {/* Crosshair axes */}
                          <line x1="0" y1="50" x2="100" y2="50" stroke="var(--text-secondary)" strokeOpacity="0.3" strokeWidth="1"></line>
                          <line x1="50" y1="0" x2="50" y2="100" stroke="var(--text-secondary)" strokeOpacity="0.3" strokeWidth="1"></line>
                          
                          {/* Labels for directions */}
                          <text x="50" y="8" text-anchor="middle" fill="var(--text-secondary)" fillOpacity="0.8" fontWeight="600" fontSize="8" fontFamily="sans-serif">F</text>
                          <text x="50" y="98" text-anchor="middle" fill="var(--text-secondary)" fillOpacity="0.8" fontWeight="600" fontSize="8" fontFamily="sans-serif">B</text>
                          <text x="6" y="53" text-anchor="start" fill="var(--text-secondary)" fillOpacity="0.8" fontWeight="600" fontSize="8" fontFamily="sans-serif">L</text>
                          <text x="94" y="53" text-anchor="end" fill="var(--text-secondary)" fillOpacity="0.8" fontWeight="600" fontSize="8" fontFamily="sans-serif">R</text>

                          {/* COG G position indicator dot (Cyan) */}
                          <circle cx={cogCoords.cx.toFixed(1)} cy={cogCoords.cy.toFixed(1)} r="4.5" fill="var(--accent-primary)" stroke="#ffffff" strokeWidth="0.75" strokeOpacity="0.6" style={{ filter: 'drop-shadow(0 0 5px var(--accent-primary))', transition: 'cx 60ms ease, cy 60ms ease', opacity: imusArray[0]?.valid ? 1 : 0.18 }}></circle>

                          {/* Front G position indicator dot (Emerald Green) */}
                          <circle cx={frontCoords.cx.toFixed(1)} cy={frontCoords.cy.toFixed(1)} r="4.5" fill="var(--accent-success)" stroke="#ffffff" strokeWidth="0.75" strokeOpacity="0.6" style={{ filter: 'drop-shadow(0 0 5px var(--accent-success))', transition: 'cx 60ms ease, cy 60ms ease', opacity: imusArray[1]?.valid ? 1 : 0.18 }}></circle>

                          {/* Rear G position indicator dot (Sunset Red) */}
                          <circle cx={rearCoords.cx.toFixed(1)} cy={rearCoords.cy.toFixed(1)} r="4.5" fill="var(--accent-danger)" stroke="#ffffff" strokeWidth="0.75" strokeOpacity="0.6" style={{ filter: 'drop-shadow(0 0 5px var(--accent-danger))', transition: 'cx 60ms ease, cy 60ms ease', opacity: imusArray[2]?.valid ? 1 : 0.18 }}></circle>
                        </svg>

                        {/* Inline color legend with individual magnitudes */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '14px', fontSize: '0.75rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-primary)', boxShadow: '0 0 4px var(--accent-primary)' }} />
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>COG</span>
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: imusArray[0]?.valid ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {imusArray[0]?.valid ? `${cogCoords.gMag.toFixed(2)} G` : 'No data'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-success)', boxShadow: '0 0 4px var(--accent-success)' }} />
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Front</span>
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: imusArray[1]?.valid ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {imusArray[1]?.valid ? `${frontCoords.gMag.toFixed(2)} G` : 'No data'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-danger)', boxShadow: '0 0 4px var(--accent-danger)' }} />
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Rear</span>
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: imusArray[2]?.valid ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                              {imusArray[2]?.valid ? `${rearCoords.gMag.toFixed(2)} G` : 'No data'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style={{ width: '100%', display: 'grid', gap: '8px', fontSize: '0.78rem' }}>
                      {imusArray.map((imu, index) => (
                        <div key={imuLabels[index]} style={{ display: 'flex', justifyContent: 'space-between', color: imu?.valid ? 'var(--text-secondary)' : 'var(--accent-warning)' }}>
                          <span>{imuLabels[index]} IMU</span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{imu?.valid ? 'LIVE' : 'MISSING'}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            ) : (
              <LogViewer
                isConnected={isConnected}
                fetchLogs={fetchLogs}
                fetchLogFile={fetchLogFile}
              />
            )}
          </div>

          <div className={`lost-overlay ${!isConnected && activeView === 'live' ? 'visible' : ''}`}>
            <div className="connect-modal glass">
              <h2>Telemetry Link</h2>
              <p>{connectionMessage}</p>

              <div className="connection-section">
                <h3>Wi-Fi & Network Connection</h3>
                <p>Use the last known IP, enter one manually, or run autoscan.</p>
                <div className="connect-form">
                  <button
                    className={`btn-scan ${isScanning ? 'scanning' : ''}`}
                    onClick={handleAutoScan}
                    disabled={isScanning}
                  >
                    {isScanning ? 'SCANNING...' : 'AUTOSCAN'}
                  </button>
                  <input
                    type="text"
                    value={ipAddress}
                    onChange={event => setIpAddress(event.target.value)}
                    placeholder="192.168.1.50"
                    className="ip-input"
                    onKeyDown={event => event.key === 'Enter' && connect(ipAddress)}
                  />
                  <button className="btn-connect" onClick={() => connect(ipAddress)} disabled={!ipAddress}>
                    CONNECT
                  </button>
                </div>
                <div className="connect-hint">Reconnects are automatic after a link drop, but you can always force a fresh connect here.</div>
              </div>

              {window.electronAPI ? (
                <div className="connection-section serial-section">
                  <h3>Direct Serial Backup</h3>
                  <p>Use this when Wi-Fi is ugly and you still want live telemetry.</p>
                  <div className="connect-form serial-form">
                    <select
                      className="serial-select"
                      value={selectedPort}
                      onChange={event => setSelectedPort(event.target.value)}
                      onClick={fetchSerialPorts}
                    >
                      {serialPorts.length === 0 ? (
                        <option value="">No Serial Ports Found</option>
                      ) : (
                        serialPorts.map(port => (
                          <option key={port.path} value={port.path}>{port.path}</option>
                        ))
                      )}
                    </select>
                    <button
                      className="btn-connect btn-serial"
                      onClick={() => connectSerial(selectedPort)}
                      disabled={!selectedPort}
                    >
                      SERIAL LINK
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
