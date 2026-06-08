import React, { useMemo, useState } from 'react';
import { Search, Square, CheckSquare, Trash2 } from 'lucide-react';
import { createDropoutPlugin } from '../utils/dropoutPlugin';
import ZoomableLine from './ZoomableLine';

export default function CustomPlotter({ data, boardDropouts, startTs = 0 }) {
  const [selectedColumns, setSelectedColumns] = useState(['sdu[0].brake', 'gps.vel']);
  const [searchQuery, setSearchQuery] = useState('');

  // Extract all columns from the CSV data
  const columns = useMemo(() => {
    if (!data || data.length === 0) return [];
    return Object.keys(data[0]).filter(col => col !== 'ts');
  }, [data]);

  const filteredColumns = useMemo(() => {
    return columns.filter(col => col.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [columns, searchQuery]);

  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const valid = data.filter(row => !isNaN(parseFloat(row.ts)));
    const targetPoints = 4000;
    if (valid.length <= targetPoints) return valid;
    const step = Math.ceil(valid.length / targetPoints);
    return valid.filter((_, idx) => idx % step === 0);
  }, [data]);

  const colors = [
    '#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899',
    '#eab308', '#06b6d4', '#f43f5e', '#14b8a6', '#6366f1'
  ];

  const chartData = useMemo(() => {
    return {
      datasets: selectedColumns.map((col, idx) => {
        const color = colors[idx % colors.length];
        return {
          label: col,
          data: processedData.map(row => {
            const val = parseFloat(row[col]);
            const time = parseFloat(row.ts) - startTs;
            return { x: time, y: isNaN(val) ? null : val };
          }),
          borderColor: color,
          backgroundColor: `${color}10`,
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
        };
      })
    };
  }, [selectedColumns, processedData, startTs]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#e2e8f0',
          font: { family: 'Inter', size: 11, weight: 500 }
        }
      },
      zoom: {
        pan: { enabled: false },
        zoom: {
          wheel: { enabled: false },
          pinch: { enabled: true },
          drag: { enabled: false },
          mode: 'xy'
        }
      },
      tooltip: {
        mode: 'nearest',
        intersect: false,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderWidth: 1,
        padding: 10,
        bodyFont: { family: 'var(--font-mono)', size: 12 }
      }
    },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Time (s)', color: '#94a3b8', font: { family: 'Inter', size: 12 } },
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#64748b', maxTicksLimit: 10 }
      },
      y: {
        title: {
          display: true,
          text: selectedColumns.length === 1 ? selectedColumns[0] : 'Telemetry Value',
          color: '#94a3b8',
          font: { family: 'Inter', size: 12 }
        },
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
        ticks: { color: '#64748b', maxTicksLimit: 8 }
      }
    }
  }), [selectedColumns]);

  const getBoardFromColumnName = (colName) => {
    if (colName.startsWith('sdu[0]')) return 'sdu0';
    if (colName.startsWith('sdu[1]')) return 'sdu1';
    if (colName.startsWith('sdu[2]')) return 'sdu2';
    if (colName.startsWith('sdu[3]')) return 'sdu3';
    if (colName.startsWith('gps')) return 'gps';
    if (colName.startsWith('inv')) return 'inverter';
    if (colName.startsWith('bms')) return 'bms';
    if (colName.startsWith('tspmu[0]')) return 'tspmu0';
    if (colName.startsWith('tspmu[1]')) return 'tspmu1';
    if (colName.startsWith('tshmu')) return 'tshmu';
    if (colName.startsWith('imu')) return 'imu';
    return null;
  };

  const activeDropouts = useMemo(() => {
    if (!boardDropouts) return [];
    const activeBoards = new Set();
    selectedColumns.forEach(col => {
      const board = getBoardFromColumnName(col);
      if (board) activeBoards.add(board);
    });

    const merged = [];
    const seenGlobals = new Set();
    activeBoards.forEach(board => {
      const list = boardDropouts[board];
      if (!list) return;
      list.forEach(gap => {
        if (gap.label === 'LOG DROP') {
          const key = `${gap.startTime.toFixed(2)}-${gap.endTime.toFixed(2)}`;
          if (seenGlobals.has(key)) return;
          seenGlobals.add(key);
        }
        merged.push(gap);
      });
    });

    if (activeBoards.size === 0) {
      const firstBoardKey = Object.keys(boardDropouts)[0];
      if (firstBoardKey && boardDropouts[firstBoardKey]) {
        return boardDropouts[firstBoardKey].filter(gap => gap.label === 'LOG DROP');
      }
      return [];
    }
    return merged;
  }, [selectedColumns, boardDropouts]);

  const dropoutPlugin = useMemo(() => createDropoutPlugin(activeDropouts, startTs), [activeDropouts, startTs]);
  const chartPlugins = useMemo(() => [dropoutPlugin], [dropoutPlugin]);

  const handleToggleColumn = (col) => {
    setSelectedColumns(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  };

  const handleClearAll = () => setSelectedColumns([]);

  return (
    <div className="glass-panel animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 className="section-title" style={{ marginBottom: '0.5rem' }}>Interactive Custom Plotter</h2>
        <p className="text-slate-400" style={{ fontSize: '0.875rem' }}>
          Select any parameters from the log to overlay them. Use the search box to find specific metrics.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '2rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              className="select-input"
              placeholder="Search parameters..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', paddingLeft: '2.5rem', backgroundImage: 'none' }}
            />
            <Search
              size={18}
              className="text-slate-400"
              style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {selectedColumns.length} parameter(s) plotted
            </span>
            <button
              onClick={handleClearAll}
              className="button"
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
            >
              <Trash2 size={14} /> Clear All
            </button>
          </div>

          <div className="plotter-columns-grid">
            {filteredColumns.map(col => {
              const isChecked = selectedColumns.includes(col);
              return (
                <label
                  key={col}
                  className="plotter-checkbox-label"
                  style={{
                    color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)',
                    background: isChecked ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                    border: isChecked ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid transparent',
                    borderRadius: '4px'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggleColumn(col)}
                    style={{ display: 'none' }}
                  />
                  {isChecked ? (
                    <CheckSquare size={16} className="text-blue-500" />
                  ) : (
                    <Square size={16} className="text-slate-500" />
                  )}
                  <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={col}>
                    {col}
                  </span>
                </label>
              );
            })}
            {filteredColumns.length === 0 && (
              <div className="text-center py-4 text-slate-500" style={{ fontSize: '0.8125rem' }}>
                No columns match search
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '450px', justifyContent: 'center' }}>
          {selectedColumns.length > 0 ? (
            <div style={{ height: '450px', width: '100%', position: 'relative' }}>
              <ZoomableLine
                title="Custom Channel Plotter"
                description="Analysis plot comparing selected custom telemetry data channels."
                options={chartOptions}
                data={chartData}
                plugins={chartPlugins}
              />
            </div>
          ) : (
            <div className="text-center text-slate-500" style={{ padding: '4rem 0' }}>
              <Square size={48} className="mx-auto mb-4" />
              <h3>No Channels Selected</h3>
              <p style={{ fontSize: '0.875rem' }}>Select one or more parameters from the panel on the left to start plotting.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
