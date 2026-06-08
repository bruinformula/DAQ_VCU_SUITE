'use strict';

const { parseMduLine } = require('/Users/larry/mk11-mdu-code/mdu debug gui/src/main/mdu-frame');

console.log('--- TEST: Reconstructing 3-bit rolling counter from 2-bit printed Seq ---');

const seqs = [0, 0, 1, 1, 2, 2, 3, 3, 0, 0];
const expectedReconstructed = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1];
const results = [];

for (let i = 0; i < seqs.length; i++) {
  const line = `[B0 ID 180 Fast] Seq:${seqs[i]} | dT:34336ms | SG[mV]: 2, 2916, 25600, 95, 24385, 16651 | Shock: 29.16 mm`;
  const res = parseMduLine(line);
  const counter = (res.board.errorFlags >> 7) & 0x07;
  results.push(counter);
}

console.log('Input Seq:        ', seqs.join(', '));
console.log('Reconstructed:    ', results.join(', '));
console.log('Expected:         ', expectedReconstructed.join(', '));

let ok = true;
for (let i = 0; i < expectedReconstructed.length; i++) {
  if (results[i] !== expectedReconstructed[i]) {
    ok = false;
  }
}

if (ok) {
  console.log('\nSUCCESS: 3-bit counter reconstructed perfectly from 2-bit Seq numbers!');
} else {
  console.log('\nFAILURE: Reconstructed values do not match expected consecutive sequence!');
  process.exit(1);
}
