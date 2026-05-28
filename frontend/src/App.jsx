import { useEffect, useState } from 'react';
import { useTelemetry } from './useTelemetry';
import TelemetryChart from './components/TelemetryChart';
import MapViewer from './components/MapViewer';
import SignalBrowser from './components/SignalBrowser';
import './index.css';

function App() {
  const { isConnected, isLogging, telemetryRef, toggleLogging } = useTelemetry();
  
  // Real-time metric extraction for the top metric cards
  // We use requestAnimationFrame to update these values at screen refresh rate
  // without triggering a full React re-render of the massive charts.
  const [liveMetrics, setLiveMetrics] = useState({ soc: 0, packV: 0, speed: 0, steering: 0 });

  // Manage dynamic chart subscriptions
  const [selectedSignals, setSelectedSignals] = useState(['inv.rpm', 'bms.v']);

  const handleToggleSignal = (signalId) => {
    setSelectedSignals(prev => 
      prev.includes(signalId) 
        ? prev.filter(id => id !== signalId) 
        : [...prev, signalId]
    );
  };

  useEffect(() => {
    let animationFrame;
    const updateMetrics = () => {
      const data = telemetryRef.current;
      if (data) {
        setLiveMetrics({
          soc: data.bms.soc,
          packV: data.bms.v,
          speed: data.inv.rpm,
          steering: data.sdu[0].shock // just a placeholder since we don't have steering
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
          <h1>Bruin Racing Telemetry</h1>
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
          <div className="status-item">
            <div className={`status-dot ${isConnected ? 'active' : 'disconnected'}`}></div>
            {isConnected ? 'LINK ACTIVE' : 'LINK LOST'}
          </div>
          <div className="status-item">
            <div className={`status-dot ${isLogging ? 'danger' : 'disconnected'}`}></div>
            {isLogging ? 'LOGGING 30s RAM' : 'STANDBY'}
          </div>
        </div>
      </header>

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
            {isLogging ? 'Stop Logging' : 'Start Logging'}
          </button>
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

        {/* DISCONNECT OVERLAY */}
        <div className={`lost-overlay ${!isConnected ? 'visible' : ''}`}>
          <h2>LINK LOST</h2>
          <p>CAR ON TRACK</p>
        </div>
      </main>
    </div>
  );
}

export default App;
