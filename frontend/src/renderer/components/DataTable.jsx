import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Table, Columns } from 'lucide-react';

export default function DataTable({ data }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Define core columns for condensed view
  const coreColumns = [
    'ts',
    'gps.vel',
    'sdu[0].brake',
    'sdu[1].brake',
    'sdu[2].brake',
    'sdu[3].brake',
    'sdu[0].shock',
    'sdu[1].shock',
    'sdu[2].shock',
    'sdu[3].shock',
    'sdu[0].wrpm',
    'sdu[1].wrpm',
    'sdu[2].wrpm',
    'sdu[3].wrpm',
  ];

  const columns = useMemo(() => {
    if (!data || data.length === 0) return [];
    if (showAllColumns) {
      return Object.keys(data[0]);
    }
    // Filter down to core columns that actually exist in the data
    const existingKeys = Object.keys(data[0]);
    return coreColumns.filter(c => existingKeys.includes(c));
  }, [data, showAllColumns]);

  const filteredData = useMemo(() => {
    if (!data) return [];
    const valid = data.filter(row => !isNaN(parseFloat(row.ts)));
    if (!searchQuery) return valid;
    
    return valid.filter(row => {
      return Object.values(row).some(val => 
        String(val).toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [data, searchQuery]);

  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;

  // Reset page when search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const paginatedData = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return filteredData.slice(startIdx, startIdx + pageSize);
  }, [filteredData, currentPage, pageSize]);

  if (!data || data.length === 0) {
    return (
      <div className="glass-panel text-center py-12">
        <Table className="mx-auto mb-4 text-slate-500" size={48} />
        <h3>No Data to Display</h3>
      </div>
    );
  }

  return (
    <div className="glass-panel animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: '0.25rem' }}>Raw Telemetry Data Spreadsheet</h2>
          <p className="text-slate-400" style={{ fontSize: '0.85rem' }}>
            Browse and search raw telemetry records in a tabular format.
          </p>
        </div>
        
        {/* Toggle Column Set */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <input
            type="text"
            className="select-input"
            placeholder="Search cells..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '180px', paddingRight: '1rem', backgroundImage: 'none' }}
          />

          <button
            onClick={() => setShowAllColumns(!showAllColumns)}
            className={`button ${showAllColumns ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Columns size={16} />
            {showAllColumns ? 'Show Core Columns' : 'Show All Columns'}
          </button>
        </div>
      </div>

      {/* Spreadsheet Table wrapper */}
      <div className="table-wrapper" style={{ maxHeight: '550px' }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col} style={{ whiteSpace: 'nowrap' }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, idx) => (
              <tr key={idx}>
                {columns.map(col => {
                  const val = row[col];
                  const num = parseFloat(val);
                  const displayVal = !isNaN(num) && col !== 'ts' && col !== 'gps.lat' && col !== 'gps.lon'
                    ? num.toFixed(2)
                    : val;
                  return (
                    <td key={col} style={{ whiteSpace: 'nowrap' }}>
                      {displayVal}
                    </td>
                  );
                })}
              </tr>
            ))}
            {paginatedData.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="text-center text-slate-500 py-8">
                  No cells match the query.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="pagination-controls">
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Showing rows {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length} records
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Page size selector */}
          <select
            className="select-input"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            style={{ padding: '0.35rem 2rem 0.35rem 0.75rem' }}
          >
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
            <option value={250}>250 / page</option>
            <option value={500}>500 / page</option>
          </select>

          {/* Previous Button */}
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="button"
            style={{ padding: '0.35rem 0.75rem' }}
          >
            <ChevronLeft size={16} />
          </button>
          
          {/* Page Number indicator */}
          <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            Page {currentPage} of {totalPages}
          </span>

          {/* Next Button */}
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="button"
            style={{ padding: '0.35rem 0.75rem' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
