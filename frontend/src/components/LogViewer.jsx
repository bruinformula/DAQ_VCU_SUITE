import { useEffect, useMemo, useState } from 'react';
import SignalPlot from './SignalPlot';
import GGDiagram from './GGDiagram';
import GPSPlayback from './GPSPlayback';
import { buildChartGroupsForSignals } from '../signals';
import { decodeRawCanLogRows, isRawCanLogHeaders } from '../canLogParser';

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseLogCsv(text, filename) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return {
      filename,
      headers: [],
      rows: [],
      sourceType: 'parsed-csv',
    };
  }

  const lines = normalized.split('\n').filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const sample = {};

    headers.forEach((header, index) => {
      const rawValue = cells[index] ?? '';
      if (rawValue === '') {
        sample[header] = null;
        return;
      }

      const numericValue = Number(rawValue);
      sample[header] = Number.isFinite(numericValue) ? numericValue : rawValue;
    });

    if (typeof sample.ts !== 'number') {
      sample.ts = 0;
    }

    return sample;
  });

  if (isRawCanLogHeaders(headers)) {
    const decoded = decodeRawCanLogRows(rows, filename);
    if ((decoded.rows || []).length > 0) {
      return decoded;
    }
  }

  return {
    filename,
    headers,
    rows,
    sourceType: 'parsed-csv',
  };
}

export default function LogViewer() {
  const [logData, setLogData] = useState(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [error, setError] = useState('');
  const [customSignalId, setCustomSignalId] = useState('');
  const [customSignalIds, setCustomSignalIds] = useState([]);

  const loadCsvContent = (content, filename, filePath = '') => {
    const parsed = parseLogCsv(content || '', filename || 'Telemetry Log');
    setLogData({
      ...parsed,
      filePath,
    });
  };

  const handleFileInputChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsLoadingFile(true);
    setError('');

    try {
      const content = await file.text();
      loadCsvContent(content, file.name, file.name);
    } catch (err) {
      console.error(err);
      setError('Unable to read the selected CSV from this laptop.');
    } finally {
      setIsLoadingFile(false);
      event.target.value = '';
    }
  };

  const chartGroups = useMemo(() => {
    if (!logData?.headers) return [];
    return buildChartGroupsForSignals(logData.headers);
  }, [logData]);

  useEffect(() => {
    const headers = logData?.headers || [];
    if (!headers.length) {
      setCustomSignalId('');
      setCustomSignalIds([]);
      return;
    }

    const numericSignals = headers.filter((header) => header !== 'ts');
    setCustomSignalId((current) => (
      numericSignals.includes(current) ? current : (numericSignals[0] || '')
    ));
    setCustomSignalIds((current) => current.filter((signalId) => numericSignals.includes(signalId)));
  }, [logData]);

  const addCustomSignal = () => {
    if (!customSignalId) return;
    setCustomSignalIds((current) => (
      current.includes(customSignalId) ? current : [...current, customSignalId]
    ));
  };

  const removeCustomSignal = (signalId) => {
    setCustomSignalIds((current) => current.filter((entry) => entry !== signalId));
  };

  return (
    <div className="logs-view logs-view-local">
      <aside className="logs-pane glass">
        <div className="logs-pane-header">
          <div>
            <h3>Laptop Log Files</h3>
            <p>Open a CSV directly from this laptop and inspect it with grouped playback charts.</p>
          </div>
          <div className="log-picker-status">
            {isLoadingFile ? 'Opening…' : 'Offline CSV review'}
          </div>
        </div>

        <div className="logs-list logs-list-static">
          <div className="log-source-card">
            <div className="log-source-label">Source</div>
            <div className="log-source-title">Local laptop storage</div>
            <div className="log-source-copy">
              Pick any telemetry CSV on this machine. The app no longer depends on the Pi to review recorded files.
            </div>
            <div className="log-picker-panel">
              <label className="log-picker-label" htmlFor="log-csv-input">Choose CSV File</label>
              <input
                id="log-csv-input"
                className="log-picker-input"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileInputChange}
                disabled={isLoadingFile}
              />
            </div>
          </div>

          {logData ? (
            <div className="log-list-item active">
              <div className="log-list-title">
                <span>{logData.filename}</span>
                <strong>LOCAL</strong>
              </div>
              <div className="log-list-meta">
                <span>{logData.rows?.length || 0} rows</span>
                <span>{logData.filePath || 'Selected from laptop'}</span>
              </div>
            </div>
          ) : (
            <div className="log-empty-inline">No local log opened yet. Use `Open CSV` to load one from your laptop.</div>
          )}
        </div>
      </aside>

      <section className="logs-main">
        {error ? <div className="logs-main-empty">{error}</div> : null}
        {!logData && !error ? (
          <div className="logs-main-empty">
            {isLoadingFile ? 'Opening selected log...' : 'Choose a CSV on this laptop to inspect recorded telemetry.'}
          </div>
        ) : null}
        {logData ? (
          <>
            <div className="logs-summary glass">
              <div>
                <h3>{logData.filename}</h3>
                <p>{logData.rows?.length || 0} rows • drag to zoom, click twice to measure, recolor overlays, full-screen any graph, replay G-G and GPS, and build your own comparison chart</p>
                <p>
                  {logData.sourceType === 'raw-can-decoded'
                    ? 'Decoded from raw CAN CSV using the MDU board-frame parser before rendering the playback charts.'
                    : 'Parsed directly from the flattened telemetry CSV.'}
                </p>
                <p>{logData.filePath}</p>
              </div>
            </div>
            <GPSPlayback
              samples={logData.rows || []}
              availableSignalIds={logData.headers || []}
            />
            <GGDiagram
              samples={logData.rows || []}
              availableSignalIds={logData.headers || []}
            />
            <section className="log-custom-shell glass">
              <div className="log-custom-header">
                <div>
                  <h3>Custom Replay Plot</h3>
                  <p>Build a graph from any logged parameters, then use overlays, measurement cursors, and full-screen mode to inspect correlations.</p>
                </div>
                <div className="log-custom-controls">
                  <select
                    className="plot-overlay-select"
                    value={customSignalId}
                    onChange={(event) => setCustomSignalId(event.target.value)}
                    disabled={!logData.headers?.length}
                  >
                    {(logData.headers || []).filter((signalId) => signalId !== 'ts').map((signalId) => (
                      <option key={signalId} value={signalId}>{signalId}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="plot-tool-btn"
                    onClick={addCustomSignal}
                    disabled={!customSignalId}
                  >
                    Add To Plot
                  </button>
                </div>
              </div>
              {customSignalIds.length ? (
                <>
                  <div className="plot-overlay-chips">
                    {customSignalIds.map((signalId) => (
                      <button
                        key={signalId}
                        type="button"
                        className="plot-overlay-chip"
                        onClick={() => removeCustomSignal(signalId)}
                      >
                        Remove {signalId}
                      </button>
                    ))}
                  </div>
                  <SignalPlot
                    title="Custom Replay Plot"
                    signalIds={customSignalIds}
                    staticSamples={logData.rows || []}
                    availableSignalIds={logData.headers || []}
                    allowOverlay
                    emptyMessage="Pick one or more parameters to start your custom replay chart."
                  />
                </>
              ) : (
                <div className="log-custom-empty">Pick any logged parameter, add it to the plot, then layer on overlays to compare tire, GPS, shock, or powertrain behavior side by side.</div>
              )}
            </section>
            <div className="plot-grid">
              {chartGroups.map((group) => (
                <SignalPlot
                  key={group.id}
                  title={group.title}
                  signalIds={group.signals}
                  staticSamples={logData.rows || []}
                  availableSignalIds={logData.headers || []}
                  allowOverlay
                  emptyMessage="This log does not contain values for this group."
                />
              ))}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
