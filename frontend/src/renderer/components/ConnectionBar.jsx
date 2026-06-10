import React, { useState, useEffect } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { Wifi, WifiOff, FolderOpen, Play, Square, RefreshCw, Trash2, ArrowLeftRight, Activity, Download } from 'lucide-react';

export default function ConnectionBar() {
  const {
    isLiveMode,
    currentFilePath,
    folderPath,
    folderFiles,
    availablePorts,
    connectionState,
    diagnostics,
    logStatus,
    loadRunFile,
    selectDataFolder,
    scanFolder,
    connectSerial,
    disconnectSerial,
    startLogging,
    stopLogging,
    clearLiveSession,
    toggleLiveMode,

    // WiFi States/Handlers
    activeTransport,
    targetIp,
    wifiState,
    wifiMessage,
    isWifiLogging,
    wifiLogs,
    isScanningNetwork,
    connectWifi,
    disconnectWifi,
    toggleWifiLogging,
    fetchWifiLogs,
    fetchWifiLogFile,
    scanNetwork
  } = useTelemetry();

  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState('115200');
  const [ipInput, setIpInput] = useState(targetIp || '');
  const [remoteLogName, setRemoteLogName] = useState('');
  const [selectedWifiLog, setSelectedWifiLog] = useState('');
  const [isDownloadingWifiLog, setIsDownloadingWifiLog] = useState(false);
  const [parseProgress, setParseProgress] = useState(null);

  useEffect(() => {
    if (window.mduDebug?.onParseProgress) {
      return window.mduDebug.onParseProgress((percent) => {
        setParseProgress(percent);
      });
    }
  }, []);

  useEffect(() => {
    if (targetIp) {
      setIpInput(targetIp);
    }
  }, [targetIp]);

  useEffect(() => {
    if (wifiState === 'connected') {
      fetchWifiLogs().catch(err => console.error('Error fetching logs list:', err));
    }
  }, [wifiState]);

  const handleWifiConnect = () => {
    if (ipInput.trim()) {
      connectWifi(ipInput.trim());
    }
  };

  const handleToggleWifiLogging = async () => {
    try {
      await toggleWifiLogging([], remoteLogName.trim());
      if (!isWifiLogging) {
        setRemoteLogName('');
      }
    } catch (e) {
      alert(`Pi logging control failed: ${e.message}`);
    }
  };

  const handleDownloadWifiLog = async () => {
    if (!selectedWifiLog) return;
    const logObj = wifiLogs.find(l => l.token === selectedWifiLog);
    if (!logObj) return;
    setIsDownloadingWifiLog(true);
    try {
      await fetchWifiLogFile(logObj.token, logObj.filename);
      setSelectedWifiLog('');
      alert(`Successfully downloaded ${logObj.filename} to your local data folder!`);
    } catch (e) {
      alert(`Download failed: ${e.message}`);
    } finally {
      setIsDownloadingWifiLog(false);
    }
  };

  const handleConnect = async () => {
    let port = selectedPort;
    if (!port) {
      port = availablePorts.length > 1 ? 'all' : (availablePorts[0] && availablePorts[0].path);
    }
    if (!port) return;
    try {
      await connectSerial(port, baudRate);
    } catch (e) {
      alert(`Connection failed: ${e.message}`);
    }
  };

  const handleToggleLog = async () => {
    if (logStatus.active) {
      await stopLogging();
    } else {
      const result = await window.mduDebug.pickLogFile();
      if (result) {
        await startLogging(result);
      }
    }
  };

  // Format bytes
  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <header className="glass-panel no-hover" style={{
      margin: '0 0 1rem 0',
      padding: '0.75rem 1rem',
      borderRadius: '12px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '1rem',
      alignItems: 'center',
      justifyContent: 'space-between',
      border: '1px solid var(--border-color)',
      backgroundColor: 'rgba(25, 30, 45, 0.85)',
      backdropFilter: 'blur(10px)'
    }}>
      {/* Port connection & auto-connect */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {connectionState.connected ? (
            <Wifi className="text-emerald-500 animate-pulse" size={18} />
          ) : (
            <WifiOff className="text-slate-500" size={18} />
          )}
          <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>
            {connectionState.connected
              ? connectionState.port?.path === 'all'
                ? `All Ports (${connectionState.port?.displayName?.match(/\d+/)?.[0] ?? '?'})`
                : 'Connected'
              : 'Offline'}
          </span>
        </div>

        <select
          className="select-input"
          value={selectedPort || (connectionState.connected ? (connectionState.port?.path || '') : (availablePorts.length > 1 ? 'all' : (availablePorts[0]?.path || '')))}
          onChange={(e) => setSelectedPort(e.target.value)}
          disabled={connectionState.connected}
          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
        >
          {availablePorts.length === 0 && <option value="">No Ports Detected</option>}
          {availablePorts.length > 1 && (
            <option value="all">All USB CDC Ports ({availablePorts.length})</option>
          )}
          {availablePorts.map((p) => (
            <option key={p.path} value={p.path}>
              {p.displayName || p.path} {p.matchesTarget ? '★' : ''}
            </option>
          ))}
        </select>

        <select
          className="select-input"
          value={baudRate}
          onChange={(e) => setBaudRate(e.target.value)}
          disabled={connectionState.connected}
          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '90px' }}
        >
          <option value="9600">9600</option>
          <option value="115200">115200</option>
          <option value="230400">230400</option>
          <option value="460800">460800</option>
          <option value="921600">921600</option>
        </select>

        {connectionState.connected ? (
          <button className="button button-danger" onClick={disconnectSerial} style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>
            Disconnect
          </button>
        ) : (
          <button className="button button-success" onClick={handleConnect} disabled={availablePorts.length === 0} style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>
            Connect
          </button>
        )}

        <button className="button" onClick={clearLiveSession} title="Clear Live History" style={{ padding: '0.25rem', display: 'flex', alignItems: 'center' }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Wireless Telemetry Link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderLeft: '1px solid rgba(255, 255, 255, 0.1)', paddingLeft: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {wifiState === 'connected' ? (
            <Wifi className="text-cyan-400 animate-pulse" size={16} />
          ) : wifiState === 'connecting' || wifiState === 'reconnecting' ? (
            <Wifi className="text-amber-400 animate-pulse" size={16} />
          ) : (
            <WifiOff className="text-slate-500" size={16} />
          )}
          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
            {wifiState === 'connected' ? 'WiFi Active' : wifiState === 'connecting' ? 'Connecting...' : wifiState === 'reconnecting' ? 'Reconnecting...' : 'WiFi Link'}
          </span>
        </div>

        <input
          type="text"
          className="text-input"
          placeholder="Pi IP Address"
          value={ipInput}
          onChange={(e) => setIpInput(e.target.value)}
          disabled={wifiState === 'connected' || wifiState === 'connecting'}
          style={{
            padding: '0.2rem 0.4rem',
            fontSize: '0.8rem',
            width: '110px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: '#fff'
          }}
        />

        {wifiState === 'connected' || wifiState === 'connecting' || wifiState === 'reconnecting' ? (
          <button className="button button-danger" onClick={disconnectWifi} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>
            Disconnect
          </button>
        ) : (
          <>
            <button className="button button-success" onClick={handleWifiConnect} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}>
              Connect
            </button>
            <button className="button" onClick={scanNetwork} disabled={isScanningNetwork} title="Autoscan Network for Pi" style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}>
              <RefreshCw size={12} className={isScanningNetwork ? 'animate-spin' : ''} />
            </button>
          </>
        )}
      </div>

      {/* Pi Logging & Download Controls (Visible only when WiFi Connected) */}
      {wifiState === 'connected' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderLeft: '1px solid rgba(255, 255, 255, 0.1)', paddingLeft: '0.75rem' }}>
          <input
            type="text"
            className="text-input"
            placeholder="Next run name"
            value={remoteLogName}
            onChange={(e) => setRemoteLogName(e.target.value)}
            style={{
              padding: '0.2rem 0.4rem',
              fontSize: '0.8rem',
              width: '120px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              color: '#fff'
            }}
          />
          <button
            className={`button ${isWifiLogging ? 'button-danger' : 'button-success'}`}
            onClick={handleToggleWifiLogging}
            style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
          >
            {isWifiLogging ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
            <span>{isWifiLogging ? 'Stop Pi Log' : 'Start Pi Log'}</span>
          </button>

          {/* Pi Remote Logs Selector */}
          {wifiLogs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <select
                className="select-input"
                value={selectedWifiLog}
                onChange={(e) => setSelectedWifiLog(e.target.value)}
                style={{ padding: '0.2rem 0.4rem', fontSize: '0.8rem', maxWidth: '140px' }}
              >
                <option value="">-- Download Pi Log --</option>
                {wifiLogs.map((log) => (
                  <option key={log.token} value={log.token}>
                    {log.filename} ({formatBytes(log.size_bytes || log.size)})
                  </option>
                ))}
              </select>
              <button
                className="button"
                onClick={handleDownloadWifiLog}
                disabled={!selectedWifiLog || isDownloadingWifiLog}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <Download size={12} />
                <span>{isDownloadingWifiLog ? 'Downloading...' : 'Download'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Directory Scanner & Run Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button className="button" onClick={selectDataFolder} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
          <FolderOpen size={14} />
          <span>{folderPath ? 'Change Folder...' : 'Set Data Folder...'}</span>
        </button>

        {folderPath && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              className="select-input"
              value={!isLiveMode ? currentFilePath : ''}
              onChange={(e) => {
                if (e.target.value) {
                  loadRunFile(e.target.value);
                }
              }}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', maxW: '200px' }}
            >
              <option value="">-- Select Saved Run --</option>
              {folderFiles.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)
                </option>
              ))}
            </select>
            <button className="button" onClick={scanFolder} title="Rescan Folder" style={{ padding: '0.25rem', display: 'flex', alignItems: 'center' }}>
              <RefreshCw size={14} />
            </button>
            <button 
              className="button" 
              title="Parse Raw CAN Log into Timeline CSV"
              onClick={async () => {
                try {
                  const filePath = await window.mduDebug.openFile();
                  if (filePath) {
                    if (!filePath.toLowerCase().includes('_can')) {
                      if (!confirm('This file does not appear to be a raw _CAN.csv log. Parse anyway?')) return;
                    }
                    const btn = document.getElementById('parse-can-btn-icon');
                    if(btn) btn.classList.add('animate-spin');
                    setParseProgress(0);
                    const outPath = await window.mduDebug.parseCanLogPython(filePath);
                    setParseProgress(null);
                    if(btn) btn.classList.remove('animate-spin');
                    alert(`Successfully parsed and saved to:\n${outPath}`);
                    scanFolder();
                  }
                } catch (e) {
                  const btn = document.getElementById('parse-can-btn-icon');
                  if(btn) btn.classList.remove('animate-spin');
                  setParseProgress(null);
                  alert(`Parse failed: ${e.message}`);
                }
              }} 
              style={{ padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}
            >
              <RefreshCw size={14} id="parse-can-btn-icon" />
              <span>Parse Raw CAN</span>
            </button>
            {parseProgress !== null && (
              <span style={{ fontSize: '0.8rem', color: '#10b981', fontWeight: 'bold' }}>
                {parseProgress.toFixed(0)}%
              </span>
            )}
          </div>
        )}

        {/* Playback mode indicators */}
        {!isLiveMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{
              backgroundColor: 'var(--color-info)',
              color: '#000',
              padding: '0.15rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontWeight: 'bold'
            }}>
              PLAYBACK
            </span>
            <button className="button button-success" onClick={toggleLiveMode} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
              <ArrowLeftRight size={14} />
              <span>Go Live</span>
            </button>
          </div>
        )}
      </div>

      {/* Logging controller */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          className={`button ${logStatus.active ? 'button-danger' : ''}`}
          onClick={handleToggleLog}
          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
        >
          {logStatus.active ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
          <span>{logStatus.active ? 'Stop Log' : 'Start Log'}</span>
        </button>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <div>
            Bytes: <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{formatBytes(diagnostics.totalBytes || 0)}</span>
          </div>
          <div>
            Frames: <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{diagnostics.totalFrames || 0}</span>
          </div>
          {logStatus.active && (
            <div style={{ color: '#ef4444', animation: 'pulse 2s infinite' }}>
              REC: <span style={{ fontWeight: 'bold' }}>{logStatus.linesWritten} lines</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
