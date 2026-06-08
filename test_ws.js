const WebSocket = require('ws');
const http = require('http');

async function checkPi() {
  const ip = '10.42.0.1';
  console.log(`Testing connection to ${ip}...`);
  
  const ws = new WebSocket(`ws://${ip}:8080/ws`);
  const tally = {};
  
  ws.on('open', () => {
    console.log('WebSocket connected. Tallying frames for 3 seconds...');
    setTimeout(() => {
      console.log('--- CAN ID Tally ---');
      const sortedIds = Object.keys(tally).map(Number).sort((a,b) => a-b);
      for (const id of sortedIds) {
        console.log(`0x${id.toString(16).toUpperCase()}: ${tally[id]} frames`);
      }
      ws.close();
      process.exit(0);
    }, 3000);
  });
  
  ws.on('message', (data) => {
    try {
      const payload = JSON.parse(data);
      const frames = Array.isArray(payload) ? payload : [payload];
      for (const frame of frames) {
        if (frame.id !== undefined) {
          tally[frame.id] = (tally[frame.id] || 0) + 1;
        }
      }
    } catch (e) {}
  });
  
  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    process.exit(1);
  });
}

checkPi();
