import React, { useEffect, useRef, useState } from 'react';
import { formatSignalValue, getSignalDefinition, getSignalValue, signalGroups } from '../signals';

export default function SignalBrowser({ telemetryRef, selectedSignals, onToggleSignal, onSelectAllSignals }) {
  const [expandedGroups, setExpandedGroups] = useState({ bms_core: true, inv_core: true, inv_temp: true });
  const valueRefs = useRef({});

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // High-performance live value updates that bypass React re-renders completely
  useEffect(() => {
    let animationFrame;
    const updateValues = () => {
      const data = telemetryRef.current;
      if (data) {
        Object.entries(valueRefs.current).forEach(([id, element]) => {
          if (!element) return;
          const val = getSignalValue(data, id);
          
          if (val === undefined) {
            element.innerText = '--';
          } else {
            const def = getSignalDefinition(id);
            element.innerText = formatSignalValue(def, val);
          }
        });
      }
      animationFrame = requestAnimationFrame(updateValues);
    };
    
    animationFrame = requestAnimationFrame(updateValues);
    return () => cancelAnimationFrame(animationFrame);
  }, [telemetryRef]);

  return (
    <div className="signal-browser">
      <div className="signal-browser-header-row">
        <h2>Log Signal Selection</h2>
        <button
          type="button"
          className="toolbar-button"
          onClick={onSelectAllSignals}
        >
          Select All
        </button>
      </div>
      <p className="signal-browser-copy">
        Pick the channels you want written into new CSV sessions. Live graphs are grouped automatically.
      </p>
      <div className="signal-groups">
        {signalGroups.map(group => (
          <div key={group.id} className="signal-group">
            <div 
              className="signal-group-header" 
              onClick={() => toggleGroup(group.id)}
            >
              <span className={`chevron ${expandedGroups[group.id] ? 'expanded' : ''}`}>▶</span>
              {group.name}
            </div>
            
            {expandedGroups[group.id] && (
              <div className="signal-list">
                {group.signals.map(signal => {
                  const isSelected = selectedSignals.includes(signal.id);
                  return (
                    <div 
                      key={signal.id} 
                      className={`signal-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => onToggleSignal(signal.id)}
                    >
                      <div className="signal-indicator" style={{ 
                        backgroundColor: isSelected ? signal.color : 'transparent', 
                        borderColor: signal.color 
                      }}></div>
                      <div className="signal-name">{signal.name}</div>
                      <div className="signal-value-wrapper">
                        <span className="signal-value" ref={el => valueRefs.current[signal.id] = el}>--</span>
                        <span className="signal-unit">{signal.unit}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
