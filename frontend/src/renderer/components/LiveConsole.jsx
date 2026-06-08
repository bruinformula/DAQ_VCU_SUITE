import React, { useState, useEffect, useRef } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { Search, Play, Pause, Trash2, Filter, ShieldAlert, Activity, Sliders } from 'lucide-react';
import LiveDashboard from './LiveDashboard';

export default function LiveConsole() {
  const { connectionState, diagnostics } = useTelemetry();
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [boardFilter, setBoardFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [isPaused, setIsPaused] = useState(false);
  const logEndRef = useRef(null);

  const [activeView, setActiveView] = useState('dashboard'); // 'console' or 'dashboard'

  // Monitor incoming frames in real-time (batched)
  useEffect(() => {
    const unsubFrames = window.mduDebug.onFrames((newFrames) => {
      if (isPaused) return;
      if (!newFrames || newFrames.length === 0) return;
      
      setLogs((prev) => {
        const next = [...prev, ...newFrames];
        if (next.length > 500) {
          return next.slice(next.length - 500);
        }
        return next;
      });
    });

    const unsubWifiSnapshot = window.mduDebug.onWifiSnapshot((snapshot) => {
      if (isPaused) return;
      if (!snapshot) return;
      
      setLogs((prev) => {
        const timeStr = new Date(snapshot.timestamp || Date.now()).toLocaleTimeString();
        const displayFrame = {
          raw: `[${timeStr}] WiFi Snapshot: SoC=${(snapshot.flat?.['bms.soc'] || 0).toFixed(1)}%, RPM=${(snapshot.flat?.['inv.rpm'] || 0).toFixed(0)}, Speed=${(snapshot.flat?.['vcu.spd'] || 0).toFixed(0)} MPH`,
          ok: true,
          source: 'wifi'
        };
        const next = [...prev, displayFrame];
        if (next.length > 500) {
          next.shift();
        }
        return next;
      });
    });

    return () => {
      unsubFrames();
      unsubWifiSnapshot();
    };
  }, [isPaused]);

  // Auto-scroll to bottom of log output
  useEffect(() => {
    if (!isPaused && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isPaused]);

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (search) {
      const matchText = log.raw || '';
      if (!matchText.toLowerCase().includes(search.toLowerCase())) return false;
    }
    
    if (typeFilter !== 'all') {
      if (typeFilter === 'fast' && log.board?.kind !== 'fast') return false;
      if (typeFilter === 'slow' && log.board?.kind !== 'slow') return false;
      if (typeFilter === 'slcan' && log.source !== 'slcan') return false;
    }

    if (boardFilter !== 'all') {
      if (!log.board) return false;
      const bKey = `${log.board.boardType}-${log.board.boardId}`;
      if (boardFilter === 'sdu0' && bKey !== '2-0') return false;
      if (boardFilter === 'sdu1' && bKey !== '2-1') return false;
      if (boardFilter === 'sdu2' && bKey !== '2-2') return false;
      if (boardFilter === 'sdu3' && bKey !== '2-3') return false;
      if (boardFilter === 'tshmu' && log.board.boardType !== 4) return false;
      if (boardFilter === 'tspmu0' && bKey !== '6-0') return false;
      if (boardFilter === 'tspmu1' && bKey !== '6-1') return false;
      if (boardFilter === 'gps' && log.board.boardType !== 7 && log.board.boardType !== 1) return false;
    }

    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: 'calc(100vh - 180px)' }}>
      {/* View Switcher Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setActiveView('dashboard')}
          className={`nav-button ${activeView === 'dashboard' ? 'active' : ''}`}
          style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
        >
          <Activity size={14} />
          <span>Live Dashboard</span>
        </button>
        <button
          onClick={() => setActiveView('console')}
          className={`nav-button ${activeView === 'console' ? 'active' : ''}`}
          style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
        >
          <Sliders size={14} />
          <span>Raw Console Logs</span>
        </button>
      </div>

      {activeView === 'dashboard' ? (
        <LiveDashboard />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '1rem', height: '100%', minHeight: 0 }}>
      {/* Console panel */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem', borderRadius: '12px' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '150px' }}>
            <Search size={14} style={{ position: 'absolute', left: '8px', top: '10px', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="Search console logs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-input"
              style={{ paddingLeft: '28px', width: '100%' }}
            />
          </div>

          {/* Board Filter */}
          <select
            className="select-input"
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            style={{ fontSize: '0.8rem', padding: '0.35rem' }}
          >
            <option value="all">All Boards</option>
            <option value="sdu0">SDU FL (0)</option>
            <option value="sdu1">SDU FR (1)</option>
            <option value="sdu2">SDU RL (2)</option>
            <option value="sdu3">SDU RR (3)</option>
            <option value="tshmu">TSHMU (Flow)</option>
            <option value="tspmu0">TSPMU FL (0)</option>
            <option value="tspmu1">TSPMU FR (1)</option>
            <option value="gps">GPS/SMU</option>
          </select>

          {/* Frame Type Filter */}
          <select
            className="select-input"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ fontSize: '0.8rem', padding: '0.35rem' }}
          >
            <option value="all">All Frames</option>
            <option value="fast">Fast</option>
            <option value="slow">Slow</option>
            <option value="slcan">Raw SLCAN</option>
          </select>

          {/* Controls */}
          <button
            className="button"
            onClick={() => setIsPaused(!isPaused)}
            style={{ padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}
          >
            {isPaused ? <Play size={12} fill="currentColor" /> : <Pause size={12} />}
            <span>{isPaused ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            className="button"
            onClick={() => setLogs([])}
            style={{ padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}
          >
            <Trash2 size={12} />
            <span>Clear</span>
          </button>
        </div>

        {/* Monospace Output */}
        <div style={{
          flex: 1,
          backgroundColor: '#090d16',
          color: '#38bdf8',
          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
          fontSize: '0.8rem',
          padding: '0.75rem',
          borderRadius: '8px',
          overflowY: 'auto',
          border: '1px solid var(--border-color)',
          lineHeight: '1.4'
        }}>
          {filteredLogs.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
              {connectionState.connected ? 'Waiting for telemetry stream...' : 'Serial port offline. Connect to start stream.'}
            </div>
          ) : (
            filteredLogs.map((log, index) => {
              let color = '#38bdf8'; // Default SLCAN cyan
              if (log.source === 'board') {
                if (log.board?.kind === 'fast') color = '#a7f3d0'; // SDU fast green
                if (log.board?.kind === 'slow') color = '#fef08a'; // SDU slow yellow
                if (log.board?.boardType === 6) color = '#fed7aa'; // TSPMU orange
                if (log.board?.boardType === 4) color = '#fbcfe8'; // TSHMU flow pink
              }
              if (!log.ok) color = '#fecaca'; // Red error

              return (
                <div key={index} style={{ color, whiteSpace: 'pre-wrap', marginBottom: '2px' }}>
                  {log.raw}
                </div>
              );
            })
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Stats panel */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem', borderRadius: '12px' }}>
        <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={16} className="text-blue-500" />
          <span>Active CAN IDs</span>
        </h3>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
          <table className="spreadsheet-table" style={{ width: '100%', fontSize: '0.75rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>CAN ID</th>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>Type</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem' }}>Freq (Hz)</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {!diagnostics.topIds || diagnostics.topIds.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>
                    No CAN frames seen yet.
                  </td>
                </tr>
              ) : (
                diagnostics.topIds.map((item) => (
                  <tr key={item.idText}>
                    <td style={{ padding: '0.4rem 0.5rem', fontWeight: 'bold' }}>{item.idText}</td>
                    <td style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)' }}>
                      {item.source === 'board' ? 'Decoded' : 'Raw'}
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 'bold' }}>
                      {item.recentHz.toFixed(1)}
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {item.count}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
