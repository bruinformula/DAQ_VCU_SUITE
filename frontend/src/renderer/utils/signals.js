const inverterPalette = [
  '#00e5ff',
  '#00ff7f',
  '#ffb800',
  '#ff2a4d',
  '#70d6ff',
  '#ff70a6',
  '#8cffc1',
  '#ffd670',
  '#caffbf',
  '#bdb2ff',
  '#9bf6ff',
  '#ffd6a5',
];

function makeSignal(id, name, unit, color, extra = {}) {
  return { id, name, unit, color, ...extra };
}

function makeInverterSignals(prefix, names, unit, start = 0, extra = {}) {
  return names.map((name, index) => {
    const id = `${prefix}.${name.id}`;
    return makeSignal(id, name.label, unit, inverterPalette[(start + index) % inverterPalette.length], extra);
  });
}

export const signalGroups = [
  {
    id: 'gps',
    name: 'GPS / RTK',
    signals: [
      makeSignal('gps.lat', 'Latitude', 'deg', '#00e5ff', { precision: 6 }),
      makeSignal('gps.lon', 'Longitude', 'deg', '#70d6ff', { precision: 6 }),
      makeSignal('gps.alt', 'Altitude', 'm', '#8cffc1', { precision: 2 }),
      makeSignal('gps.vel', 'Velocity', 'm/s', '#00ff7f', { precision: 2 }),
      makeSignal('gps.hdg', 'Heading', 'deg', '#ffd670', { precision: 2 }),
      makeSignal('gps.fix', 'Fix Valid', 'state', '#caffbf', { precision: 0 }),
      makeSignal('gps.fix_quality', 'Fix Quality', 'q', '#ffb800', { precision: 0 }),
      makeSignal('gps.rtk_state', 'RTK State', '', '#ffb800'),
      makeSignal('gps.sats', 'Satellites', 'count', '#ff70a6', { precision: 0 }),
      makeSignal('gps.hdop', 'HDOP', 'hdop', '#9bf6ff', { precision: 2 }),
      makeSignal('gps.heading_valid', 'Heading Valid', 'state', '#bdb2ff', { precision: 0 }),
      makeSignal('gps.heading_quality', 'Heading Quality', 'q', '#ffd6a5', { precision: 0 }),
      makeSignal('gps.heading_source', 'Heading Source', '', '#ffd6a5'),
      makeSignal('gps.heading_accuracy_deg', 'Heading Accuracy', 'deg', '#00ffff', { precision: 2 }),
      makeSignal('gps.baseline_m', 'Baseline Length', 'm', '#ff2a4d', { precision: 3 }),
      makeSignal('gps.pitch_deg', 'GPS Pitch', 'deg', '#70d6ff', { precision: 2 }),
      makeSignal('gps.error_flags', 'GPS Error Flags', 'bits', '#ff70a6', { precision: 0 }),
    ],
  },
  {
    id: 'bms_core',
    name: 'BMS Core',
    signals: [
      makeSignal('bms.v', 'Pack Voltage', 'V', '#00ff7f'),
      makeSignal('bms.i', 'Pack Current', 'A', '#ff2a4d'),
      makeSignal('bms.soc', 'State of Charge', '%', '#00e5ff'),
      makeSignal('bms.dcl', 'Discharge Current Limit', 'A', '#ffd670'),
    ],
  },
  {
    id: 'bms_temp',
    name: 'BMS Temperatures',
    signals: [
      makeSignal('bms.avg_t', 'Average Cell Temp', '°C', '#70d6ff'),
      makeSignal('bms.hi_t', 'High Temp', '°C', '#ffb800'),
      makeSignal('bms.lo_t', 'Low Temp', '°C', '#00ffff'),
    ],
  },
  {
    id: 'bms_voltage',
    name: 'BMS Cell Voltages',
    signals: [
      makeSignal('bms.avg_cv', 'Average Cell Voltage', 'V', '#9bf6ff', { precision: 3 }),
      makeSignal('bms.hi_cv', 'High Cell Voltage', 'V', '#00ff7f', { precision: 3 }),
      makeSignal('bms.lo_cv', 'Low Cell Voltage', 'V', '#ffb800', { precision: 3 }),
    ],
  },
  {
    id: 'inv_core',
    name: 'Inverter Core',
    signals: [
      makeSignal('inv.rpm', 'Motor Speed', 'RPM', '#00e5ff'),
      makeSignal('inv.vdc', 'DC Bus Voltage', 'V', '#00ff7f'),
      makeSignal('inv.idc', 'DC Bus Current', 'A', '#ff2a4d'),
      makeSignal('inv.tq_cmd', 'Torque Command', 'Nm', '#ffb800'),
      makeSignal('inv.tq_fb', 'Torque Feedback', 'Nm', '#70d6ff'),
      makeSignal('inv.vsm', 'VSM State', 'state', '#caffbf', { precision: 0 }),
      makeSignal('inv.faults', 'Fault Bitfield', 'bits', '#ff70a6', { precision: 0 }),
    ],
  },
  {
    id: 'inv_temp',
    name: 'Inverter Temperatures',
    signals: [
      makeSignal('inv.mot_t', 'Motor Temp', '°C', '#ff2a4d'),
      makeSignal('inv.cool_t', 'Coolant Temp', '°C', '#00e5ff'),
      ...makeInverterSignals('inv.all', [
        { id: 'hot_spot_temp', label: 'Hot Spot Temp' },
        { id: 'control_board_temp', label: 'Control Board Temp' },
        { id: 'rtd1_temperature', label: 'RTD1 Temp' },
        { id: 'rtd2_temperature', label: 'RTD2 Temp' },
        { id: 'stall_burst_model_temp', label: 'Stall Burst Model Temp' },
        { id: 'module_a_temp', label: 'Module A Temp' },
        { id: 'module_b_temp', label: 'Module B Temp' },
        { id: 'module_c_temp', label: 'Module C Temp' },
        { id: 'gate_driver_board_temp', label: 'Gate Driver Board Temp' },
      ], '°C', 2),
    ],
  },
  {
    id: 'inv_torque',
    name: 'Inverter Torque',
    signals: [
      makeSignal('inv.tq_cmd', 'Torque Command', 'Nm', '#ffb800'),
      makeSignal('inv.tq_fb', 'Torque Feedback', 'Nm', '#00ff7f'),
      ...makeInverterSignals('inv.all', [
        { id: 'torque_shudder', label: 'Torque Shudder' },
        { id: 'torque_capability_motor', label: 'Motor Torque Capability' },
        { id: 'torque_capability_regen', label: 'Regen Torque Capability' },
        { id: 'fast_torque_command', label: 'Fast Torque Command' },
        { id: 'fast_torque_feedback', label: 'Fast Torque Feedback' },
        { id: 'commanded_torque', label: 'DBC Commanded Torque' },
        { id: 'torque_feedback', label: 'DBC Torque Feedback' },
      ], 'Nm', 5),
    ],
  },
  {
    id: 'inv_current',
    name: 'Inverter Currents',
    signals: [
      makeSignal('inv.idc', 'DC Bus Current', 'A', '#ff2a4d'),
      ...makeInverterSignals('inv.all', [
        { id: 'phase_a_current', label: 'Phase A Current' },
        { id: 'phase_b_current', label: 'Phase B Current' },
        { id: 'phase_c_current', label: 'Phase C Current' },
        { id: 'iq', label: 'Iq' },
        { id: 'id', label: 'Id' },
        { id: 'iq_command', label: 'Iq Command' },
        { id: 'id_command', label: 'Id Command' },
        { id: 'flux_weakening_output', label: 'Flux Weakening Output' },
      ], 'A', 3),
    ],
  },
  {
    id: 'inv_voltage',
    name: 'Inverter Voltages',
    signals: [
      makeSignal('inv.vdc', 'DC Bus Voltage', 'V', '#00ff7f'),
      ...makeInverterSignals('inv.all', [
        { id: 'output_voltage', label: 'Output Voltage' },
        { id: 'vab_vd_voltage', label: 'VAB / Vd Voltage' },
        { id: 'vbc_vq_voltage', label: 'VBC / Vq Voltage' },
        { id: 'vd_ff', label: 'Vd Feedforward' },
        { id: 'vq_ff', label: 'Vq Feedforward' },
        { id: 'ref_voltage_1_5', label: 'Ref Voltage 1.5V' },
        { id: 'ref_voltage_2_5', label: 'Ref Voltage 2.5V' },
        { id: 'ref_voltage_5_0', label: 'Ref Voltage 5.0V' },
        { id: 'ref_voltage_12_0', label: 'Ref Voltage 12.0V' },
        { id: 'fast_dc_bus_voltage', label: 'Fast DC Bus Voltage' },
      ], 'V', 8),
    ],
  },
  {
    id: 'inv_speed',
    name: 'Inverter Speed / Frequency',
    signals: [
      makeSignal('inv.rpm', 'Motor Speed', 'RPM', '#00e5ff'),
      ...makeInverterSignals('inv.all', [
        { id: 'motor_speed', label: 'DBC Motor Speed' },
        { id: 'fast_motor_speed', label: 'Fast Motor Speed' },
        { id: 'electrical_output_frequency', label: 'Electrical Output Frequency' },
        { id: 'power_on_timer', label: 'Power-On Timer' },
      ], 'RPM', 0),
    ],
  },
  {
    id: 'inv_state',
    name: 'Inverter State / Faults',
    signals: [
      makeSignal('inv.vsm', 'VSM State', 'state', '#caffbf', { precision: 0 }),
      makeSignal('inv.faults', 'Fault Bitfield', 'bits', '#ff70a6', { precision: 0 }),
      ...makeInverterSignals('inv.all', [
        { id: 'inverter_state', label: 'Inverter State' },
        { id: 'inverter_enable_state', label: 'Enable State' },
        { id: 'inverter_run_mode', label: 'Run Mode' },
        { id: 'inverter_command_mode', label: 'Command Mode' },
        { id: 'inverter_enable_lockout', label: 'Enable Lockout' },
        { id: 'inverter_discharge_state', label: 'Discharge State' },
        { id: 'bms_active', label: 'BMS Active' },
        { id: 'bms_limiting_motor_torque', label: 'BMS Limiting Motor Torque' },
        { id: 'bms_limiting_regen_torque', label: 'BMS Limiting Regen Torque' },
        { id: 'limit_max_speed', label: 'Max Speed Limit Active' },
        { id: 'limit_hot_spot', label: 'Hot Spot Limit Active' },
        { id: 'limit_coolant_derating', label: 'Coolant Derating Active' },
        { id: 'low_speed_limiting', label: 'Low Speed Limiting' },
      ], 'state', 4, { precision: 0 }),
    ],
  },
  {
    id: 'inv_io',
    name: 'Inverter IO / Commands',
    signals: [
      ...makeInverterSignals('inv.cmd', [
        { id: 'torque_command', label: 'VCU Torque Command' },
        { id: 'speed_command', label: 'VCU Speed Command' },
        { id: 'direction_command', label: 'VCU Direction Command' },
        { id: 'inverter_enable', label: 'VCU Inverter Enable' },
        { id: 'inverter_discharge', label: 'VCU Inverter Discharge' },
        { id: 'rolling_counter', label: 'VCU Rolling Counter' },
        { id: 'torque_limit_command', label: 'VCU Torque Limit Command' },
      ], 'cmd', 1, { precision: 0 }),
      ...makeInverterSignals('inv.all', [
        { id: 'digital_input_1', label: 'Digital Input 1' },
        { id: 'digital_input_2', label: 'Digital Input 2' },
        { id: 'digital_input_3', label: 'Digital Input 3' },
        { id: 'digital_input_4', label: 'Digital Input 4' },
        { id: 'digital_input_5', label: 'Digital Input 5' },
        { id: 'digital_input_6', label: 'Digital Input 6' },
        { id: 'digital_input_7', label: 'Digital Input 7' },
        { id: 'digital_input_8', label: 'Digital Input 8' },
        { id: 'analog_input_1', label: 'Analog Input 1' },
        { id: 'analog_input_2', label: 'Analog Input 2' },
        { id: 'analog_input_3', label: 'Analog Input 3' },
        { id: 'analog_input_4', label: 'Analog Input 4' },
        { id: 'analog_input_5', label: 'Analog Input 5' },
        { id: 'analog_input_6', label: 'Analog Input 6' },
      ], 'io', 7, { precision: 2 }),
    ],
  },
  {
    id: 'inv_diag',
    name: 'Inverter Diagnostics',
    signals: [
      ...makeInverterSignals('inv.all', [
        { id: 'modulation_index', label: 'Modulation Index' },
        { id: 'motor_angle_electrical', label: 'Motor Angle Electrical' },
        { id: 'delta_resolver_filtered', label: 'Delta Resolver Filtered' },
        { id: 'diag_record', label: 'Diag Record' },
        { id: 'diag_segment_m', label: 'Diag Segment' },
        { id: 'diag_gamma_resolver_m0', label: 'Diag Gamma Resolver' },
        { id: 'diag_gamma_observer_m0', label: 'Diag Gamma Observer' },
        { id: 'diag_sin_used_m0', label: 'Diag Sin Used' },
        { id: 'diag_cos_used_m1', label: 'Diag Cos Used' },
        { id: 'diag_ia_m1', label: 'Diag Ia' },
        { id: 'diag_ib_m1', label: 'Diag Ib' },
        { id: 'diag_ic_m2', label: 'Diag Ic' },
        { id: 'diag_vdc_m2', label: 'Diag Vdc' },
        { id: 'diag_iq_cmd_m2', label: 'Diag Iq Cmd' },
        { id: 'diag_id_cmd_m3', label: 'Diag Id Cmd' },
        { id: 'diag_mod_index_m3', label: 'Diag Mod Index' },
        { id: 'diag_fw_output_m3', label: 'Diag FW Output' },
        { id: 'diag_vq_cmd_m4', label: 'Diag Vq Cmd' },
        { id: 'diag_vd_cmd_m4', label: 'Diag Vd Cmd' },
        { id: 'diag_vqs_cmd_m4', label: 'Diag Vqs Cmd' },
        { id: 'diag_pwm_freq_m5', label: 'Diag PWM Freq' },
        { id: 'diag_run_faults_lo_m5', label: 'Diag Run Faults Lo' },
        { id: 'diag_run_faults_hi_m5', label: 'Diag Run Faults Hi' },
        { id: 'project_code_eep_ver', label: 'Project Code EEP Version' },
        { id: 'sw_version', label: 'Software Version' },
        { id: 'datecode_mmdd', label: 'Date Code MMDD' },
        { id: 'datecode_yyyy', label: 'Date Code YYYY' },
      ], 'diag', 3),
    ],
  },
  {
    id: 'vcu',
    name: 'VCU',
    signals: [
      makeSignal('vcu.spd', 'Vehicle Speed', 'MPH', '#00e5ff'),
      makeSignal('vcu.req_tq', 'Requested Torque', 'Nm', '#70d6ff'),
      makeSignal('vcu.apps1', 'APPS 1', '%', '#ffb800'),
      makeSignal('vcu.apps2', 'APPS 2', '%', '#ff2a4d'),
      makeSignal('vcu.bse', 'BSE', '%', '#00ff7f'),
      makeSignal('vcu.rtd', 'RTD State', 'state', '#caffbf', { precision: 0 }),
      makeSignal('vcu.imd_fault', 'IMD Fault', 'state', '#ff70a6', { precision: 0 }),
      makeSignal('vcu.precharge', 'Precharge Relay', 'state', '#ffd670', { precision: 0 }),
      makeSignal('vcu.air_pos', 'AIR+ Relay', 'state', '#9bf6ff', { precision: 0 }),
      makeSignal('vcu.air_neg', 'AIR- Relay', 'state', '#bdb2ff', { precision: 0 }),
      makeSignal('vcu.crosscheck', 'Crosscheck State', 'state', '#8cffc1', { precision: 0 }),
      makeSignal('vcu.apps_plausible', 'APPS Plausible', 'state', '#caffbf', { precision: 0 }),
      makeSignal('vcu.looking_for_rtd', 'Looking For RTD', 'state', '#ffd6a5', { precision: 0 }),
    ],
  },
  {
    id: 'vcu_raw',
    name: 'VCU Raw CAN',
    signals: [
      makeSignal('vcu.all.calc_vehicle_speed', 'CAN Vehicle Speed', 'MPH', '#00e5ff'),
      makeSignal('vcu.all.requested_torque', 'CAN Requested Torque', 'Nm', '#70d6ff'),
      makeSignal('vcu.all.apps1_as_percent', 'CAN APPS1', '%', '#ffb800'),
      makeSignal('vcu.all.apps2_as_percent', 'CAN APPS2', '%', '#ff2a4d'),
      makeSignal('vcu.all.bse_as_percent', 'CAN BSE', '%', '#00ff7f'),
      makeSignal('vcu.all.imd_fault', 'CAN IMD Fault', 'state', '#ff70a6', { precision: 0 }),
      makeSignal('vcu.all.rtd_state', 'CAN RTD State', 'state', '#caffbf', { precision: 0 }),
      makeSignal('vcu.all.precharge_relay_state', 'CAN Precharge Relay', 'state', '#ffd670', { precision: 0 }),
      makeSignal('vcu.all.air_pos_relay_state', 'CAN AIR+ Relay', 'state', '#9bf6ff', { precision: 0 }),
      makeSignal('vcu.all.air_neg_relay_state', 'CAN AIR- Relay', 'state', '#bdb2ff', { precision: 0 }),
      makeSignal('vcu.all.crosscheck_state', 'CAN Crosscheck', 'state', '#8cffc1', { precision: 0 }),
      makeSignal('vcu.all.apps_plausible', 'CAN APPS Plausible', 'state', '#caffbf', { precision: 0 }),
      makeSignal('vcu.all.looking_for_rtd', 'CAN Looking For RTD', 'state', '#ffd6a5', { precision: 0 }),
    ],
  },
  {
    id: 'fusebox',
    name: 'Fusebox',
    signals: [
      makeSignal('fusebox.state', 'Fusebox State', 'state', '#9bf6ff', { precision: 0 }),
      makeSignal('fusebox.dcdc_v', 'DCDC Voltage', 'mV', '#00e5ff'),
      makeSignal('fusebox.battery_v', 'Battery Voltage', 'mV', '#00ff7f'),
      makeSignal('fusebox.lvb_soc', 'LVB SOC', '%', '#ffb800'),
      makeSignal('fusebox.dcdc_temp', 'DCDC Temp', '°C', '#ff2a4d'),
      makeSignal('fusebox.accy_fan_power', 'Accessory Fan Power', 'W', '#70d6ff'),
      makeSignal('fusebox.tractive_fan_power', 'Tractive Fan Power', 'W', '#8cffc1'),
      makeSignal('fusebox.tractive_pumps_power', 'Tractive Pumps Power', 'W', '#ffd670'),
      makeSignal('fusebox.charging_power', 'Charging Power', 'W', '#ff70a6'),
      makeSignal('fusebox.ambient_temp', 'Ambient Temp', '°C', '#caffbf'),
    ],
  },
  {
    id: 'fusebox_raw',
    name: 'Fusebox Raw CAN',
    signals: [
      makeSignal('fusebox.all.fusebox_state', 'CAN Fusebox State', 'state', '#9bf6ff', { precision: 0 }),
      makeSignal('fusebox.all.dcdc_voltage', 'CAN DCDC Voltage', 'mV', '#00e5ff'),
      makeSignal('fusebox.all.battery_voltage', 'CAN Battery Voltage', 'mV', '#00ff7f'),
      makeSignal('fusebox.all.lvb_soc', 'CAN LVB SOC', '%', '#ffb800'),
      makeSignal('fusebox.all.dcdc_temp', 'CAN DCDC Temp', '°C', '#ff2a4d'),
      makeSignal('fusebox.all.accy_fan_power', 'CAN Accessory Fan Power', 'W', '#70d6ff'),
      makeSignal('fusebox.all.tractive_fan_power', 'CAN Tractive Fan Power', 'W', '#8cffc1'),
      makeSignal('fusebox.all.tractive_pumps_power', 'CAN Tractive Pumps Power', 'W', '#ffd670'),
      makeSignal('fusebox.all.charging_power', 'CAN Charging Power', 'W', '#ff70a6'),
      makeSignal('fusebox.all.ambient_temp', 'CAN Ambient Temp', '°C', '#caffbf'),
    ],
  },
  {
    id: 'imu',
    name: 'IMU (Center of Gravity)',
    signals: [
      makeSignal('imu.ax', 'Accel X', 'g', '#ff2a4d'),
      makeSignal('imu.ay', 'Accel Y', 'g', '#00ff7f'),
      makeSignal('imu.az', 'Accel Z', 'g', '#00e5ff'),
      makeSignal('imu.pitch', 'Pitch', '°', '#ffb800'),
      makeSignal('imu.roll', 'Roll', '°', '#ff70a6'),
      makeSignal('imu.yaw', 'Yaw', '°', '#70d6ff'),
    ],
  },
  {
    id: 'imu_triple',
    name: 'Triple IMU Sensors',
    signals: [
      makeSignal('imu[0].ax', 'COG Accel X', 'g', '#00e5ff'),
      makeSignal('imu[0].ay', 'COG Accel Y', 'g', '#00e5ff'),
      makeSignal('imu[0].az', 'COG Accel Z', 'g', '#00e5ff'),
      makeSignal('imu[0].pitch', 'COG Pitch', '°', '#00e5ff'),
      makeSignal('imu[0].roll', 'COG Roll', '°', '#00e5ff'),
      makeSignal('imu[0].yaw', 'COG Yaw', '°', '#00e5ff'),
      makeSignal('imu[1].ax', 'Front Accel X', 'g', '#00ff7f'),
      makeSignal('imu[1].ay', 'Front Accel Y', 'g', '#00ff7f'),
      makeSignal('imu[1].az', 'Front Accel Z', 'g', '#00ff7f'),
      makeSignal('imu[1].pitch', 'Front Pitch', '°', '#00ff7f'),
      makeSignal('imu[1].roll', 'Front Roll', '°', '#00ff7f'),
      makeSignal('imu[1].yaw', 'Front Yaw', '°', '#00ff7f'),
      makeSignal('imu[2].ax', 'Rear Accel X', 'g', '#ff2a4d'),
      makeSignal('imu[2].ay', 'Rear Accel Y', 'g', '#ff2a4d'),
      makeSignal('imu[2].az', 'Rear Accel Z', 'g', '#ff2a4d'),
      makeSignal('imu[2].pitch', 'Rear Pitch', '°', '#ff2a4d'),
      makeSignal('imu[2].roll', 'Rear Roll', '°', '#ff2a4d'),
      makeSignal('imu[2].yaw', 'Rear Yaw', '°', '#ff2a4d'),
    ],
  },
];

['FL', 'FR', 'RL', 'RR'].forEach((pos, idx) => {
  signalGroups.push({
    id: `sdu_${idx}`,
    name: `SDU ${pos}`,
    signals: [
      makeSignal(`sdu[${idx}].shock`, `${pos} Shock Pot`, 'mm', '#00e5ff'),
      makeSignal(`sdu[${idx}].brake`, `${pos} Brake Temp`, '°C', '#ff2a4d'),
      makeSignal(`sdu[${idx}].wrpm`, `${pos} Wheel Speed`, 'RPM', '#00ff7f'),
      makeSignal(`sdu[${idx}].tire[0]`, `${pos} Tire Max Temp`, '°C', '#ffb800'),
      makeSignal(`sdu[${idx}].tire[1]`, `${pos} Tire Min Temp`, '°C', '#00ffff'),
      makeSignal(`sdu[${idx}].tire[2]`, `${pos} Tire Ctr Temp`, '°C', '#70d6ff'),
      makeSignal(`sdu[${idx}].tire[3]`, `${pos} Tire Amb Temp`, '°C', '#aaaaaa'),
    ],
  });
});

['0', '1'].forEach((boardId, idx) => {
  signalGroups.push({
    id: `tspmu_${idx}`,
    name: `TSPMU Board ${boardId}`,
    signals: [
      makeSignal(`tspmu[${idx}].p1`, `Board ${boardId} Pressure 1`, 'Pa', '#ffd670'),
      makeSignal(`tspmu[${idx}].p2`, `Board ${boardId} Pressure 2`, 'Pa', '#ffb800'),
      makeSignal(`tspmu[${idx}].temps[0]`, `Board ${boardId} Temp 1`, '°C', '#70d6ff'),
      makeSignal(`tspmu[${idx}].temps[1]`, `Board ${boardId} Temp 2`, '°C', '#9bf6ff'),
      makeSignal(`tspmu[${idx}].temps[2]`, `Board ${boardId} Temp 3`, '°C', '#8cffc1'),
      makeSignal(`tspmu[${idx}].temps[3]`, `Board ${boardId} Temp 4`, '°C', '#caffbf'),
    ],
  });
});

signalGroups.push({
  id: 'tshmu',
  name: 'TSHMU Flow',
  signals: [
    makeSignal('tshmu.flow1', 'Flow 1', 'L/min', '#00e5ff'),
    makeSignal('tshmu.flow2', 'Flow 2', 'L/min', '#00ff7f'),
    makeSignal('tshmu.jitter_us', 'Flow Jitter', 'us', '#ffb800', { precision: 0 }),
    makeSignal('tshmu.error_flags', 'Flow Error Flags', 'bits', '#ff70a6', { precision: 0 }),
  ],
});

export const ALL_SIGNALS = signalGroups.flatMap(group => group.signals);
export const SIGNAL_MAP = Object.fromEntries(ALL_SIGNALS.map(signal => [signal.id, signal]));

export const liveChartGroups = [
  { id: 'bms-pack-voltage', title: 'Pack Voltage', signals: ['bms.v'] },
  { id: 'bms-pack-current', title: 'Pack Current / DCL', signals: ['bms.i', 'bms.dcl'] },
  { id: 'bms-soc', title: 'State Of Charge', signals: ['bms.soc'] },
  { id: 'bms-cell-temp', title: 'Cell Temperatures', signals: ['bms.avg_t', 'bms.hi_t', 'bms.lo_t'] },
  { id: 'bms-cell-voltage', title: 'Cell Voltages', signals: ['bms.avg_cv', 'bms.hi_cv', 'bms.lo_cv'] },
  { id: 'inv-torque', title: 'Inverter Torque', signals: ['inv.tq_cmd', 'inv.tq_fb', 'inv.all.torque_shudder'] },
  { id: 'inv-current', title: 'Inverter Currents', signals: ['inv.idc', 'inv.all.phase_a_current', 'inv.all.phase_b_current', 'inv.all.phase_c_current'] },
  { id: 'inv-temp', title: 'Inverter Temperatures', signals: ['inv.mot_t', 'inv.cool_t', 'inv.all.hot_spot_temp', 'inv.all.module_a_temp', 'inv.all.module_b_temp', 'inv.all.module_c_temp'] },
  { id: 'inv-voltage', title: 'Inverter Voltages', signals: ['inv.vdc', 'inv.all.output_voltage', 'inv.all.fast_dc_bus_voltage'] },
  { id: 'inv-speed', title: 'Motor Speed', signals: ['inv.rpm', 'inv.all.fast_motor_speed'] },
  { id: 'vcu-pedals', title: 'Pedal Inputs', signals: ['vcu.apps1', 'vcu.apps2', 'vcu.bse'] },
  { id: 'vcu-state', title: 'VCU State', signals: ['vcu.rtd', 'vcu.imd_fault', 'vcu.precharge', 'vcu.air_pos', 'vcu.air_neg', 'vcu.crosscheck', 'vcu.apps_plausible', 'vcu.looking_for_rtd'] },
  { id: 'fusebox-voltage', title: 'Fusebox Voltages', signals: ['fusebox.dcdc_v', 'fusebox.battery_v', 'fusebox.lvb_soc'] },
  { id: 'fusebox-power', title: 'Fusebox Power Draw', signals: ['fusebox.accy_fan_power', 'fusebox.tractive_fan_power', 'fusebox.tractive_pumps_power', 'fusebox.charging_power'] },
  { id: 'fusebox-temp', title: 'Fusebox Temperatures', signals: ['fusebox.dcdc_temp', 'fusebox.ambient_temp'] },
  { id: 'sdu-shock-pots', title: 'Shock Pots', signals: ['sdu[0].shock', 'sdu[1].shock', 'sdu[2].shock', 'sdu[3].shock'] },
  { id: 'sdu-wheel-speed', title: 'Wheel Speeds', signals: ['sdu[0].wrpm', 'sdu[1].wrpm', 'sdu[2].wrpm', 'sdu[3].wrpm'] },
  { id: 'imu-lateral-comparison', title: 'Lateral Accel Comparison', signals: ['imu[0].ay', 'imu[1].ay', 'imu[2].ay'] },
  { id: 'imu-longitudinal-comparison', title: 'Longitudinal Accel Comparison', signals: ['imu[0].ax', 'imu[1].ax', 'imu[2].ax'] },
];

export function getSignalDefinition(signalId) {
  return SIGNAL_MAP[signalId] || makeSignal(signalId, signalId, '', '#9aa0aa');
}

export function getSignalValue(data, signalId) {
  if (!data) return undefined;
  if (signalId.startsWith('imu[')) {
    const normalizedImu = signalId.replace(/^imu/, 'imus').replace(/\[(\d+)\]/g, '.$1');
    const imuParts = normalizedImu.split('.');
    let imuValue = data;
    for (const part of imuParts) {
      imuValue = imuValue != null ? imuValue[part] : undefined;
    }
    return imuValue;
  }
  const normalized = signalId.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalized.split('.');
  let value = data;
  for (const part of parts) {
    value = value != null ? value[part] : undefined;
  }
  return value;
}

export function flattenTelemetryData(data) {
  const flat = {};

  const walk = (value, prefix) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, `${prefix}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        walk(child, nextPrefix);
      });
      return;
    }
    flat[prefix] = value;
  };

  walk(data?.gps || {}, 'gps');
  walk(data?.imu || {}, 'imu');
  walk(data?.imus || [], 'imu');
  walk(data?.inv || {}, 'inv');
  walk(data?.bms || {}, 'bms');
  walk(data?.vcu || {}, 'vcu');
  walk(data?.fusebox || {}, 'fusebox');
  walk(data?.sdu || {}, 'sdu');
  walk(data?.tspmu || {}, 'tspmu');
  walk(data?.tshmu || {}, 'tshmu');
  flat.ts = data?.ts;
  return flat;
}

export function formatSignalValue(signal, value) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '--';
  }
  if (typeof value !== 'number') {
    return String(value);
  }
  if (signal?.precision !== undefined) {
    return value.toFixed(signal.precision);
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0);
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

export function getSignalsByIds(ids) {
  return ids.map(getSignalDefinition);
}

export function buildChartGroupsForSignals(signalIds) {
  const available = new Set(signalIds);
  const groups = liveChartGroups
    .map(group => ({
      ...group,
      signals: group.signals.filter(signalId => available.has(signalId)),
    }))
    .filter(group => group.signals.length > 0);

  const used = new Set(groups.flatMap(group => group.signals));
  const leftovers = signalIds.filter(signalId => !used.has(signalId) && signalId !== 'ts');

  leftovers.forEach(signalId => {
    groups.push({
      id: `extra-${signalId}`,
      title: getSignalDefinition(signalId).name,
      signals: [signalId],
    });
  });

  return groups;
}
