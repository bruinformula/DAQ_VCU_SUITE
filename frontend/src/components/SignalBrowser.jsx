import React, { useEffect, useRef, useState } from 'react';
import { signalGroups, getSignalValue } from '../signals';

export default function SignalBrowser({ telemetryRef, selectedSignals, onToggleSignal }) {
  const [expandedGroups, setExpandedGroups] = useState({'bms': true, 'inv': true, 'sdu_0': true});
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
            // Find signal def to check for custom precision
            let def = null;
            for (const group of signalGroups) {
              def = group.signals.find(s => s.id === id);
              if (def) break;
            }
            
            // Simple number formatting
            if (typeof val === 'number') {
              if (def && def.precision !== undefined) {
                element.innerText = val.toFixed(def.precision);
              } else {
                element.innerText = Math.abs(val) >= 100 ? val.toFixed(0) : val.toFixed(1);
              }
            } else {
              element.innerText = val;
            }
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
      <h2>Signal Browser</h2>
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
