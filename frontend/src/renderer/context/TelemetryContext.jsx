import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const TelemetryContext = createContext(null);

const initialSignalState = {
  // GPS
  'gps.lat': 0.0, 'gps.lon': 0.0, 'gps.alt': 0.0, 'gps.vel': 0.0, 'gps.hdg': 0.0,
  'gps.fix': 0, 'gps.fix_quality': 0, 'gps.rtk_state': 'no_fix', 'gps.sats': 0, 'gps.hdop': 99.99,
  'gps.heading_valid': 0, 'gps.heading_quality': 0, 'gps.heading_source': 'course_over_ground',
  'gps.heading_accuracy_deg': 0.0, 'gps.baseline_m': 0.0, 'gps.pitch_deg': 0.0, 'gps.error_flags': 0,

  // IMU
  'imu.ax': 0.0, 'imu.ay': 0.0, 'imu.az': 1.0,
  'imu.pitch': 0.0, 'imu.roll': 0.0, 'imu.yaw': 0.0,
  'imu[0].ax': 0.0, 'imu[0].ay': 0.0, 'imu[0].az': 1.0, 'imu[0].pitch': 0.0, 'imu[0].roll': 0.0, 'imu[0].yaw': 0.0,
  'imu[1].ax': 0.0, 'imu[1].ay': 0.0, 'imu[1].az': 1.0, 'imu[1].pitch': 0.0, 'imu[1].roll': 0.0, 'imu[1].yaw': 0.0,
  'imu[2].ax': 0.0, 'imu[2].ay': 0.0, 'imu[2].az': 1.0, 'imu[2].pitch': 0.0, 'imu[2].roll': 0.0, 'imu[2].yaw': 0.0,

  // SDU 0..3
  'sdu[0].shock': 0.0, 'sdu[0].brake': 0.0, 'sdu[0].wrpm': 0.0,
  'sdu[0].tire[0]': 0.0, 'sdu[0].tire[1]': 0.0, 'sdu[0].tire[2]': 0.0, 'sdu[0].tire[3]': 0.0,
  'sdu[1].shock': 0.0, 'sdu[1].brake': 0.0, 'sdu[1].wrpm': 0.0,
  'sdu[1].tire[0]': 0.0, 'sdu[1].tire[1]': 0.0, 'sdu[1].tire[2]': 0.0, 'sdu[1].tire[3]': 0.0,
  'sdu[2].shock': 0.0, 'sdu[2].brake': 0.0, 'sdu[2].wrpm': 0.0,
  'sdu[2].tire[0]': 0.0, 'sdu[2].tire[1]': 0.0, 'sdu[2].tire[2]': 0.0, 'sdu[2].tire[3]': 0.0,
  'sdu[3].shock': 0.0, 'sdu[3].brake': 0.0, 'sdu[3].wrpm': 0.0,
  'sdu[3].tire[0]': 0.0, 'sdu[3].tire[1]': 0.0, 'sdu[3].tire[2]': 0.0, 'sdu[3].tire[3]': 0.0,

  // TSPMU 0..1
  'tspmu[0].p1': 0.0, 'tspmu[0].p2': 0.0,
  'tspmu[0].temps[0]': 0.0, 'tspmu[0].temps[1]': 0.0, 'tspmu[0].temps[2]': 0.0, 'tspmu[0].temps[3]': 0.0,
  'tspmu[1].p1': 0.0, 'tspmu[1].p2': 0.0,
  'tspmu[1].temps[0]': 0.0, 'tspmu[1].temps[1]': 0.0, 'tspmu[1].temps[2]': 0.0, 'tspmu[1].temps[3]': 0.0,

  // TSHMU
  'tshmu[0].flow1': 0.0, 'tshmu[0].flow2': 0.0, 'tshmu[0].jitter_us': 0, 'tshmu[0].error_flags': 0,
  'tshmu[1].flow1': 0.0, 'tshmu[1].flow2': 0.0, 'tshmu[1].jitter_us': 0, 'tshmu[1].error_flags': 0,

  // Inverter New Signals
  'inv.all.control_board_temp': 0.0, 'inv.all.rtd1_temp': 0.0, 'inv.all.rtd2_temp': 0.0, 'inv.all.stall_burst_model_temp': 0.0,
  'inv.all.analog1': 0.0, 'inv.all.analog2': 0.0, 'inv.all.analog3': 0.0, 'inv.all.analog4': 0.0, 'inv.all.analog5': 0.0, 'inv.all.analog6': 0.0,
  'inv.all.dig1': 0, 'inv.all.dig2': 0, 'inv.all.dig3': 0, 'inv.all.dig4': 0, 'inv.all.dig5': 0, 'inv.all.dig6': 0, 'inv.all.dig7': 0, 'inv.all.dig8': 0,
  'inv.all.vd_ff': 0.0, 'inv.all.vq_ff': 0.0, 'inv.all.id': 0.0, 'inv.all.iq': 0.0,
  'inv.all.ref_voltage_1_5': 0.0, 'inv.all.ref_voltage_2_5': 0.0, 'inv.all.ref_voltage_5_0': 0.0, 'inv.all.ref_voltage_12_0': 0.0,
  'inv.all.post_fault_lo': 0, 'inv.all.post_fault_hi': 0, 'inv.all.run_fault_lo': 0, 'inv.all.run_fault_hi': 0,
  'inv.all.modulation_index': 0.0, 'inv.all.flux_weakening_output': 0.0, 'inv.all.id_command': 0.0, 'inv.all.iq_command': 0.0,
  'inv.all.eeprom_ver': 0, 'inv.all.sw_ver': 0, 'inv.all.date_mmdd': 0, 'inv.all.date_yyyy': 0,
  'inv.all.diag_record': 0,
  'inv.all.torque_cap_motor': 0.0, 'inv.all.torque_cap_regen': 0.0,
  'inv.cmd.torque_command': 0.0, 'inv.cmd.speed_command': 0.0, 'inv.cmd.direction_command': 0, 'inv.cmd.inverter_enable': 0, 'inv.cmd.inverter_discharge': 0, 'inv.cmd.speed_mode': 0, 'inv.cmd.torque_limit_command': 0.0,

  // BMS New
  'bms.max_discharge': 0.0, 'bms.max_charge': 0.0, 'bms.precharge_complete': 0,

  // VCU New
  'vcu.all.calc_vehicle_speed': 0, 'vcu.all.requested_torque': 0, 'vcu.all.apps1_as_percent': 0, 'vcu.all.apps2_as_percent': 0, 'vcu.all.bse_as_percent': 0,
  'vcu.all.imd_fault': 0, 'vcu.all.rtd_state': 0, 'vcu.all.precharge_relay_state': 0, 'vcu.all.air_pos_relay_state': 0, 'vcu.all.air_neg_relay_state': 0,
  'vcu.all.cooling_enable': 0, 'vcu.all.tractive_fan_pwm': 0, 'vcu.all.tractive_pump_pwm': 0, 'vcu.all.accy_fan_pwm': 0, 'vcu.all.precharge_cmd': 0,

  // Fusebox New
  'fusebox.all.fusebox_state': 0, 'fusebox.all.dcdc_voltage': 0.0, 'fusebox.all.battery_voltage': 0.0, 'fusebox.all.lvb_soc': 0, 'fusebox.all.dcdc_temp': 0.0,
  'fusebox.all.accy_fan_power': 0.0, 'fusebox.all.tractive_fan_power': 0.0, 'fusebox.all.tractive_pumps_power': 0.0, 'fusebox.all.charging_power': 0.0,
  'fusebox.all.ambient_temp': 0.0,
};

function decodeStandardCan(id, dataBytes) {
  if (!dataBytes || dataBytes.length === 0) return null;
  
  function toSigned16(value) {
    return value > 32767 ? value - 65536 : value;
  }
  
  if (id === 1712) { // BMS Voltages
    return {
      'bms.avg_cv': (dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'bms.lo_cv': (dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'bms.hi_cv': (dataBytes[4] | (dataBytes[5] << 8)) / 100,
    };
  }
  if (id === 1713) { // BMS Temperatures
    return {
      'bms.avg_t': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'bms.hi_t': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'bms.lo_t': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 100,
    };
  }
  if (id === 1714) { // BMS SOC, Current, Voltage
    return {
      'bms.soc': (dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'bms.i': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'bms.v': (dataBytes[4] | (dataBytes[5] << 8)) / 100,
    };
  }
  if (id === 160) { // Inverter IGBT temps
    return {
      'inv.all.module_a_temp': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.all.module_b_temp': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.all.module_c_temp': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.all.gate_driver_board_temp': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 162) { // Inverter coolant & motor temp
    return {
      'inv.cool_t': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.mot_t': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
    };
  }
  if (id === 165) { // Inverter motor speed
    return {
      'inv.rpm': toSigned16(dataBytes[2] | (dataBytes[3] << 8)),
    };
  }
  if (id === 166) { // Inverter phase currents
    return {
      'inv.all.phase_a_current': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.all.phase_b_current': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.all.phase_c_current': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.idc': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 167) { // Inverter DC bus voltage
    return {
      'inv.vdc': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
    };
  }
  if (id === 170) { // Inverter VSM state
    return {
      'inv.all.vsm_state': dataBytes[0] | (dataBytes[1] << 8),
      'inv.all.inverter_state': dataBytes[2] | (dataBytes[3] << 8),
    };
  }
  if (id === 172) { // Inverter torque CMD & feedback
    return {
      'inv.tq_cmd': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.tq_fb': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
    };
  }
  if (id === 176) { // Inverter fast info
    return {
      'inv.rpm': toSigned16(dataBytes[0] | (dataBytes[1] << 8)),
      'inv.vdc': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.tq_cmd': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.tq_fb': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  // IMU simple frames — accel (0x4F5, 0x4F7, 0x4F9) and attitude (0x4F6, 0x4F8, 0x4FA)
  if (id >= 0x4F5 && id <= 0x4FA && dataBytes.length >= 6) {
    const boardIdx = (id - 0x4F5) >> 1;
    const isAccel  = ((id - 0x4F5) & 1) === 0;
    const key = `imu[${boardIdx}]`;
    if (isAccel) {
      const ax = toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 1000.0;
      const ay = toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 1000.0;
      const az = toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 1000.0;
      const out = { [`${key}.ax`]: ax, [`${key}.ay`]: ay, [`${key}.az`]: az };
      if (boardIdx === 0) { out['imu.ax'] = ax; out['imu.ay'] = ay; out['imu.az'] = az; }
      return out;
    } else {
      const pitch = toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 100.0;
      const roll  = toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100.0;
      const yaw   = toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 100.0;
      const out = { [`${key}.pitch`]: pitch, [`${key}.roll`]: roll, [`${key}.yaw`]: yaw };
      if (boardIdx === 0) { out['imu.pitch'] = pitch; out['imu.roll'] = roll; out['imu.yaw'] = yaw; }
      return out;
    }
  }

  // --- NEW SIGNALS FROM BFR_DRIVE_BUS ---

  if (id === 161) {
    return {
      'inv.all.control_board_temp': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.all.rtd1_temperature': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.all.rtd2_temperature': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.all.stall_burst_model_temp': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 163) {
    const a1 = ((dataBytes[0] | (dataBytes[1] << 8)) & 0x3FF) / 100;
    const a2 = (((dataBytes[1] >> 2) | (dataBytes[2] << 6)) & 0x3FF) / 100;
    const a3 = (((dataBytes[2] >> 4) | (dataBytes[3] << 4)) & 0x3FF) / 100;
    const a4 = ((dataBytes[4] | (dataBytes[5] << 8)) & 0x3FF) / 100;
    const a5 = (((dataBytes[5] >> 2) | (dataBytes[6] << 6)) & 0x3FF) / 100;
    const a6 = (((dataBytes[6] >> 4) | (dataBytes[7] << 4)) & 0x3FF) / 100;
    return {
      'inv.all.analog_input_1': a1, 'inv.all.analog_input_2': a2, 'inv.all.analog_input_3': a3,
      'inv.all.analog_input_4': a4, 'inv.all.analog_input_5': a5, 'inv.all.analog_input_6': a6,
    };
  }
  if (id === 164) {
    return {
      'inv.all.digital_input_1': dataBytes[0] & 1, 'inv.all.digital_input_2': dataBytes[1] & 1,
      'inv.all.digital_input_3': dataBytes[2] & 1, 'inv.all.digital_input_4': dataBytes[3] & 1,
      'inv.all.digital_input_5': dataBytes[4] & 1, 'inv.all.digital_input_6': dataBytes[5] & 1,
      'inv.all.digital_input_7': dataBytes[6] & 1, 'inv.all.digital_input_8': dataBytes[7] & 1,
    };
  }
  if (id === 168) {
    return {
      'inv.all.vd_ff': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.all.vq_ff': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.all.id': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.all.iq': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 169) {
    return {
      'inv.all.ref_voltage_1_5': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 100,
      'inv.all.ref_voltage_2_5': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 100,
      'inv.all.ref_voltage_5_0': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 100,
      'inv.all.ref_voltage_12_0': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 100,
    };
  }
  if (id === 171) {
    return {
      'inv.all.post_fault_lo': dataBytes[0] | (dataBytes[1] << 8),
      'inv.all.post_fault_hi': dataBytes[2] | (dataBytes[3] << 8),
      'inv.all.run_fault_lo': dataBytes[4] | (dataBytes[5] << 8),
      'inv.all.run_fault_hi': dataBytes[6] | (dataBytes[7] << 8),
    };
  }
  if (id === 173) {
    return {
      'inv.all.modulation_index': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10000,
      'inv.all.flux_weakening_output': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
      'inv.all.id_command': toSigned16(dataBytes[4] | (dataBytes[5] << 8)) / 10,
      'inv.all.iq_command': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 174) {
    return {
      'inv.all.eeprom_ver': dataBytes[0] | (dataBytes[1] << 8),
      'inv.all.sw_ver': dataBytes[2] | (dataBytes[3] << 8),
      'inv.all.date_mmdd': dataBytes[4] | (dataBytes[5] << 8),
      'inv.all.date_yyyy': dataBytes[6] | (dataBytes[7] << 8),
    };
  }
  if (id === 175) {
    return { 'inv.all.diag_record': dataBytes[0] };
  }
  if (id === 177) {
    return {
      'inv.all.torque_cap_motor': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.all.torque_cap_regen': toSigned16(dataBytes[2] | (dataBytes[3] << 8)) / 10,
    };
  }
  if (id === 192) {
    return {
      'inv.cmd.torque_command': toSigned16(dataBytes[0] | (dataBytes[1] << 8)) / 10,
      'inv.cmd.speed_command': toSigned16(dataBytes[2] | (dataBytes[3] << 8)),
      'inv.cmd.direction_command': dataBytes[4] & 1,
      'inv.cmd.inverter_enable': (dataBytes[5] & 1),
      'inv.cmd.inverter_discharge': (dataBytes[5] >> 1) & 1,
      'inv.cmd.speed_mode': (dataBytes[5] >> 2) & 1,
      'inv.cmd.torque_limit_command': toSigned16(dataBytes[6] | (dataBytes[7] << 8)) / 10,
    };
  }
  if (id === 514) {
    return {
      'bms.max_discharge': (dataBytes[0] | (dataBytes[1] << 8)),
      'bms.max_charge': (dataBytes[2] | (dataBytes[3] << 8)),
    };
  }
  if (id === 1715) {
    return { 'bms.precharge_complete': dataBytes[0] & 1 };
  }
  if (id === 1280) {
    return {
      'vcu.all.calc_vehicle_speed': toSigned16(dataBytes[0] | (dataBytes[1] << 8)),
      'vcu.all.requested_torque': toSigned16(dataBytes[2] | (dataBytes[3] << 8)),
      'vcu.all.apps1_as_percent': (dataBytes[4] > 127 ? dataBytes[4] - 256 : dataBytes[4]),
      'vcu.all.apps2_as_percent': (dataBytes[5] > 127 ? dataBytes[5] - 256 : dataBytes[5]),
      'vcu.all.bse_as_percent': (dataBytes[6] > 127 ? dataBytes[6] - 256 : dataBytes[6]),
      'vcu.all.imd_fault': dataBytes[7] & 1,
      'vcu.all.rtd_state': (dataBytes[7] >> 1) & 1,
      'vcu.all.precharge_relay_state': (dataBytes[7] >> 2) & 1,
      'vcu.all.air_pos_relay_state': (dataBytes[7] >> 3) & 1,
      'vcu.all.air_neg_relay_state': (dataBytes[7] >> 4) & 1,
    };
  }
  if (id === 1281) {
    return {
      'vcu.all.cooling_enable': dataBytes[0],
      'vcu.all.tractive_fan_pwm': dataBytes[1],
      'vcu.all.tractive_pump_pwm': dataBytes[2],
      'vcu.all.accy_fan_pwm': dataBytes[3],
    };
  }
  if (id === 1282) {
    return { 'vcu.all.precharge_cmd': dataBytes[0] };
  }
  if (id === 1264) {
    return {
      'fusebox.all.fusebox_state': dataBytes[0],
      'fusebox.all.dcdc_voltage': (dataBytes[1] | (dataBytes[2] << 8)),
      'fusebox.all.battery_voltage': (dataBytes[3] | (dataBytes[4] << 8)),
      'fusebox.all.lvb_soc': dataBytes[5],
      'fusebox.all.dcdc_temp': dataBytes[6] * 10,
    };
  }
  if (id === 1265) {
    return {
      'fusebox.all.accy_fan_power': (dataBytes[0] | (dataBytes[1] << 8)) * 100,
      'fusebox.all.tractive_fan_power': (dataBytes[2] | (dataBytes[3] << 8)) * 100,
      'fusebox.all.tractive_pumps_power': (dataBytes[4] | (dataBytes[5] << 8)) * 100,
      'fusebox.all.charging_power': (dataBytes[6] | (dataBytes[7] << 8)) * 100,
    };
  }
  if (id === 1266) {
    return { 'fusebox.all.ambient_temp': dataBytes[0] };
  }
  return null;
}

function updateStateFromBoard(state, board, id, dataBytes) {
  if (board) {
    if (board.signals) {
      Object.assign(state, board.signals);
      return;
    }
    const bt = board.boardType;
    const bid = board.boardId;
    
    if (bt === 2) { // SDU
      if (board.shockMm !== undefined) state[`sdu[${bid}].shock`] = board.shockMm;
      if (board.brakeC !== undefined) state[`sdu[${bid}].brake`] = board.brakeC;
      if (board.rpm !== undefined) state[`sdu[${bid}].wrpm`] = board.rpm;
      if (board.tireC !== undefined) {
        state[`sdu[${bid}].tire[0]`] = board.tireC.max;
        state[`sdu[${bid}].tire[1]`] = board.tireC.min;
        state[`sdu[${bid}].tire[2]`] = board.tireC.center;
        state[`sdu[${bid}].tire[3]`] = board.tireC.ambient;
      }
    } else if (bt === 4) { // TSHMU
      if (board.flow1 !== undefined) state[`tshmu[${bid}].flow1`] = board.flow1;
      if (board.flow2 !== undefined) state[`tshmu[${bid}].flow2`] = board.flow2;
      if (board.jitter !== undefined) state[`tshmu[${bid}].jitter_us`] = board.jitter;
      if (board.errorFlags !== undefined) state[`tshmu[${bid}].error_flags`] = board.errorFlags;
    } else if (bt === 6) { // TSPMU
      if (board.pressure1 !== undefined) state[`tspmu[${bid}].p1`] = board.pressure1;
      if (board.pressure2 !== undefined) state[`tspmu[${bid}].p2`] = board.pressure2;
      if (board.tempBlocks && board.tempBlocks[0]) {
        state[`tspmu[${bid}].temps[0]`] = board.tempBlocks[0].temp1;
        state[`tspmu[${bid}].temps[1]`] = board.tempBlocks[0].temp2;
        state[`tspmu[${bid}].temps[2]`] = board.tempBlocks[0].temp3;
        state[`tspmu[${bid}].temps[3]`] = board.tempBlocks[0].temp4;
      } else if (board.tspmuTemp1 !== undefined) {
        state[`tspmu[${bid}].temps[0]`] = board.tspmuTemp1;
        state[`tspmu[${bid}].temps[1]`] = board.tspmuTemp2;
        state[`tspmu[${bid}].temps[2]`] = board.tspmuTemp3;
        state[`tspmu[${bid}].temps[3]`] = board.tspmuTemp4;
      }
    } else if (bt === 7 || bt === 1) { // GPS / SMU
      if (board.gpsPos) {
        state['gps.lat'] = board.gpsPos.latDeg;
        state['gps.lon'] = board.gpsPos.lonDeg;
        state['gps.alt'] = board.gpsPos.altM;
        state['gps.fix'] = board.gpsPos.fixValid;
        state['gps.fix_quality'] = board.gpsPos.fixQuality;
        state['gps.sats'] = board.gpsPos.satellites;
        state['gps.hdop'] = board.gpsPos.hdop;
        state['gps.error_flags'] = board.gpsPos.errorFlags;
      } else if (board.gpsNav) {
        state['gps.vel'] = board.gpsNav.velMps;
        state['gps.hdg'] = board.gpsNav.headingDeg;
        state['gps.heading_valid'] = board.gpsNav.headingValid;
        state['gps.heading_quality'] = board.gpsNav.headingQuality;
        state['gps.baseline_m'] = board.gpsNav.baselineM;
        state['gps.pitch_deg'] = board.gpsNav.pitchDeg;
        state['gps.error_flags'] = board.gpsNav.errorFlags;
      } else if (board.latitude_deg !== undefined) {
        state['gps.lat'] = board.latitude_deg;
        state['gps.lon'] = board.longitude_deg;
        state['gps.alt'] = board.altitude_m;
        state['gps.fix'] = board.fix_valid;
        state['gps.fix_quality'] = board.fix_quality;
        state['gps.sats'] = board.satellites;
        state['gps.hdop'] = board.hdop;
      } else if (board.velocity_mps !== undefined) {
        state['gps.vel'] = board.velocity_mps;
        state['gps.hdg'] = board.course_deg;
        state['gps.heading_valid'] = board.heading_valid;
        state['gps.heading_quality'] = board.heading_quality;
      }
      
      if (board.accelX !== undefined) {
        state['imu.ax'] = board.accelX / 1000.0;
        state['imu.ay'] = board.accelY / 1000.0;
        state['imu.az'] = board.accelZ / 1000.0;
        
        const stateIdx = `imu[${bid}]`;
        state[`${stateIdx}.ax`] = board.accelX / 1000.0;
        state[`${stateIdx}.ay`] = board.accelY / 1000.0;
        state[`${stateIdx}.az`] = board.accelZ / 1000.0;
        state[`${stateIdx}.pitch`] = board.veloX / 100.0;
        state[`${stateIdx}.roll`] = board.veloY / 100.0;
        state[`${stateIdx}.yaw`] = board.veloZ / 100.0;
      }
    }
  } else if (id !== undefined && dataBytes) {
    const dec = decodeStandardCan(id, dataBytes);
    if (dec) {
      for (const [k, v] of Object.entries(dec)) {
        state[k] = v;
      }
    }
  }
}

export function TelemetryProvider({ children }) {
  const [isLiveMode, setIsLiveMode] = useState(true);
  const [latestValues, setLatestValues] = useState({ ...initialSignalState });
  const [activeDataset, setActiveDataset] = useState([]);
  const [currentFilePath, setCurrentFilePath] = useState('');
  
  // Folder loading state
  const [folderPath, setFolderPath] = useState('');
  const [folderFiles, setFolderFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Playback engine state
  const [isReplaying, setIsReplaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isRawCanDataset, setIsRawCanDataset] = useState(false);
  const [playbackDataset, setPlaybackDataset] = useState([]);
  const playbackRef = useRef({ lastRealTime: 0, lastIndexSent: 0, lastBinTime: 0 });

  // Live monitor statistics
  const [availablePorts, setAvailablePorts] = useState([]);
  const [connectionState, setConnectionState] = useState({ connected: false, port: null, baudRate: 115200 });
  const [diagnostics, setDiagnostics] = useState({});
  const [logStatus, setLogStatus] = useState({ active: false, filePath: null, linesWritten: 0, bytesWritten: 0 });
  
  const logStatusRef = useRef(logStatus);
  useEffect(() => {
    logStatusRef.current = logStatus;
  }, [logStatus]);

  // WiFi Telemetry State
  const [activeTransport, setActiveTransport] = useState('serial'); // 'serial' or 'wifi'
  const [targetIp, setTargetIp] = useState('');
  const [wifiState, setWifiState] = useState('disconnected'); // 'disconnected', 'connecting', 'connected', 'reconnecting', 'degraded'
  const [wifiMessage, setWifiMessage] = useState('Waiting for telemetry link.');
  const [isWifiLogging, setIsWifiLogging] = useState(false);
  const [wifiLogs, setWifiLogs] = useState([]);
  const [isScanningNetwork, setIsScanningNetwork] = useState(false);

  // Refs for tracking live state
  const latestStateRef = useRef({ ...initialSignalState });
  const liveBufferRef = useRef([]);
  const liveStartMsRef = useRef(0);
  const liveIntervalRef = useRef(null);

  // Tracks whether the USB/serial transport is currently connected.
  // Used by WiFi-side stop logic to avoid killing the binning loop while USB is still streaming.
  const serialConnectedRef = useRef(false);

  // WiFi Telemetry Refs
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const healthTimerRef = useRef(null);
  const connectGenerationRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const lastMessageAtRef = useRef(0);
  const targetIpRef = useRef('');

  const reverseRenameKey = (key) => {
    if (key === 'ts' || key === 'id_dec' || key === 'data_hex') return key;
    
    // Reverse physical locations back to array indices
    const boardPositions = { 'FL': 0, 'FR': 1, 'RL': 2, 'RR': 3 };
    const m = key.match(/^([A-Z0-9]+)_(SDU|TSPMU|TSHMU)_(.*)$/);
    if (m) {
      const pos = m[1];
      const prefix = m[2].toLowerCase();
      const rest = m[3].toLowerCase();
      
      let idx = boardPositions[pos];
      if (idx === undefined && pos.startsWith('B')) {
        idx = parseInt(pos.substring(1));
      }
      
      if (idx !== undefined) {
        return `${prefix}[${idx}].${rest}`;
      }
    }
    
    return key.toLowerCase();
  };

  // Load a file for playback
  const loadRunFile = async (filePath) => {
    setLoading(true);
    setError(null);
    try {
      const data = await window.mduDebug.parseTelemetryFile(filePath);
      if (data && data.length > 0) {
        // Reverse map keys back to internal UI format
        const mappedData = data.map(row => {
          const newRow = {};
          for (const [k, v] of Object.entries(row)) {
            newRow[reverseRenameKey(k)] = v;
          }
          return newRow;
        });

        // Filter out dummy/initialization rows with zero or very low timestamps
        const cleanedData = mappedData.filter(row => {
          const ts = parseFloat(row.ts);
          return !isNaN(ts) && ts > 1000000.0; // Filter timestamps (e.g. posix timestamp or large uptime)
        });
        
        // If no valid timestamps found with the 1 million filter, just use the raw data (might be seconds from 0)
        let finalData = cleanedData.length > 0 ? cleanedData : mappedData;
        
        // Ensure sorted by time
        finalData.sort((a, b) => parseFloat(a.ts || 0) - parseFloat(b.ts || 0));

        // Robustly detect raw CAN datasets by checking headers, rather than relying on filename
        const isRaw = (finalData.length > 0 && finalData[0].id_dec !== undefined && finalData[0].data_hex !== undefined) || filePath.toUpperCase().includes('_CAN.CSV');
        setIsRawCanDataset(isRaw);
        setActiveDataset(finalData);
        setCurrentFilePath(filePath);
        setIsLiveMode(false);
        setIsReplaying(false);
        setPlaybackTime(0);
        setPlaybackDataset([]);
        liveBufferRef.current = [];
        playbackRef.current = { lastRealTime: 0, lastIndexSent: 0, lastBinTime: 0, time: 0 };
        
        if (finalData.length > 1) {
          const start = parseFloat(finalData[0].ts || 0);
          const end = parseFloat(finalData[finalData.length - 1].ts || 0);
          setPlaybackDuration(end - start);
        } else {
          setPlaybackDuration(0);
        }
        
      } else {
        setError('Parsed file was empty.');
      }
    } catch (e) {
      setError(`Failed to parse telemetry file: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Select a local folder to scan
  const selectDataFolder = async () => {
    try {
      const selected = await window.mduDebug.selectDataFolder();
      if (selected) {
        setFolderPath(selected);
        localStorage.setItem('mdu_data_folder', selected);
        await scanFolder(selected);
      }
    } catch (e) {
      setError(`Error selecting folder: ${e.message}`);
    }
  };

  const scanFolder = async (path) => {
    setLoading(true);
    try {
      const files = await window.mduDebug.scanFolder(path);
      setFolderFiles(files || []);
    } catch (e) {
      setError(`Error scanning folder: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Auto load folder on mount
  useEffect(() => {
    const savedFolder = localStorage.getItem('mdu_data_folder') || '/Users/larry/mk11-data-visualization/data';
    setFolderPath(savedFolder);
    scanFolder(savedFolder);
  }, []);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const stopHealthMonitor = () => {
    if (healthTimerRef.current) {
      clearInterval(healthTimerRef.current);
      healthTimerRef.current = null;
    }
  };

  const closeSocket = () => {
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const requestJson = async (path, options = {}, overrideIp) => {
    const ip = overrideIp || targetIpRef.current;
    if (!ip) {
      throw new Error('No Raspberry Pi IP is selected.');
    }

    const response = await fetch(`http://${ip}:8000${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
  };

  const refreshStatus = async (overrideIp) => {
    const status = await requestJson('/api/status', {}, overrideIp);
    setIsWifiLogging(Boolean(status.is_logging));
    return status;
  };

  const fetchWifiLogs = async () => {
    try {
      const logs = await requestJson('/api/logs');
      setWifiLogs(logs || []);
      return logs;
    } catch (err) {
      console.error('Error fetching wifi logs:', err);
      return [];
    }
  };

  const fetchWifiLogFile = async (token, filename) => {
    try {
      const response = await fetch(`http://${targetIpRef.current}:8000/api/logs/${token}`);
      if (!response.ok) {
        throw new Error(`Failed to download log: ${response.status}`);
      }
      const csvContent = await response.text();
      
      // Automatically save to the active local folder
      if (folderPath && filename) {
        const localPath = `${folderPath}/${filename}`;
        const writeResult = await window.mduDebug.writeFile(localPath, csvContent);
        if (writeResult.success) {
          await scanFolder(folderPath);
        } else {
          console.error('Failed to write downloaded CSV locally:', writeResult.error);
        }
      }
      return csvContent;
    } catch (err) {
      console.error('Error fetching log file:', err);
      throw err;
    }
  };

  const toggleWifiLogging = async (selectedSignalIds = [], filename = '') => {
    const shouldStart = !isWifiLogging;
    if (!targetIpRef.current) {
      throw new Error('Connect to the Pi before changing logging state.');
    }

    if (shouldStart) {
      await requestJson('/api/logging/start', {
        method: 'POST',
        body: JSON.stringify({ signals: selectedSignalIds, filename }),
      });
    } else {
      await requestJson('/api/logging/stop', { method: 'POST' });
    }

    await refreshStatus();
    await fetchWifiLogs();
  };

  const scheduleReconnect = () => {
    clearReconnectTimer();
    if (manualDisconnectRef.current || !targetIpRef.current) {
      setWifiState('disconnected');
      setWifiMessage('Telemetry link idle.');
      return;
    }

    reconnectAttemptRef.current += 1;
    const attempt = reconnectAttemptRef.current;
    const delayMs = Math.min(1500 * attempt, 5000);

    setWifiState('reconnecting');
    setWifiMessage(`Link dropped. Reconnecting in ${(delayMs / 1000).toFixed(1)}s...`);

    reconnectTimerRef.current = setTimeout(async () => {
      let nextIp = targetIpRef.current;
      if (window.mduDebug && attempt % 3 === 0) {
        try {
          const scannedIp = await window.mduDebug.scanNetwork();
          if (scannedIp) {
            nextIp = scannedIp;
            targetIpRef.current = scannedIp;
            setTargetIp(scannedIp);
          }
        } catch (err) {
          console.error('Autoscan during reconnect failed', err);
        }
      }

      if (nextIp) {
        connectWifi(nextIp);
      }
    }, delayMs);
  };

  const startHealthMonitor = () => {
    stopHealthMonitor();
    healthTimerRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      if (Date.now() - lastMessageAtRef.current > 15000) {
        setWifiState('degraded');
        setWifiMessage(`Streaming from ${targetIpRef.current} • waiting for fresh frames`);
      }
    }, 1000);
  };

  const connectWifi = (ip) => {
    const nextIp = (ip || '').trim();
    if (!nextIp) return;

    manualDisconnectRef.current = false;
    setActiveTransport('wifi');
    clearReconnectTimer();
    stopHealthMonitor();
    closeSocket();

    // NOTE: We intentionally do NOT disconnect the USB serial port here.
    // Both the USB (MDU binary frames) and WiFi (CAN bus frames) transports
    // run simultaneously and merge into the same latestStateRef.

    targetIpRef.current = nextIp;
    setTargetIp(nextIp);
    localStorage.setItem('telemetry:lastIp', nextIp);

    const generation = connectGenerationRef.current + 1;
    connectGenerationRef.current = generation;
    setWifiState('connecting');
    setWifiMessage(`Connecting to ${nextIp}...`);

    const socket = new WebSocket(`ws://${nextIp}:8000/ws`);
    wsRef.current = socket;

    socket.onopen = async () => {
      if (generation !== connectGenerationRef.current) {
        socket.close();
        return;
      }
      reconnectAttemptRef.current = 0;
      setWifiState('connected');
      setWifiMessage(`Streaming from ${nextIp}.`);
      lastMessageAtRef.current = Date.now();
      startHealthMonitor();
      try {
        await refreshStatus(nextIp);
        await fetchWifiLogs();
      } catch (err) {
        console.error('Status refresh failed', err);
      }
    };

    socket.onmessage = async (event) => {
      if (generation !== connectGenerationRef.current) return;
      try {
        const rawPayload = JSON.parse(event.data);
        const frames = Array.isArray(rawPayload) ? rawPayload : [rawPayload];
        
        // Use the batched IPC call for much higher throughput
        const parsedFrames = await window.mduDebug.parseWifiFrames(frames);
        for (const parsedFrame of parsedFrames) {
          if (parsedFrame && parsedFrame.ok) {
            updateStateFromBoard(
              latestStateRef.current,
              parsedFrame.board,
              parsedFrame.identifier,
              parsedFrame.dataBytes,
            );
          }
        }
        
        lastMessageAtRef.current = Date.now();
        setWifiState('connected');
        setWifiMessage(`Streaming from ${nextIp}.`);
        if (logStatusRef.current.active) {
          window.mduDebug.logWiFiFrame({
            type: 'wifi_raw_frame',
            timestamp: new Date().toISOString(),
            frame: rawPayload,
          });
        }
      } catch (err) {
        console.error('Telemetry parsing error', err);
      }
    };

    socket.onclose = () => {
      if (generation !== connectGenerationRef.current) return;
      stopHealthMonitor();
      if (manualDisconnectRef.current) {
        setWifiState('disconnected');
        setWifiMessage('Telemetry link disconnected.');
        return;
      }
      scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  };

  const disconnectWifi = () => {
    manualDisconnectRef.current = true;
    clearReconnectTimer();
    stopHealthMonitor();
    closeSocket();
    setWifiState('disconnected');
    setWifiMessage('Telemetry link disconnected.');
  };

  const scanNetwork = async () => {
    setIsScanningNetwork(true);
    try {
      const foundIp = await window.mduDebug.scanNetwork();
      if (foundIp) {
        connectWifi(foundIp);
      } else {
        alert('No Telemetry Hub found on local network.');
      }
    } catch (err) {
      console.error('Network scan failed', err);
    } finally {
      setIsScanningNetwork(false);
    }
  };

  // Set up live listeners
  useEffect(() => {
    // Initial states
    window.mduDebug.getInitialState().then(state => {
      setConnectionState(state.connection || { connected: false, port: null, baudRate: 115200 });
      setDiagnostics(state.diagnostics || {});
      setLogStatus(state.logStatus || { active: false, filePath: null, linesWritten: 0, bytesWritten: 0 });
    });

    const unsubPorts = window.mduDebug.onPorts((ports) => {
      setAvailablePorts(ports || []);
    });

    const unsubConnection = window.mduDebug.onConnection((conn) => {
      setConnectionState(conn || { connected: false, port: null, baudRate: 115200 });
      
      if (conn.connected) {
        // USB/serial just connected (or re-connected).
        // Mark as primary transport for the UI label, but do NOT kill WiFi —
        // both streams run simultaneously and merge into latestStateRef.
        serialConnectedRef.current = true;
        setActiveTransport('serial');
        setIsLiveMode(true);

        // Only reset the buffer/state when the binning loop isn't already running
        // (e.g. WiFi was already streaming — just let USB data merge in).
        if (!liveIntervalRef.current) {
          liveStartMsRef.current = Date.now();
          liveBufferRef.current = [];
          latestStateRef.current = { ...initialSignalState };

          liveIntervalRef.current = setInterval(() => {
            const nowMs = Date.now();
            const tsSeconds = (nowMs - liveStartMsRef.current) / 1000;
            liveBufferRef.current.push({ ts: tsSeconds.toFixed(3), ...latestStateRef.current });
            if (liveBufferRef.current.length > 2000) liveBufferRef.current.shift();
            setLatestValues({ ...latestStateRef.current });
            setActiveDataset([...liveBufferRef.current]);
          }, 100);
        }
      } else {
        // USB/serial disconnected — only stop the binning loop if WiFi is also down.
        serialConnectedRef.current = false;
        if (liveIntervalRef.current && !wsRef.current) {
          clearInterval(liveIntervalRef.current);
          liveIntervalRef.current = null;
        }
      }
    });

    const unsubDiagnostics = window.mduDebug.onDiagnostics((diag) => {
      setDiagnostics(diag || {});
    });

    const unsubLogStatus = window.mduDebug.onLogStatus((status) => {
      setLogStatus(status || { active: false, filePath: null, linesWritten: 0, bytesWritten: 0 });
    });

    // Always process USB frames regardless of which transport is "active".
    // Both USB and WiFi streams write into the same latestStateRef concurrently.
    const unsubFrames = window.mduDebug.onFrames((frames) => {
      if (Array.isArray(frames)) {
        for (const frame of frames) {
          if (frame && frame.ok) {
            updateStateFromBoard(
              latestStateRef.current,
              frame.board,
              frame.identifier || frame.board?.identifier,
              frame.dataBytes || frame.board?.dataBytes
            );
          }
        }
      }
    });

    const unsubWifiSnapshot = window.mduDebug.onWifiSnapshot((snapshot) => {
      if (snapshot && snapshot.flat) {
        Object.assign(latestStateRef.current, snapshot.flat);
      }
    });

    // Check for standard listing refresh
    window.mduDebug.listPorts();

    return () => {
      unsubPorts();
      unsubConnection();
      unsubDiagnostics();
      unsubLogStatus();
      unsubFrames();
      unsubWifiSnapshot();
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    };
  }, []);

  // WiFi binning setup effect: when WiFi connects, start (or keep) the 10 Hz binning loop.
  // When WiFi disconnects, only stop the loop if USB/serial is also down.
  useEffect(() => {
    if (wifiState === 'connected') {
      setIsLiveMode(true);

      // Only reset the buffer/state when the binning loop isn't already running
      // (e.g. USB was already streaming — just let WiFi CAN data merge in).
      if (!liveIntervalRef.current) {
        liveStartMsRef.current = Date.now();
        liveBufferRef.current = [];
        latestStateRef.current = { ...initialSignalState };

        liveIntervalRef.current = setInterval(() => {
          const nowMs = Date.now();
          const tsSeconds = (nowMs - liveStartMsRef.current) / 1000;
          liveBufferRef.current.push({ ts: tsSeconds.toFixed(3), ...latestStateRef.current });
          if (liveBufferRef.current.length > 2000) liveBufferRef.current.shift();
          setLatestValues({ ...latestStateRef.current });
          setActiveDataset([...liveBufferRef.current]);
        }, 100);
      }
    } else {
      // WiFi dropped — only stop the binning loop if USB is also disconnected.
      if (liveIntervalRef.current && !serialConnectedRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    }
  }, [wifiState]);

  // Try auto-connecting WiFi on mount
  useEffect(() => {
    const savedIp = localStorage.getItem('telemetry:lastIp');
    if (savedIp) {
      targetIpRef.current = savedIp;
      setTargetIp(savedIp);
      setTimeout(() => {
        if (!manualDisconnectRef.current && !wsRef.current) {
          connectWifi(savedIp);
        }
      }, 0);
    } else if (window.mduDebug) {
      window.mduDebug.scanNetwork().then((foundIp) => {
        if (foundIp && !manualDisconnectRef.current && !wsRef.current) {
          connectWifi(foundIp);
        }
      }).catch((err) => {
        console.error('Initial auto-scan failed', err);
      });
    }

    return () => {
      clearReconnectTimer();
      stopHealthMonitor();
      closeSocket();
    };
  }, []);

  const connectSerial = async (portPath, baudRate) => {
    // NOTE: We intentionally do NOT disconnect WiFi here.
    // USB (MDU binary frames) and WiFi (CAN frames) run concurrently.
    return await window.mduDebug.connect({ path: portPath, baudRate: parseInt(baudRate, 10) });
  };

  const disconnectSerial = async () => {
    return await window.mduDebug.disconnect();
  };

  const startLogging = async (filePath) => {
    return await window.mduDebug.startLogging(filePath);
  };

  const stopLogging = async () => {
    return await window.mduDebug.stopLogging();
  };

  const clearLiveSession = () => {
    window.mduDebug.clearSession();
    liveBufferRef.current = [];
    setActiveDataset([]);
    liveStartMsRef.current = Date.now();
  };

  const toggleLiveMode = () => {
    setIsLiveMode(true);
    setActiveDataset([...liveBufferRef.current]);
    setCurrentFilePath('');
  };

  const seekTime = (t) => {
    playbackRef.current.time = t;
    playbackRef.current.lastBinTime = t;
    setPlaybackTime(t);

    if (!activeDataset || activeDataset.length === 0) return;

    const startTs = parseFloat(activeDataset[0].ts || 0);
    const targetTs = startTs + t;

    let bestIndex = 0;
    for (let i = 0; i < activeDataset.length; i++) {
      if (parseFloat(activeDataset[i].ts) >= targetTs) {
        bestIndex = i;
        break;
      }
      bestIndex = i;
    }

    playbackRef.current.lastIndexSent = bestIndex > 0 ? bestIndex - 1 : 0;

    if (bestIndex >= 0 && bestIndex < activeDataset.length) {
      Object.assign(latestStateRef.current, activeDataset[bestIndex]);
      setLatestValues({ ...latestStateRef.current });
      
      const bufferStartIdx = Math.max(0, bestIndex - 2000);
      liveBufferRef.current = activeDataset.slice(bufferStartIdx, bestIndex + 1);
      setPlaybackDataset([...liveBufferRef.current]);
    }
  };

  // Replay Engine Loop
  useEffect(() => {
    if (!isReplaying || isLiveMode || !activeDataset || activeDataset.length === 0) return;

    const startRealTime = performance.now();
    const startLogTime = playbackRef.current.time;
    let animationFrameId;
    let isCancelled = false;

    const tick = async () => {
      if (isCancelled) return;
      
      const now = performance.now();
      const elapsedRealSeconds = (now - startRealTime) / 1000.0;
      
      let newTime = startLogTime + (elapsedRealSeconds * playbackSpeed);
      
      if (newTime >= playbackDuration) {
        newTime = playbackDuration;
        setIsReplaying(false);
      }

      const startTs = parseFloat(activeDataset[0].ts || 0);
      const endTsTarget = startTs + newTime;
      const startTsTarget = startTs + playbackRef.current.time;

      if (isRawCanDataset) {
        let startIndex = playbackRef.current.lastIndexSent;
        if (startIndex > 0 && parseFloat(activeDataset[startIndex].ts) > startTsTarget) {
          startIndex = 0; // handle backwards scrubbing
        }

        const framesToParse = [];
        let i = startIndex;
        for (; i < activeDataset.length; i++) {
          const row = activeDataset[i];
          const rowTs = parseFloat(row.ts);
          if (rowTs > endTsTarget) break;
          if (rowTs >= startTsTarget) {
            framesToParse.push({ id: parseInt(row.id_dec), d: row.data_hex });
          }
        }
        playbackRef.current.lastIndexSent = i;

        if (framesToParse.length > 0) {
          try {
            const parsedFrames = await window.mduDebug.parseWifiFrames(framesToParse);
            if (isCancelled) return;
            for (const parsedFrame of parsedFrames) {
              if (parsedFrame && parsedFrame.ok) {
                updateStateFromBoard(
                  latestStateRef.current,
                  parsedFrame.board,
                  parsedFrame.identifier,
                  parsedFrame.dataBytes
                );
              }
            }
            setLatestValues({ ...latestStateRef.current });
          } catch (err) {
            console.error('Replay parsing error', err);
          }
        }
      } else {
        // Fallback for pre-parsed DECODED.csv datasets
        let closestRow = null;
        let minDiff = Infinity;
        let startIndex = playbackRef.current.lastIndexSent;
        if (startIndex > 0 && parseFloat(activeDataset[startIndex].ts) > startTsTarget) {
          startIndex = 0;
        }
        
        let i = startIndex;
        let bestIndex = startIndex;
        for (; i < activeDataset.length; i++) {
          const diff = Math.abs(parseFloat(activeDataset[i].ts) - endTsTarget);
          if (diff < minDiff) {
            minDiff = diff;
            closestRow = activeDataset[i];
            bestIndex = i;
          }
          if (parseFloat(activeDataset[i].ts) > endTsTarget) {
             break;
          }
        }
        // Save bestIndex so we don't accidentally skip ahead by breaking early
        playbackRef.current.lastIndexSent = bestIndex > 0 ? bestIndex - 1 : 0;
        
        if (closestRow) {
          Object.assign(latestStateRef.current, closestRow);
          setLatestValues({ ...latestStateRef.current });
        }
      }

      if (!isCancelled) {
        playbackRef.current.time = newTime;
        setPlaybackTime(newTime);
        
        // Bin into the playback dataset for sliding-window charts
        if (newTime - playbackRef.current.lastBinTime >= 0.1 || newTime < playbackRef.current.lastBinTime) {
          if (newTime < playbackRef.current.lastBinTime) {
             // User scrubbed backwards; clear the buffer
             liveBufferRef.current = [];
          }
          playbackRef.current.lastBinTime = newTime;
          liveBufferRef.current.push({ ts: endTsTarget.toFixed(3), ...latestStateRef.current });
          if (liveBufferRef.current.length > 2000) liveBufferRef.current.shift();
          setPlaybackDataset([...liveBufferRef.current]);
        }
      }
      
      if (newTime < playbackDuration && !isCancelled) {
        animationFrameId = requestAnimationFrame(tick);
      }
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animationFrameId);
    };
  }, [isReplaying, playbackSpeed, isLiveMode, activeDataset, playbackDuration, isRawCanDataset]);

  return (
    <TelemetryContext.Provider
      value={{
        isLiveMode,
        latestValues,
        activeDataset,
        currentFilePath,
        folderPath,
        folderFiles,
        loading,
        error,
        availablePorts,
        connectionState,
        diagnostics,
        logStatus,
        isRawCanDataset,
        isReplaying,
        playbackTime,
        playbackSpeed,
        playbackDuration,
        playbackDataset,
        setIsReplaying,
        setPlaybackTime: seekTime,
        setPlaybackSpeed,
        loadRunFile,
        selectDataFolder,
        scanFolder: () => scanFolder(folderPath),
        connectSerial,
        disconnectSerial,
        startLogging,
        stopLogging,
        clearLiveSession,
        toggleLiveMode,

        // WiFi/Pi Integrations
        activeTransport,
        targetIp,
        wifiState,
        wifiMessage,
        isWifiLogging,
        wifiLogs,
        isScanningNetwork,
        connectWifi,
        disconnectWifi,
        toggleWifiLogging,
        fetchWifiLogs,
        fetchWifiLogFile,
        scanNetwork,
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return context;
}
