import { useEffect, useState } from 'react';
import { useTelemetry } from './useTelemetry';
import TelemetryChart from './components/TelemetryChart';
import MapViewer from './components/MapViewer';
import './index.css';

function App() {
  const { isConnected, isLogging, telemetryRef, toggleLogging } = useTelemetry();
  
  // Real-time metric extraction for the BMS Drawer values
  // We use requestAnimationFrame to update these values at screen refresh rate
  // without triggering a full React re-render of the massive charts.
  const [liveMetrics, setLiveMetrics] = useState({ soc: 0, packV: 0, speed: 0, steering: 0 });

  useEffect(() => {
    let animationFrame;
    const updateMetrics = () => {
      const data = telemetryRef.current;
      setLiveMetrics({
        soc: data.can.Pack_SOC,
        packV: data.can.Pack_Summed_Voltage,
        speed: data.can.INV_Motor_Speed,
        steering: data.mdu.steering_angle
      });
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

      {/* SIDEBAR / BMS DRAWER */}
      <aside className="sidebar">
        <div className="bms-drawer">
          <h2>Live Metrics</h2>
          
          <div className="metric-card">
            <div className="metric-header">Pack Voltage</div>
            <div className="metric-value">
              {liveMetrics.packV.toFixed(1)} <span className="metric-unit">V</span>
            </div>
          </div>
          
          <div className="metric-card">
            <div className="metric-header">State of Charge</div>
            <div className="metric-value">
              {liveMetrics.soc} <span className="metric-unit">%</span>
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-header">Motor Speed</div>
            <div className="metric-value">
              {liveMetrics.speed} <span className="metric-unit">RPM</span>
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-header">Steering Angle</div>
            <div className="metric-value">
              {liveMetrics.steering.toFixed(1)} <span className="metric-unit">°</span>
            </div>
          </div>
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
          {/* We pass the mutable ref down to the chart so it can poll at 60Hz natively */}
          <TelemetryChart telemetryRef={telemetryRef} isConnected={isConnected} />
        </div>
        <div className="map-container">
          <MapViewer />
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
