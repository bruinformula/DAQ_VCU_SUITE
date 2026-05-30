import { useMemo, useState } from 'react';
import SignalPlot from './SignalPlot';
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

  const openLocalFile = async () => {
    if (!window.electronAPI?.openLogFile) {
      setError('Local file opening is only available in the desktop app.');
      return;
    }

    setIsLoadingFile(true);
    setError('');

    try {
      const result = await window.electronAPI.openLogFile();
      if (result?.canceled) {
        return;
      }

      const parsed = parseLogCsv(result.content || '', result.filename || 'Telemetry Log');
      setLogData({
        ...parsed,
        filePath: result.filePath,
      });
    } catch (err) {
      console.error(err);
      setError('Unable to open the selected CSV from this laptop.');
    } finally {
      setIsLoadingFile(false);
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
          <button className="toolbar-button" onClick={openLocalFile} disabled={isLoadingFile}>
            {isLoadingFile ? 'Opening...' : 'Open CSV'}
          </button>
        </div>

        <div className="logs-list logs-list-static">
          <div className="log-source-card">
            <div className="log-source-label">Source</div>
            <div className="log-source-title">Local laptop storage</div>
            <div className="log-source-copy">
              Pick any telemetry CSV on this machine. The app no longer depends on the Pi to review recorded files.
            </div>
          </div>

          {logData ? (
            <button className="log-list-item active" onClick={openLocalFile}>
              <div className="log-list-title">
                <span>{logData.filename}</span>
                <strong>LOCAL</strong>
              </div>
              <div className="log-list-meta">
                <span>{logData.rows?.length || 0} rows</span>
                <span>{logData.filePath || 'Selected from laptop'}</span>
              </div>
            </button>
          ) : (
            <div className="log-empty">No local log opened yet. Use `Open CSV` to load one from your laptop.</div>
          )}
        </div>
      </aside>

      <section className="logs-main">
        {error ? <div className="dashboard-empty">{error}</div> : null}
        {!logData && !error ? (
          <div className="dashboard-empty">
            {isLoadingFile ? 'Opening selected log...' : 'Choose a CSV on this laptop to inspect recorded telemetry.'}
          </div>
        ) : null}
        {logData ? (
          <>
            <div className="logs-summary glass">
              <div>
                <h3>{logData.filename}</h3>
                <p>{logData.rows?.length || 0} rows • grouped playback charts with click-to-lock cursor readout</p>
                <p>{logData.filePath}</p>
              </div>
            </div>
            <div className="plot-grid">
              {chartGroups.map((group) => (
                <SignalPlot
                  key={group.id}
                  title={group.title}
                  signalIds={group.signals}
                  staticSamples={logData.rows || []}
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
