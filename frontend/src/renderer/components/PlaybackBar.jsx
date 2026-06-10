import React from 'react';
import { Play, Pause, Rewind, FastForward } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';

export default function PlaybackBar({ duration, currentTs, isPlaying, setPlaying, setTime, speed, setSpeed }) {
  const { currentFilePath } = useTelemetry();
  
  const formatTime = (ts) => {
    if (isNaN(ts) || ts < 0) return '00:00.0';
    const minutes = Math.floor(ts / 60);
    const seconds = Math.floor(ts % 60);
    const tenths = Math.floor((ts % 1) * 10);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${tenths}`;
  };

  const handleSeek = (e) => {
    const val = parseFloat(e.target.value);
    setTime(val);
  };

  return (
    <div className="glass-panel" style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: '1rem', 
      padding: '0.5rem 1rem',
      marginBottom: '1rem',
      backgroundColor: 'rgba(16, 185, 129, 0.05)',
      border: '1px solid rgba(16, 185, 129, 0.2)',
      borderRadius: '8px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button 
          className="button" 
          onClick={() => setTime(0)} 
          style={{ padding: '0.4rem', borderRadius: '50%' }}
          title="Rewind to start"
        >
          <Rewind size={16} />
        </button>
        <button 
          className="button" 
          onClick={() => setPlaying(!isPlaying)} 
          style={{ 
            padding: '0.5rem', 
            borderRadius: '50%',
            backgroundColor: isPlaying ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
            color: isPlaying ? '#ef4444' : '#10b981',
            border: `1px solid ${isPlaying ? 'rgba(239, 68, 68, 0.5)' : 'rgba(16, 185, 129, 0.5)'}`
          }}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <span style={{ color: '#10b981', fontWeight: 'bold' }}>{formatTime(currentTs)}</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>
            {currentFilePath ? currentFilePath.split('/').pop().replace('_CAN.csv', '') : 'Offline Log'}
            {` | RAW=${useTelemetry().isRawCanDataset ? 'YES' : 'NO'} | sdu[0].shock=` + JSON.stringify(useTelemetry().playbackDataset[useTelemetry().playbackDataset.length - 1]?.['sdu[0].shock']) + ' | act_shock=' + JSON.stringify(useTelemetry().activeDataset[0]?.['sdu[0].shock'])}
          </span>
          <span>{formatTime(duration)}</span>
        </div>
        <input 
          type="range" 
          min="0" 
          max={duration || 1} 
          step="0.05"
          value={currentTs || 0} 
          onChange={handleSeek}
          style={{ 
            width: '100%',
            accentColor: '#10b981',
            cursor: 'pointer'
          }} 
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Speed:</span>
        <select 
          className="select-input"
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '70px' }}
        >
          <option value="0.25">0.25x</option>
          <option value="0.5">0.5x</option>
          <option value="1">1.0x</option>
          <option value="2">2.0x</option>
          <option value="5">5.0x</option>
          <option value="10">10.0x</option>
        </select>
      </div>
    </div>
  );
}
