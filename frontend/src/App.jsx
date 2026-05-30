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
];

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
  });
  const [selectedLogSignals, setSelectedLogSignals] = useState(DEFAULT_LOG_SIGNALS);
  const [ipAddress, setIpAddress] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isTogglingLog, setIsTogglingLog] = useState(false);
  const [activeView, setActiveView] = useState('live');
  const [serialPorts, setSerialPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');

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
      await toggleLogging(selectedLogSignals);
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
                <section className="map-shell glass">
                  <div className="map-shell-header">
                    <h3>Track Map</h3>
                    <p>GPS stays live here while the grouped plots handle the powertrain and chassis signals.</p>
                  </div>
                  <div className="map-shell-body">
                    <MapViewer telemetryRef={telemetryRef} isConnected={isConnected} />
                  </div>
                </section>
              </div>
            ) : (
              <LogViewer
                isConnected={isConnected}
                fetchLogs={fetchLogs}
                fetchLogFile={fetchLogFile}
              />
            )}
          </div>

          <div className={`lost-overlay ${!isConnected ? 'visible' : ''}`}>
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
