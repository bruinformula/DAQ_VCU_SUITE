import { useEffect, useState } from 'react';
import { useTelemetry } from './useTelemetry';
import TelemetryChart from './components/TelemetryChart';
import MapViewer from './components/MapViewer';
import SignalBrowser from './components/SignalBrowser';
import './index.css';

function App() {
  const { isConnected, isLogging, telemetryRef, toggleLogging, connect, connectSerial, disconnect } = useTelemetry();
  
  const [liveMetrics, setLiveMetrics] = useState({ soc: 0, packV: 0, speed: 0, steering: 0 });
  const [selectedSignals, setSelectedSignals] = useState(['inv.rpm', 'bms.v']);
  const [ipAddress, setIpAddress] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  
  // Serial Backup State
  const [serialPorts, setSerialPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');

  const handleToggleSignal = (signalId) => {
    setSelectedSignals(prev => 
      prev.includes(signalId) 
        ? prev.filter(id => id !== signalId) 
        : [...prev, signalId]
    );
  };

  const fetchSerialPorts = async () => {
    if (window.electronAPI) {
      const ports = await window.electronAPI.getSerialPorts();
      setSerialPorts(ports);
      if (ports.length > 0 && !selectedPort) {
        setSelectedPort(ports[0].path);
      }
    }
  };

  const handleAutoScan = async () => {
    if (!window.electronAPI) {
      alert("Autoscan is only available in the desktop app.");
      return;
    }
    
    setIsScanning(true);
    try {
      const foundIp = await window.electronAPI.scanNetwork();
      if (foundIp) {
        setIpAddress(foundIp);
        connect(foundIp);
      } else {
        alert("No Raspberry Pi found on the local network (port 8000). Is it powered on and connected to the same Wi-Fi?");
      }
    } catch (err) {
      console.error(err);
      alert("Error scanning network.");
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    fetchSerialPorts();
  }, []);

  useEffect(() => {
    let animationFrame;
    const updateMetrics = () => {
      const data = telemetryRef.current;
      if (data && data.bms && data.inv) {
        setLiveMetrics({
          soc: data.bms.soc || 0,
          packV: data.bms.v || 0,
          speed: data.inv.rpm || 0,
          steering: data.sdu && data.sdu[0] ? data.sdu[0].shock : 0
        });
      }
      animationFrame = requestAnimationFrame(updateMetrics);
    };
    
    if (isConnected) {
      animationFrame = requestAnimationFrame(updateMetrics);
    }
    
    return () => cancelAnimationFrame(animationFrame);
  }, [isConnected, telemetryRef]);

  // Global Hotkey for Logging (Ctrl + Shift + L)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        toggleLogging();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleLogging]);

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="header glass">
        <div className="brand">
          <div className="brand-dot"></div>
          <h1>Bruin Formula Racing</h1>
        </div>
        
        {/* Dynamic Metric Cards in Header */}
        <div className="header-metrics">
          <div className="header-metric">
            <span className="hm-label">VOLTAGE</span>
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
        </div>

        <div className="status-indicators">
          {isConnected ? (
            <button className="btn-disconnect" onClick={disconnect}>
              Disconnect
            </button>
          ) : null}
          <div className="status-item">
            <div className={`status-dot ${isConnected ? 'active' : 'disconnected'}`}></div>
            {isConnected ? 'LINK ACTIVE' : 'OFFLINE'}
          </div>
        </div>
      </header>

      {/* MAIN BODY WRAPPER */}
      <div className="main-body">
        {/* SIDEBAR / SIGNAL BROWSER */}
        <aside className="sidebar">
          <div className="sidebar-scrollable">
            <SignalBrowser 
              telemetryRef={telemetryRef}
              selectedSignals={selectedSignals}
              onToggleSignal={handleToggleSignal}
            />
          </div>

          {/* LOGGING CONTROLS */}
          <div className="log-button-container">
            <button 
              className={`btn-log ${isLogging ? 'is-logging' : ''}`}
              onClick={toggleLogging}
              disabled={!isConnected}
            >
              <div className="btn-log-content">
                <span className={`log-indicator ${isLogging ? 'recording' : ''}`}></span>
                {isLogging ? 'RECORDING DATA...' : 'START LOGGING'}
              </div>
            </button>
            <div className="log-subtext">
              {isLogging ? 'Saving to Pi SD Card (30s buffer)' : 'Standby Mode'}
            </div>
          </div>
        </aside>

        {/* MAIN CONTENT AREA */}
        <main className="main-content">
          <div className="chart-container">
            <TelemetryChart 
              telemetryRef={telemetryRef} 
              isConnected={isConnected} 
              selectedSignals={selectedSignals} 
            />
          </div>
          <div className="map-container">
            <MapViewer telemetryRef={telemetryRef} isConnected={isConnected} />
          </div>

          {/* DISCONNECT / CONNECT OVERLAY */}
          <div className={`lost-overlay ${!isConnected ? 'visible' : ''}`}>
            <div className="connect-modal glass">
              <h2>Telemetry Link</h2>
              
              <div className="connection-section">
                <h3>Wi-Fi & Network Connection</h3>
                <p>Enter IP manually or Auto-Scan</p>
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
                    onChange={e => setIpAddress(e.target.value)} 
                    placeholder="192.168.1.50"
                    className="ip-input"
                    onKeyDown={e => e.key === 'Enter' && connect(ipAddress)}
                  />
                  <button className="btn-connect" onClick={() => connect(ipAddress)}>
                    CONNECT
                  </button>
                </div>
                <div className="connect-hint">Make sure Mac and Pi are on the same Wi-Fi</div>
              </div>

              {window.electronAPI && (
                <div className="connection-section serial-section">
                  <h3>Direct Serial Backup</h3>
                  <p>Connect over a physical USB UART cable</p>
                  <div className="connect-form serial-form">
                    <select 
                      className="serial-select" 
                      value={selectedPort} 
                      onChange={e => setSelectedPort(e.target.value)}
                      onClick={fetchSerialPorts}
                    >
                      {serialPorts.length === 0 ? (
                        <option value="">No COM Ports Found</option>
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
              )}

            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
