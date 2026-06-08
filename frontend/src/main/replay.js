'use strict';

const fs = require('fs');
const readline = require('readline');
const { dialog } = require('electron');

let replayAbortController = null;

function registerReplayIpcHandlers(ipcMain, monitor, broadcast) {
  ipcMain.handle('replay:pick-and-start', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select JSONL log for replay',
      filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const inputPath = result.filePaths[0];

    if (replayAbortController) {
      replayAbortController.abort();
    }
    replayAbortController = new AbortController();
    const signal = replayAbortController.signal;

    // Disconnect any live serial connection
    await monitor.disconnect('replay');
    
    // Clear session so we start fresh
    await monitor.clearSession();

    // Start streaming asynchronously
    (async () => {
      const inStream = fs.createReadStream(inputPath);
      const rl = readline.createInterface({ input: inStream });
      let lastTime = null;

      broadcast('device:runtime', {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Replay started',
        details: { filePath: inputPath }
      });

      for await (const line of rl) {
        if (signal.aborted) break;

        try {
          const data = JSON.parse(line);
          if (!data.timestamp) continue;

          const currentTime = new Date(data.timestamp).getTime();
          
          if (lastTime !== null) {
            // No real-time delay: blast data instantly for graph population.
            // Yield event loop occasionally to avoid freezing the main process.
            if ((Date.now() - (replayAbortController.lastYield || 0)) > 50) {
              await new Promise(resolve => setTimeout(resolve, 0));
              replayAbortController.lastYield = Date.now();
            }
          }
          lastTime = currentTime;

          if (signal.aborted) break;

          const now = Date.now();

          if (data.type === 'frame') {
            // Update monitor stats to keep graphs and diagnostics running
            monitor.stats.recordLine({
              ok: data.ok,
              source: data.source,
              idText: data.frame?.idText,
              idType: data.frame?.idType,
              dataLength: data.frame?.dataLength || 0,
              dataHex: data.frame?.dataHex,
            }, now);
            
            if (data.board) {
              monitor.boardStates.record(data.board, now);
            }
            
            // Rewrite the event timestamp so the graphs plot it correctly at "now"
            // Wait, actually, maybe it's better to leave the original timestamp? 
            // The graphs use Date.now() internally when the frame arrives in app.js!
            // So we don't need to rewrite it, but we can if we want the log to show original time.
            broadcast('device:frame', data);
          } else if (data.type === 'wifi_snapshot') {
            broadcast('device:wifi_snapshot', data);
          } else if (data.type === 'runtime') {
            broadcast('device:runtime', data);
          }
        } catch (e) {
          // Ignore parse errors from the file
        }
      }

      if (!signal.aborted) {
        broadcast('device:runtime', {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Replay finished',
          details: { filePath: inputPath }
        });
      }
    })();

    return inputPath;
  });

  ipcMain.handle('replay:stop', () => {
    if (replayAbortController) {
      replayAbortController.abort();
      replayAbortController = null;
      broadcast('device:runtime', {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Replay stopped',
        details: {}
      });
    }
  });

  ipcMain.handle('csv:pick-and-export', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select JSONL log to export',
      filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    const inputPath = result.filePaths[0];

    const saveResult = await dialog.showSaveDialog({
      title: 'Save CSV',
      defaultPath: inputPath.replace('.jsonl', '.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });

    if (saveResult.canceled) return null;
    const outputPath = saveResult.filePath;

    const inStream = fs.createReadStream(inputPath);
    const rl = readline.createInterface({ input: inStream });
    const outStream = fs.createWriteStream(outputPath);
    
    outStream.write("timestamp,source,boardId,kind,timeSinceLastMs,shockMm,sg0,sg1,sg2,sg3,sg4,sg5,rpm,tireMax,tireMin,tireCenter,tireAmbient,brakeC,brakeAmbientC,raw\n");

    for await (const line of rl) {
      try {
        const data = JSON.parse(line);
        if (data.type === 'frame') {
          const b = data.board;
          if (b) {
            const sg = b.strainGaugesMv || [];
            const t = b.tireC || {};
            outStream.write(`${data.timestamp},${data.source},${b.boardId},${b.kind || ''},${b.timeSinceLastMs || ''},${b.shockMm ?? ''},${sg[0] ?? ''},${sg[1] ?? ''},${sg[2] ?? ''},${sg[3] ?? ''},${sg[4] ?? ''},${sg[5] ?? ''},${b.rpm ?? ''},${t.max ?? ''},${t.min ?? ''},${t.center ?? ''},${t.ambient ?? ''},${b.brakeC ?? ''},${b.brakeAmbientC ?? ''},"${(data.raw || '').replace(/"/g, '""')}"\n`);
          } else {
            outStream.write(`${data.timestamp},${data.source},,,,,,,,,,,,,,,,,"${(data.raw || '').replace(/"/g, '""')}"\n`);
          }
        }
      } catch (e) {}
    }

    outStream.end();
    return outputPath;
  });
}

module.exports = {
  registerReplayIpcHandlers
};
