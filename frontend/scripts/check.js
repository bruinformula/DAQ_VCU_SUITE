'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const filesToCheck = [
  'src/main/main.js',
  'src/main/preload.js',
  'src/main/device-monitor.js',
  'src/main/log-writer.js',
  'src/main/slcan.js',
  'src/main/mdu-frame.js',
  'src/main/usb-topology.js',
];

for (const relativePath of filesToCheck) {
  const fullPath = path.join(rootDir, relativePath);
  execFileSync(process.execPath, ['--check', fullPath], {
    stdio: 'inherit',
  });
}

JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
console.log('Syntax check passed.');
