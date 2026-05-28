export const signalGroups = [
  {
    id: 'bms', name: 'BMS',
    signals: [
      { id: 'bms.v', name: 'Pack Voltage', unit: 'V', color: '#00ff7f' },
      { id: 'bms.i', name: 'Pack Current', unit: 'A', color: '#ff2a4d' },
      { id: 'bms.soc', name: 'State of Charge', unit: '%', color: '#00e5ff' },
      { id: 'bms.hi_t', name: 'High Temp', unit: '°C', color: '#ffb800' },
      { id: 'bms.lo_t', name: 'Low Temp', unit: '°C', color: '#00ffff' },
      { id: 'bms.hi_cv', name: 'High Cell Voltage', unit: 'V', color: '#00ff7f' },
      { id: 'bms.lo_cv', name: 'Low Cell Voltage', unit: 'V', color: '#ffb800' },
      { id: 'bms.dcl', name: 'Discharge Current Limit', unit: 'A', color: '#aaaaaa' }
    ]
  },
  {
    id: 'inv', name: 'Inverter',
    signals: [
      { id: 'inv.rpm', name: 'Motor Speed', unit: 'RPM', color: '#00e5ff' },
      { id: 'inv.vdc', name: 'DC Bus Voltage', unit: 'V', color: '#00ff7f' },
      { id: 'inv.idc', name: 'DC Bus Current', unit: 'A', color: '#ff2a4d' },
      { id: 'inv.tq_cmd', name: 'Torque Command', unit: 'Nm', color: '#ffb800' },
      { id: 'inv.tq_fb', name: 'Torque Feedback', unit: 'Nm', color: '#00ff7f' },
      { id: 'inv.mot_t', name: 'Motor Temp', unit: '°C', color: '#ff2a4d' },
      { id: 'inv.cool_t', name: 'Coolant Temp', unit: '°C', color: '#00e5ff' }
    ]
  },
  {
    id: 'vcu', name: 'VCU',
    signals: [
      { id: 'vcu.spd', name: 'Vehicle Speed', unit: 'MPH', color: '#00e5ff' },
      { id: 'vcu.apps1', name: 'APPS 1', unit: '%', color: '#ffb800' },
      { id: 'vcu.apps2', name: 'APPS 2', unit: '%', color: '#ff2a4d' },
      { id: 'vcu.bse', name: 'Brake Pressure', unit: '%', color: '#00ff7f' }
    ]
  },
  {
    id: 'imu', name: 'IMU',
    signals: [
      { id: 'imu.ax', name: 'Accel X', unit: 'g', color: '#ff2a4d' },
      { id: 'imu.ay', name: 'Accel Y', unit: 'g', color: '#00ff7f' },
      { id: 'imu.az', name: 'Accel Z', unit: 'g', color: '#00e5ff' },
      { id: 'imu.pitch', name: 'Pitch', unit: '°', color: '#ffb800' },
      { id: 'imu.roll', name: 'Roll', unit: '°', color: '#ff2a4d' },
      { id: 'imu.yaw', name: 'Yaw', unit: '°', color: '#00ff7f' }
    ]
  }
];

['FL', 'FR', 'RL', 'RR'].forEach((pos, idx) => {
  signalGroups.push({
    id: `sdu_${idx}`, name: `SDU ${pos}`,
    signals: [
      { id: `sdu.${idx}.shock`, name: 'Shock Pot', unit: 'mm', color: '#00e5ff' },
      { id: `sdu.${idx}.brake`, name: 'Brake Temp', unit: '°C', color: '#ff2a4d' },
      { id: `sdu.${idx}.wrpm`, name: 'Wheel Speed', unit: 'RPM', color: '#00ff7f' },
      { id: `sdu.${idx}.tire[0]`, name: 'Tire Max Temp', unit: '°C', color: '#ffb800' },
      { id: `sdu.${idx}.tire[1]`, name: 'Tire Min Temp', unit: '°C', color: '#00ffff' },
      { id: `sdu.${idx}.tire[2]`, name: 'Tire Ctr Temp', unit: '°C', color: '#00ff7f' },
      { id: `sdu.${idx}.tire[3]`, name: 'Tire Amb Temp', unit: '°C', color: '#aaaaaa' }
    ]
  });
});

export const ALL_SIGNALS = signalGroups.flatMap(g => g.signals);
export const SIGNAL_MAP = Object.fromEntries(ALL_SIGNALS.map(s => [s.id, s]));

export function getSignalValue(data, signalId) {
  if (!data) return undefined;
  const parts = signalId.split('.');
  let val = data;
  for (const part of parts) {
    if (part.includes('[')) {
      const [arrayName, indexStr] = part.split('[');
      const index = parseInt(indexStr.replace(']', ''), 10);
      val = val[arrayName] ? val[arrayName][index] : undefined;
    } else {
      val = val ? val[part] : undefined;
    }
  }
  return val;
}
