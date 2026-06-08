import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Settings, RefreshCw, Trash2, FolderOpen } from 'lucide-react';

export default function DeployFirmware() {
  const [bfrPath, setBfrPath] = useState('');
  const [bfrDetected, setBfrDetected] = useState(false);
  const [boards, setBoards] = useState({});
  const [selectedBoard, setSelectedBoard] = useState('mdu');
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState([]);
  const consoleEndRef = useRef(null);

  // Load BFR CLI configurations on mount
  useEffect(() => {
    window.mduDebug.getBfrConfig().then((config) => {
      setBfrPath(config.bfrPath || '');
      setBfrDetected(config.detected || false);
      setBoards(config.boards || {});
      
      // Select first board key
      const keys = Object.keys(config.boards || {});
      if (keys.length > 0) {
        setSelectedBoard(keys[0]);
      }
    });

    // Subscribe to deploy logs
    const unsubDeployLog = window.mduDebug.onDeployLog((log) => {
      setConsoleLogs((prev) => [...prev, log]);
    });

    return () => {
      unsubDeployLog();
    };
  }, []);

  // Auto scroll deploy console
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLogs]);

  const handleAction = async (action) => {
    setIsDeploying(true);
    // Clear logs for new action
    setConsoleLogs([{ type: 'stdout', text: `\x1B[1;35m[GUI] Starting action '${action}' for ${selectedBoard}...\x1B[0m\n` }]);
    
    try {
      const result = await window.mduDebug.deployBoard(action, selectedBoard, selectedBoardId);
      if (result.success) {
        setConsoleLogs((prev) => [...prev, { type: 'stdout', text: `\n\x1B[1;32m[GUI] SUCCESS: Action '${action}' completed successfully.\x1B[0m\n` }]);
      } else {
        setConsoleLogs((prev) => [...prev, { type: 'stderr', text: `\n\x1B[1;31m[GUI] ERROR: Action '${action}' failed with code ${result.code}.\x1B[0m\n` }]);
      }
    } catch (e) {
      setConsoleLogs((prev) => [...prev, { type: 'stderr', text: `\n\x1B[1;31m[GUI] EXCEPTION: ${e.message}\x1B[0m\n` }]);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleKill = async () => {
    await window.mduDebug.stopDeploy();
    setIsDeploying(false);
  };

  const handleSetup = async () => {
    setIsDeploying(true);
    setConsoleLogs([{ type: 'stdout', text: `\x1B[1;35m[GUI] Running BFR setup script...\x1B[0m\n` }]);
    try {
      await window.mduDebug.runSetupScript();
      setConsoleLogs((prev) => [...prev, { type: 'stdout', text: `\n\x1B[1;32m[GUI] Setup complete.\x1B[0m\n` }]);
    } catch (e) {
      setConsoleLogs((prev) => [...prev, { type: 'stderr', text: `\n\x1B[1;31m[GUI] Setup failed: ${e.message}\x1B[0m\n` }]);
    } finally {
      setIsDeploying(false);
    }
  };

  const currentBoardInfo = boards[selectedBoard] || {};

  // Simple ANSI code parsing to HTML colors
  const parseAnsiText = (text) => {
    if (!text) return '';
    // Replace standard formatting codes
    const parts = text.split(/\x1B\[/);
    if (parts.length === 1) return text;

    const elements = [];
    elements.push(parts[0]);

    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const match = p.match(/^([0-9;]*)([a-zA-Z])([\s\S]*)$/);
      if (!match) {
        elements.push(p);
        continue;
      }

      const codes = match[1].split(';');
      const char = match[2];
      const content = match[3];

      let style = {};
      if (char === 'm') {
        // Font styles
        codes.forEach(c => {
          const num = parseInt(c, 10);
          if (num === 1) style.fontWeight = 'bold';
          if (num === 31) style.color = '#ef4444'; // Red
          if (num === 32) style.color = '#10b981'; // Green
          if (num === 33) style.color = '#f59e0b'; // Yellow
          if (num === 34) style.color = '#3b82f6'; // Blue
          if (num === 35) style.color = '#d946ef'; // Magenta
          if (num === 36) style.color = '#06b6d4'; // Cyan
          if (num === 37) style.color = '#f8fafc'; // White
          if (num === 90) style.color = '#64748b'; // Gray
        });
      }

      elements.push(
        <span key={i} style={style}>
          {content}
        </span>
      );
    }

    return elements;
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1rem', height: 'calc(100vh - 180px)' }}>
      {/* Control Panel */}
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem', borderRadius: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Deploy Settings</h3>
        
        {/* CLI Status */}
        <div style={{
          padding: '0.5rem',
          borderRadius: '6px',
          backgroundColor: bfrDetected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${bfrDetected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
          fontSize: '0.75rem'
        }}>
          <div>
            CLI Status:{' '}
            <span style={{ fontWeight: 'bold', color: bfrDetected ? '#10b981' : '#ef4444' }}>
              {bfrDetected ? 'Detected' : 'Not Found'}
            </span>
          </div>
          <div style={{ marginTop: '0.25rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
            Path: {bfrPath || 'Unavailable'}
          </div>
        </div>

        {/* Board Selection */}
        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
            Target Board
          </label>
          <select
            className="select-input"
            value={selectedBoard}
            onChange={(e) => {
              setSelectedBoard(e.target.value);
              setSelectedBoardId('');
            }}
            disabled={isDeploying}
            style={{ width: '100%' }}
          >
            {Object.entries(boards).map(([key, info]) => (
              <option key={key} value={key}>
                {info.name || key.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {/* Board ID Selection */}
        {currentBoardInfo.board_id_var && currentBoardInfo.ids && currentBoardInfo.ids.length > 0 && (
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
              Board ID ({currentBoardInfo.board_id_var})
            </label>
            <select
              className="select-input"
              value={selectedBoardId}
              onChange={(e) => setSelectedBoardId(e.target.value)}
              disabled={isDeploying}
              style={{ width: '100%' }}
            >
              <option value="">-- Build All --</option>
              {currentBoardInfo.ids.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Repo Directory */}
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <div>Repository Path:</div>
          <div style={{ color: 'var(--text-primary)', wordBreak: 'break-all', fontWeight: '500', marginTop: '0.15rem' }}>
            {currentBoardInfo.path || 'Not registered'}
          </div>
        </div>

        <hr style={{ border: '0', borderTop: '1px solid var(--border-color)', margin: '0.5rem 0' }} />

        {/* Action Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <button
            className="button"
            onClick={() => handleAction('clean')}
            disabled={isDeploying}
            style={{ padding: '0.5rem' }}
          >
            Clean
          </button>
          <button
            className="button"
            onClick={() => handleAction('build')}
            disabled={isDeploying}
            style={{ padding: '0.5rem' }}
          >
            Build
          </button>
          <button
            className="button"
            onClick={() => handleAction('flash')}
            disabled={isDeploying}
            style={{ padding: '0.5rem' }}
          >
            Flash
          </button>
          <button
            className="button button-success"
            onClick={() => handleAction('deploy')}
            disabled={isDeploying}
            style={{ padding: '0.5rem' }}
          >
            Deploy
          </button>
        </div>

        {/* Compile Kill Button */}
        {isDeploying && (
          <button
            className="button button-danger"
            onClick={handleKill}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.5rem' }}
          >
            <Square size={14} fill="currentColor" />
            <span>Stop Operation</span>
          </button>
        )}

        {/* CLI Setup */}
        <div style={{ marginTop: 'auto' }}>
          <button
            className="button"
            onClick={handleSetup}
            disabled={isDeploying}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.5rem', width: '100%' }}
          >
            <RefreshCw size={14} />
            <span>Run CLI Setup Script</span>
          </button>
        </div>
      </div>

      {/* Terminal View */}
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: '100%', borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.9rem' }}>Deploy Output Console</h3>
          <button
            className="button"
            onClick={() => setConsoleLogs([])}
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <Trash2 size={12} />
            <span>Clear Output</span>
          </button>
        </div>

        <div style={{
          flex: 1,
          backgroundColor: '#090d16',
          color: '#e2e8f0',
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
          fontSize: '0.8rem',
          padding: '0.75rem',
          borderRadius: '8px',
          overflowY: 'auto',
          border: '1px solid var(--border-color)',
          lineHeight: '1.4'
        }}>
          {consoleLogs.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', padding: '1rem' }}>
              Console idle. Click an action to start building or deploy.
            </div>
          ) : (
            consoleLogs.map((log, idx) => (
              <div key={idx} style={{ color: log.type === 'stderr' ? '#f87171' : 'inherit', whiteSpace: 'pre' }}>
                {parseAnsiText(log.text)}
              </div>
            ))
          )}
          <div ref={consoleEndRef} />
        </div>
      </div>
    </div>
  );
}
