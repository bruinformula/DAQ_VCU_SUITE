'use strict';

const fs = require('fs');
const path = require('path');

class LogWriter {
  constructor(onStatusChange = () => {}) {
    this.onStatusChange = onStatusChange;
    this.stream = null;
    this.filePath = null;
    this.linesWritten = 0;
    this.bytesWritten = 0;
    this.lastError = null;
    this.buffer = [];
    this.flushInterval = null;
    this.lastStatusTime = 0;
  }

  getStatus() {
    return {
      active: Boolean(this.stream),
      filePath: this.filePath,
      linesWritten: this.linesWritten,
      bytesWritten: this.bytesWritten,
      lastError: this.lastError,
    };
  }

  async start(filePath) {
    if (!filePath) {
      throw new Error('A log file path is required.');
    }

    if (this.stream) {
      this.stop();
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    this.filePath = filePath;
    this.linesWritten = 0;
    this.bytesWritten = 0;
    this.lastError = null;
    this.buffer = [];
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.stream.on('error', (error) => {
      this.lastError = error.message;
      this.notifyStatusChange(true);
    });

    this.flushInterval = setInterval(() => {
      this.flush();
      this.notifyStatusChange();
    }, 100);

    this.write({
      type: 'session_start',
      timestamp: new Date().toISOString(),
    });

    this.notifyStatusChange(true);
    return this.getStatus();
  }

  stop() {
    if (!this.stream) {
      return this.getStatus();
    }

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    this.write({
      type: 'session_end',
      timestamp: new Date().toISOString(),
    });

    this.flush();

    const stream = this.stream;
    this.stream = null;
    stream.end();
    this.notifyStatusChange(true);
    return this.getStatus();
  }

  write(entry) {
    if (!this.stream) {
      return false;
    }

    const line = `${JSON.stringify(entry)}\n`;
    this.buffer.push(line);
    this.linesWritten += 1;
    this.bytesWritten += Buffer.byteLength(line);

    if (this.buffer.length >= 100) {
      this.flush();
    }

    this.notifyStatusChange();
    return true;
  }

  flush() {
    if (this.buffer.length === 0 || !this.stream) {
      return;
    }
    const chunk = this.buffer.join('');
    this.buffer = [];
    this.stream.write(chunk);
  }

  notifyStatusChange(force = false) {
    const now = Date.now();
    if (force || now - this.lastStatusTime >= 100) {
      this.lastStatusTime = now;
      this.onStatusChange(this.getStatus());
    }
  }
}

module.exports = {
  LogWriter,
};
