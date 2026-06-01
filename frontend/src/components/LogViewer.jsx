import { useMemo, useState } from 'react';
import SignalPlot from './SignalPlot';
import GGDiagram from './GGDiagram';
import { buildChartGroupsForSignals } from '../signals';

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

  return {
    filename,
    headers,
    rows,
  };
}

export default function LogViewer() {
  const [logData, setLogData] = useState(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [error, setError] = useState('');

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
                <p>{logData.rows?.length || 0} rows • drag to zoom, click twice to measure, recolor overlays, full-screen any graph, and replay a G-G diagram</p>
                <p>{logData.filePath}</p>
              </div>
            </div>
            <GGDiagram
              samples={logData.rows || []}
              availableSignalIds={logData.headers || []}
            />
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
