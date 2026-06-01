"""
FENRIR Pit Sync Telemetry Hub — Backend Engine
===============================================
The unified Python backend that runs on the Raspberry Pi.

Four asynchronous loops:
  A. MDU Serial Reader — reads SLCAN frames from USB CDC, decodes via DBC + SDU parsers
  B. Mock Data Generator — simulates all sensors for laptop testing
  C. CSV Logger — 30s rolling buffer + trigger-based file writes at 10Hz
  D. WebSocket Broadcaster — pushes decoded telemetry at 50Hz to all connected clients
"""

from __future__ import annotations

import asyncio
import base64
import json
import math
import os
import time
import csv
import re
import glob
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from slcan_parser import parse_slcan_frame, SlcanFrame
from dbc_decoder import decode_can_frame
from sdu_decoder import decode_sdu_frame, parse_sdu_id, BOARD_TYPE_SDU, BOARD_TYPE_TSPMU

SDU_STALE_LIMITS = {
    'shock_mm': 0.5,
    'brake_c': 4.0,
    'wheel_rpm': 4.0,
    'tire': 3.0,
}
FUSEBOX_STALE_LIMITS = {
    'state': 3.0,
    'power': 3.0,
    'ambient_temp': 3.0,
}


def normalize_signal_name(name: str, prefix: str) -> str:
    """Convert DBC signal names into frontend-safe lowercase keys."""
    trimmed = name[len(prefix):] if name.startswith(prefix) else name
    normalized = re.sub(r'[^a-zA-Z0-9]+', '_', trimmed).strip('_').lower()
    return normalized


def flatten_value_map(value, prefix: str, out: dict[str, float | int | bool | None]) -> None:
    """Flatten nested broadcast dictionaries into dot/bracket paths."""
    if isinstance(value, dict):
        for key, child in value.items():
            child_prefix = f"{prefix}.{key}" if prefix else key
            flatten_value_map(child, child_prefix, out)
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            child_prefix = f"{prefix}[{index}]"
            flatten_value_map(child, child_prefix, out)
        return
    out[prefix] = value

# ---------------------------------------------------------------------------
# Global Telemetry State
# ---------------------------------------------------------------------------

class TelemetryState:
    """
    The master telemetry state object. All loops read/write this.
    Kept flat for O(1) snapshot construction (no deep copies needed).
    """

    def __init__(self):
        self.timestamp: float = 0.0

        # GPS (from SMU via CAN 0x4F3, 0x4F4)
        self.gps_lat: float = 0.0
        self.gps_lon: float = 0.0
        self.gps_alt: float = 0.0
        self.gps_vel: float = 0.0
        self.gps_heading: float = 0.0
        self.gps_fix: int = 0
        self.gps_sats: int = 0

        # IMU (from SMU via CAN 0x4F5, 0x4F6)
        self.imu_ax: float = 0.0
        self.imu_ay: float = 0.0
        self.imu_az: float = 0.0
        self.imu_pitch: float = 0.0
        self.imu_roll: float = 0.0
        self.imu_yaw: float = 0.0
        self.imu_cal: int = 0

        # Triple IMU state (0 = COG, 1 = Front, 2 = Rear)
        self.imus = [
            {
                'ax': 0.0, 'ay': 0.0, 'az': 0.0,
                'pitch': 0.0, 'roll': 0.0, 'yaw': 0.0,
                'cal': 0
            }
            for _ in range(3)
        ]

        # Inverter (CAN 0xA0-0xB1)
        self.inv_motor_speed: float = 0.0
        self.inv_motor_temp: float = 0.0
        self.inv_coolant_temp: float = 0.0
        self.inv_dc_bus_voltage: float = 0.0
        self.inv_dc_bus_current: float = 0.0
        self.inv_torque_cmd: float = 0.0
        self.inv_torque_fb: float = 0.0
        self.inv_igbt_a_temp: float = 0.0
        self.inv_igbt_b_temp: float = 0.0
        self.inv_igbt_c_temp: float = 0.0
        self.inv_gate_driver_temp: float = 0.0
        self.inv_vsm_state: int = 0
        self.inv_inverter_state: int = 0
        self.inv_run_fault_lo: int = 0
        self.inv_run_fault_hi: int = 0
        self.inv_post_fault_lo: int = 0
        self.inv_post_fault_hi: int = 0

        # BMS (Orion BMS 2 via CAN 0x6B0-0x6B2)
        self.bms_pack_voltage: float = 0.0
        self.bms_pack_current: float = 0.0
        self.bms_soc: float = 0.0
        self.bms_avg_temp: float = 0.0
        self.bms_high_temp: float = 0.0
        self.bms_low_temp: float = 0.0
        self.bms_avg_cell_v: float = 0.0
        self.bms_high_cell_v: float = 0.0
        self.bms_low_cell_v: float = 0.0
        self.bms_dcl: float = 0.0

        # VCU (CAN 0x500)
        self.vcu_vehicle_speed: float = 0.0
        self.vcu_requested_torque: float = 0.0
        self.vcu_apps1_pct: float = 0.0
        self.vcu_apps2_pct: float = 0.0
        self.vcu_bse_pct: float = 0.0
        self.vcu_rtd_state: int = 0
        self.vcu_imd_fault: int = 0
        self.vcu_precharge_relay_state: int = 0
        self.vcu_air_pos_relay_state: int = 0
        self.vcu_air_neg_relay_state: int = 0
        self.vcu_crosscheck_state: int = 0
        self.vcu_apps_plausible: int = 0
        self.vcu_looking_for_rtd: int = 0

        # Fusebox (CAN 0x4F0)
        self.fusebox_state: float = 0.0
        self.fusebox_dcdc_v: float = 0.0
        self.fusebox_battery_v: float = 0.0
        self.fusebox_lvb_soc: float = 0.0
        self.fusebox_dcdc_temp: float = 0.0
        self.fusebox_accy_fan_power: float = 0.0
        self.fusebox_tractive_fan_power: float = 0.0
        self.fusebox_tractive_pumps_power: float = 0.0
        self.fusebox_charging_power: float = 0.0
        self.fusebox_ambient_temp: float = 0.0

        # SDU boards [0-3] = FL, FR, RL, RR — latest values only
        self.sdu = [
            {'shock_mm': 0.0, 'brake_c': 0.0, 'wheel_rpm': 0.0,
             'tire_max_c': 0, 'tire_min_c': 0, 'tire_ctr_c': 0, 'tire_amb_c': 0,
             'strain_mv': [0]*6}
            for _ in range(4)
        ]
        self.sdu_meta = [
            {'shock_mm': 0.0, 'brake_c': 0.0, 'wheel_rpm': 0.0, 'tire': 0.0, 'strain_mv': 0.0}
            for _ in range(4)
        ]

        # TSPMU boards [0-3] = FL, FR, RL, RR — latest values only
        self.tspmu = [
            {
                'pressure1': 0.0,
                'pressure2': 0.0,
                'temp1': 0.0,
                'temp2': 0.0,
                'temp3': 0.0,
                'temp4': 0.0,
            }
            for _ in range(4)
        ]
        self.tspmu_meta = [
            {'pressure': 0.0, 'temperature': 0.0}
            for _ in range(4)
        ]

        # TSHMU flow frame(s). The current firmware source explicitly defines
        # board 0 on CAN ID 0x102.
        self.tshmu = {
            'flow1': 0.0,
            'flow2': 0.0,
            'jitter_us': 0,
            'error_flags': 0,
            'base_timestamp': 0,
        }

        # Logging state
        self.is_logging: bool = False
        self.log_signal_ids: list[str] = []
        self.active_log_filename: str = ""
        self.active_log_directory: str = ""

        # Full inverter telemetry payloads
        self.inv_all: dict[str, float | int | bool] = {}
        self.inv_cmd: dict[str, float | int | bool] = {}
        self.vcu_all: dict[str, float | int | bool] = {}
        self.fusebox_all: dict[str, float | int | bool] = {}
        self.fusebox_meta = {'state': 0.0, 'power': 0.0, 'ambient_temp': 0.0}
        self.can_activity: dict[int, dict[str, float | int]] = {}

        # Frame counters
        self.frames_parsed: int = 0
        self.frames_errors: int = 0

    def update_inverter_payloads(self, signals: dict[str, float]) -> None:
        """Capture all inverter-related DBC signals for the frontend/logging layer."""
        for name, value in signals.items():
            if name.startswith('INV_'):
                self.inv_all[normalize_signal_name(name, 'INV_')] = value
            elif name.startswith('VCU_INV_'):
                self.inv_cmd[normalize_signal_name(name, 'VCU_INV_')] = value

    def update_aux_payloads(self, can_id: int, signals: dict[str, float]) -> None:
        """Capture VCU and fusebox payloads for broadcast/logging."""
        if can_id == 1280:
            for name, value in signals.items():
                self.vcu_all[normalize_signal_name(name, '')] = value
        elif can_id in (1264, 1265, 1266):
            for name, value in signals.items():
                self.fusebox_all[normalize_signal_name(name, '')] = value

    def record_can_activity(self, can_id: int, data_len: int) -> None:
        now = time.time()
        activity = self.can_activity.get(can_id)
        if activity is None:
            activity = {'count': 0, 'last_seen': now, 'data_len': data_len}
            self.can_activity[can_id] = activity
        activity['count'] = int(activity['count']) + 1
        activity['last_seen'] = now
        activity['data_len'] = data_len

    def apply_dbc_signals(self, can_id: int, signals: dict[str, float]) -> None:
        """Apply decoded DBC signals to the state object."""
        self.update_inverter_payloads(signals)
        self.update_aux_payloads(can_id, signals)

        # GPS
        if can_id == 0x4F3:
            self.gps_lat = signals.get('GPS_Latitude', self.gps_lat)
            self.gps_lon = signals.get('GPS_Longitude', self.gps_lon)
        elif can_id == 0x4F4:
            self.gps_vel = signals.get('GPS_Velocity', self.gps_vel)
            self.gps_heading = signals.get('GPS_Heading', self.gps_heading)
            self.gps_alt = signals.get('GPS_Altitude', self.gps_alt)
            self.gps_fix = int(signals.get('GPS_Fix_Valid', self.gps_fix))
            self.gps_sats = int(signals.get('GPS_Satellites', self.gps_sats))

        # IMU
        elif can_id == 0x4F5:
            self.imu_ax = signals.get('IMU_Accel_X', self.imu_ax)
            self.imu_ay = signals.get('IMU_Accel_Y', self.imu_ay)
            self.imu_az = signals.get('IMU_Accel_Z', self.imu_az)
            self.imu_cal = int(signals.get('IMU_Cal_Done', self.imu_cal))
        elif can_id == 0x4F6:
            self.imu_pitch = signals.get('IMU_Pitch', self.imu_pitch)
            self.imu_roll = signals.get('IMU_Roll', self.imu_roll)
            self.imu_yaw = signals.get('IMU_Yaw', self.imu_yaw)

        # Inverter
        elif can_id == 160:
            self.inv_igbt_a_temp = signals.get('INV_Module_A_Temp', self.inv_igbt_a_temp)
            self.inv_igbt_b_temp = signals.get('INV_Module_B_Temp', self.inv_igbt_b_temp)
            self.inv_igbt_c_temp = signals.get('INV_Module_C_Temp', self.inv_igbt_c_temp)
            self.inv_gate_driver_temp = signals.get('INV_Gate_Driver_Board_Temp', self.inv_gate_driver_temp)
        elif can_id == 162:
            self.inv_coolant_temp = signals.get('INV_Coolant_Temp', self.inv_coolant_temp)
            self.inv_motor_temp = signals.get('INV_Motor_Temp', self.inv_motor_temp)
        elif can_id == 165:
            self.inv_motor_speed = signals.get('INV_Motor_Speed', self.inv_motor_speed)
        elif can_id == 166:
            phase_a = abs(signals.get('INV_Phase_A_Current', 0.0))
            phase_b = abs(signals.get('INV_Phase_B_Current', 0.0))
            phase_c = abs(signals.get('INV_Phase_C_Current', 0.0))
            self.inv_dc_bus_current = max(phase_a, phase_b, phase_c, signals.get('INV_DC_Bus_Current', self.inv_dc_bus_current))
        elif can_id == 167:
            self.inv_dc_bus_voltage = signals.get('INV_DC_Bus_Voltage', self.inv_dc_bus_voltage)
        elif can_id == 170:
            self.inv_vsm_state = int(signals.get('INV_VSM_State', self.inv_vsm_state))
            self.inv_inverter_state = int(signals.get('INV_Inverter_State', self.inv_inverter_state))
        elif can_id == 171:
            self.inv_run_fault_lo = int(signals.get('INV_Run_Fault_Lo', self.inv_run_fault_lo))
            self.inv_run_fault_hi = int(signals.get('INV_Run_Fault_Hi', self.inv_run_fault_hi))
            self.inv_post_fault_lo = int(signals.get('INV_Post_Fault_Lo', self.inv_post_fault_lo))
            self.inv_post_fault_hi = int(signals.get('INV_Post_Fault_Hi', self.inv_post_fault_hi))
        elif can_id == 172:
            self.inv_torque_cmd = signals.get('INV_Commanded_Torque', self.inv_torque_cmd)
            self.inv_torque_fb = signals.get('INV_Torque_Feedback', self.inv_torque_fb)
        elif can_id == 176:
            self.inv_motor_speed = signals.get('INV_Fast_Motor_Speed', self.inv_motor_speed)
            self.inv_dc_bus_voltage = signals.get('INV_Fast_DC_Bus_Voltage', self.inv_dc_bus_voltage)
            self.inv_torque_cmd = signals.get('INV_Fast_Torque_Command', self.inv_torque_cmd)
            self.inv_torque_fb = signals.get('INV_Fast_Torque_Feedback', self.inv_torque_fb)

        # BMS
        elif can_id == 1712: # BMS_Voltages
            self.bms_avg_cell_v = signals.get('Avg_Cell_Voltage', self.bms_avg_cell_v)
            self.bms_high_cell_v = signals.get('High_Cell_Voltage', self.bms_high_cell_v)
            self.bms_low_cell_v = signals.get('Low_Cell_Voltage', self.bms_low_cell_v)
        elif can_id == 1713: # BMS_Temperatures
            self.bms_avg_temp = signals.get('Avg_Temperature', self.bms_avg_temp)
            self.bms_high_temp = signals.get('High_Temperature', self.bms_high_temp)
            self.bms_low_temp = signals.get('Low_Temperature', self.bms_low_temp)
            self.bms_dcl = signals.get('Pack_DCL', self.bms_dcl)
        elif can_id == 1714: # BMS_Soc_Curr_Pack
            self.bms_pack_current = signals.get('Pack_Current', self.bms_pack_current)
            self.bms_pack_voltage = signals.get('Pack_Summed_Voltage', self.bms_pack_voltage)
            self.bms_soc = signals.get('Pack_SOC', self.bms_soc)

        # VCU
        elif can_id == 1280:
            self.vcu_vehicle_speed = signals.get('Calc_Vehicle_Speed', self.vcu_vehicle_speed)
            self.vcu_requested_torque = signals.get('Requested_Torque', self.vcu_requested_torque)
            self.vcu_apps1_pct = signals.get('APPS1_as_percent', self.vcu_apps1_pct)
            self.vcu_apps2_pct = signals.get('APPS2_as_percent', self.vcu_apps2_pct)
            self.vcu_bse_pct = signals.get('BSE_as_percent', self.vcu_bse_pct)
            self.vcu_imd_fault = int(signals.get('IMD_Fault', self.vcu_imd_fault))
            self.vcu_rtd_state = int(signals.get('RTD_State', self.vcu_rtd_state))
            self.vcu_precharge_relay_state = int(signals.get('Precharge_Relay_State', self.vcu_precharge_relay_state))
            self.vcu_air_pos_relay_state = int(signals.get('AIR_POS_Relay_State', self.vcu_air_pos_relay_state))
            self.vcu_air_neg_relay_state = int(signals.get('AIR_NEG_Relay_State', self.vcu_air_neg_relay_state))
            self.vcu_crosscheck_state = int(signals.get('Crosscheck_State', self.vcu_crosscheck_state))
            self.vcu_apps_plausible = int(signals.get('APPS_Plausible', self.vcu_apps_plausible))
            self.vcu_looking_for_rtd = int(signals.get('Looking_For_RTD', self.vcu_looking_for_rtd))

        # Fusebox
        elif can_id == 1264:
            self.fusebox_state = signals.get('Fusebox_State', self.fusebox_state)
            self.fusebox_dcdc_v = signals.get('DCDC_Voltage', self.fusebox_dcdc_v)
            self.fusebox_battery_v = signals.get('Battery_Voltage', self.fusebox_battery_v)
            self.fusebox_lvb_soc = signals.get('LVB_SOC', self.fusebox_lvb_soc)
            self.fusebox_dcdc_temp = signals.get('DCDC_Temp', self.fusebox_dcdc_temp)
            self.fusebox_meta['state'] = time.time()
        elif can_id == 1265:
            self.fusebox_accy_fan_power = signals.get('Accy_Fan_Power', self.fusebox_accy_fan_power)
            self.fusebox_tractive_fan_power = signals.get('Tractive_Fan_Power', self.fusebox_tractive_fan_power)
            self.fusebox_tractive_pumps_power = signals.get('Tractive_Pumps_Power', self.fusebox_tractive_pumps_power)
            self.fusebox_charging_power = signals.get('Charging_Power', self.fusebox_charging_power)
            self.fusebox_meta['power'] = time.time()
        elif can_id == 1266:
            self.fusebox_ambient_temp = signals.get('Ambient_Temp', self.fusebox_ambient_temp)
            self.fusebox_meta['ambient_temp'] = time.time()

    def apply_imu_raw_frame(self, can_id: int, data: bytes) -> None:
        """Decode IMU frames directly using struct unpack."""
        import struct
        if len(data) < 6:
            return

        try:
            # Map CAN ID to board index and frame type
            # 0x4F5 = Board 0 Accel, 0x4F6 = Board 0 Att
            # 0x4F7 = Board 1 Accel, 0x4F8 = Board 1 Att
            # 0x4F9 = Board 2 Accel, 0x4FA = Board 2 Att
            board_idx = (can_id - 0x4F5) // 2
            is_accel = (can_id - 0x4F5) % 2 == 0

            if not (0 <= board_idx < 3):
                return

            imu = self.imus[board_idx]

            if is_accel:
                # Accel X, Y, Z as signed 16-bit little endian
                x_mg, y_mg, z_mg = struct.unpack('<hhh', data[0:6])
                imu['ax'] = round(x_mg / 1000.0, 3)
                imu['ay'] = round(y_mg / 1000.0, 3)
                imu['az'] = round(z_mg / 1000.0, 3)
                if len(data) >= 7:
                    imu['cal'] = int(data[6])
                else:
                    imu['cal'] = 0

                # Keep legacy COG values in sync
                if board_idx == 0:
                    self.imu_ax = imu['ax']
                    self.imu_ay = imu['ay']
                    self.imu_az = imu['az']
                    self.imu_cal = imu['cal']
            else:
                # Attitude Pitch, Roll, Yaw as signed 16-bit little endian in centidegrees
                pitch_cd, roll_cd, yaw_cd = struct.unpack('<hhh', data[0:6])
                imu['pitch'] = round(pitch_cd / 100.0, 1)
                imu['roll'] = round(roll_cd / 100.0, 1)
                imu['yaw'] = round(yaw_cd / 100.0, 1)

                # Keep legacy COG values in sync
                if board_idx == 0:
                    self.imu_pitch = imu['pitch']
                    self.imu_roll = imu['roll']
                    self.imu_yaw = imu['yaw']
        except Exception as e:
            self.frames_errors += 1

    def apply_sdu_frame(self, can_id: int, data: list[int]) -> None:
        """Apply a decoded SDU/TSPMU frame to the state."""
        decoded = decode_sdu_frame(can_id, data)
        if decoded is None or decoded.board_index >= 4:
            return
        now = time.time()

        if decoded.board_type == BOARD_TYPE_SDU:
            board = self.sdu[decoded.board_index]
            meta = self.sdu_meta[decoded.board_index]
            if decoded.sensor_type == 'shock_pot' and decoded.latest:
                board['shock_mm'] = decoded.latest.get('shock_mm', board['shock_mm'])
                meta['shock_mm'] = now
            elif decoded.sensor_type == 'brake_temp' and decoded.latest:
                board['brake_c'] = decoded.latest.get('brake_c', board['brake_c'])
                meta['brake_c'] = now
            elif decoded.sensor_type == 'wheel_speed' and decoded.latest:
                board['wheel_rpm'] = decoded.latest.get('wheel_rpm', board['wheel_rpm'])
                meta['wheel_rpm'] = now
            elif decoded.sensor_type == 'tire_temp' and decoded.latest:
                board['tire_max_c'] = decoded.latest.get('max_c', board['tire_max_c'])
                board['tire_min_c'] = decoded.latest.get('min_c', board['tire_min_c'])
                board['tire_ctr_c'] = decoded.latest.get('center_c', board['tire_ctr_c'])
                board['tire_amb_c'] = decoded.latest.get('ambient_c', board['tire_amb_c'])
                meta['tire'] = now
            elif decoded.sensor_type == 'strain_gauge' and decoded.latest:
                board['strain_mv'] = decoded.latest.get('channels_mv', board['strain_mv'])
                meta['strain_mv'] = now
        elif decoded.board_type == BOARD_TYPE_TSPMU:
            board = self.tspmu[decoded.board_index]
            meta = self.tspmu_meta[decoded.board_index]
            if decoded.sensor_type == 'tspmu_pressure' and decoded.latest:
                board['pressure1'] = decoded.latest.get('pressure1', board['pressure1'])
                board['pressure2'] = decoded.latest.get('pressure2', board['pressure2'])
                meta['pressure'] = now
            elif decoded.sensor_type == 'tspmu_temperature' and decoded.latest:
                board['temp1'] = decoded.latest.get('temp1', board['temp1'])
                board['temp2'] = decoded.latest.get('temp2', board['temp2'])
                board['temp3'] = decoded.latest.get('temp3', board['temp3'])
                board['temp4'] = decoded.latest.get('temp4', board['temp4'])
                meta['temperature'] = now

    def apply_tshmu_frame(self, decoded: dict[str, int | float]) -> None:
        """Apply the current TSHMU flow frame layout from mk11-tshmu firmware."""
        self.tshmu['flow1'] = float(decoded.get('flow1', self.tshmu['flow1']))
        self.tshmu['flow2'] = float(decoded.get('flow2', self.tshmu['flow2']))
        self.tshmu['jitter_us'] = int(decoded.get('jitter_us', self.tshmu['jitter_us']))
        self.tshmu['error_flags'] = int(decoded.get('error_flags', self.tshmu['error_flags']))
        self.tshmu['base_timestamp'] = int(decoded.get('base_timestamp', self.tshmu['base_timestamp']))

    def to_broadcast_dict(self) -> dict:
        """Construct the JSON payload for WebSocket broadcast."""
        now = time.time()
        return {
            'ts': round(self.timestamp, 3),
            'gps': {
                'lat': round(self.gps_lat, 7), 'lon': round(self.gps_lon, 7),
                'alt': round(self.gps_alt, 1), 'vel': round(self.gps_vel, 2),
                'hdg': round(self.gps_heading, 1),
                'fix': self.gps_fix, 'sats': self.gps_sats,
            },
            'imu': {
                'ax': round(self.imu_ax, 3), 'ay': round(self.imu_ay, 3), 'az': round(self.imu_az, 3),
                'pitch': round(self.imu_pitch, 1), 'roll': round(self.imu_roll, 1),
                'yaw': round(self.imu_yaw, 1), 'cal': self.imu_cal,
            },
            'imus': [
                {
                    'ax': round(imu['ax'], 3),
                    'ay': round(imu['ay'], 3),
                    'az': round(imu['az'], 3),
                    'pitch': round(imu['pitch'], 1),
                    'roll': round(imu['roll'], 1),
                    'yaw': round(imu['yaw'], 1),
                    'cal': imu['cal']
                }
                for imu in self.imus
            ],
            'inv': {
                'rpm': round(self.inv_motor_speed),
                'mot_t': round(self.inv_motor_temp, 1),
                'cool_t': round(self.inv_coolant_temp, 1),
                'vdc': round(self.inv_dc_bus_voltage, 1),
                'idc': round(self.inv_dc_bus_current, 1),
                'tq_cmd': round(self.inv_torque_cmd, 1),
                'tq_fb': round(self.inv_torque_fb, 1),
                'vsm': self.inv_vsm_state,
                'faults': (self.inv_run_fault_lo | self.inv_run_fault_hi |
                           self.inv_post_fault_lo | self.inv_post_fault_hi),
                'all': dict(self.inv_all),
                'cmd': dict(self.inv_cmd),
            },
            'bms': {
                'v': round(self.bms_pack_voltage, 1),
                'i': round(self.bms_pack_current, 1),
                'soc': round(self.bms_soc, 1),
                'avg_t': round(self.bms_avg_temp, 1),
                'hi_t': round(self.bms_high_temp, 1),
                'lo_t': round(self.bms_low_temp, 1),
                'avg_cv': round(self.bms_avg_cell_v, 4),
                'hi_cv': round(self.bms_high_cell_v, 4),
                'lo_cv': round(self.bms_low_cell_v, 4),
                'dcl': round(self.bms_dcl),
            },
            'vcu': {
                'spd': round(self.vcu_vehicle_speed),
                'req_tq': round(self.vcu_requested_torque, 1),
                'apps1': round(self.vcu_apps1_pct),
                'apps2': round(self.vcu_apps2_pct),
                'bse': round(self.vcu_bse_pct),
                'rtd': self.vcu_rtd_state,
                'imd_fault': self.vcu_imd_fault,
                'precharge': self.vcu_precharge_relay_state,
                'air_pos': self.vcu_air_pos_relay_state,
                'air_neg': self.vcu_air_neg_relay_state,
                'crosscheck': self.vcu_crosscheck_state,
                'apps_plausible': self.vcu_apps_plausible,
                'looking_for_rtd': self.vcu_looking_for_rtd,
                'all': dict(self.vcu_all),
            },
            'fusebox': {
                'state': round(self.fusebox_state),
                'dcdc_v': round(self.fusebox_dcdc_v, 1),
                'battery_v': round(self.fusebox_battery_v, 1),
                'lvb_soc': round(self.fusebox_lvb_soc, 1),
                'dcdc_temp': round(self.fusebox_dcdc_temp, 1),
                'accy_fan_power': round(self.fusebox_accy_fan_power, 1),
                'tractive_fan_power': round(self.fusebox_tractive_fan_power, 1),
                'tractive_pumps_power': round(self.fusebox_tractive_pumps_power, 1),
                'charging_power': round(self.fusebox_charging_power, 1),
                'ambient_temp': round(self.fusebox_ambient_temp, 1),
                'all': dict(self.fusebox_all),
                'valid': {
                    key: (now - ts) <= FUSEBOX_STALE_LIMITS[key]
                    for key, ts in self.fusebox_meta.items()
                },
            },
            'sdu': [
                {
                    'pos': ['FL', 'FR', 'RL', 'RR'][i],
                    'shock': round(b['shock_mm'], 2),
                    'brake': round(b['brake_c'], 1),
                    'wrpm': round(b['wheel_rpm'], 1),
                    'tire': [b['tire_max_c'], b['tire_min_c'], b['tire_ctr_c'], b['tire_amb_c']],
                    'valid': {
                        key: (now - self.sdu_meta[i][key]) <= SDU_STALE_LIMITS[key]
                        for key in ('shock_mm', 'brake_c', 'wheel_rpm', 'tire')
                    },
                }
                for i, b in enumerate(self.sdu)
            ],
            'tspmu': [
                {
                    'pos': ['FL', 'FR', 'RL', 'RR'][i],
                    'p1': round(b['pressure1'], 2),
                    'p2': round(b['pressure2'], 2),
                    'temps': [
                        round(b['temp1'], 1),
                        round(b['temp2'], 1),
                        round(b['temp3'], 1),
                        round(b['temp4'], 1),
                    ],
                }
                for i, b in enumerate(self.tspmu)
            ],
            'tshmu': {
                'flow1': round(self.tshmu['flow1'], 1),
                'flow2': round(self.tshmu['flow2'], 1),
                'jitter_us': self.tshmu['jitter_us'],
                'error_flags': self.tshmu['error_flags'],
            },
            'log': self.is_logging,
            'log_file': self.active_log_filename,
            'log_signal_ids': self.log_signal_ids,
            'stats': {'parsed': self.frames_parsed, 'errors': self.frames_errors},
        }

    def to_signal_map(self) -> dict[str, float | int | bool | None]:
        """Construct a flat signal-id keyed snapshot for logging and playback."""
        payload = self.to_broadcast_dict()
        flat: dict[str, float | int | bool | None] = {}
        flatten_value_map(payload.get('gps', {}), 'gps', flat)
        flatten_value_map(payload.get('imu', {}), 'imu', flat)
        flatten_value_map(payload.get('imus', []), 'imu', flat)
        flatten_value_map(payload.get('inv', {}), 'inv', flat)
        flatten_value_map(payload.get('bms', {}), 'bms', flat)
        flatten_value_map(payload.get('vcu', {}), 'vcu', flat)
        flatten_value_map(payload.get('fusebox', {}), 'fusebox', flat)
        flatten_value_map(payload.get('sdu', {}), 'sdu', flat)
        flatten_value_map(payload.get('tspmu', {}), 'tspmu', flat)
        flatten_value_map(payload.get('tshmu', {}), 'tshmu', flat)
        flat['ts'] = payload['ts']
        return flat


# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

HISTORY_SECONDS = 30
LOG_HZ = 10
BROADCAST_HZ = 50
LOG_INTERVAL_S = 1.0 / LOG_HZ
BROADCAST_INTERVAL_S = 1.0 / BROADCAST_HZ
LOG_FLUSH_ROWS = 1

STATE = TelemetryState()
HISTORY_BUFFER: deque[dict[str, float | int | bool | None]] = deque(maxlen=HISTORY_SECONDS * LOG_HZ)
active_connections: list[WebSocket] = []

# Use --mock flag or MOCK env var
MOCK_MODE = os.environ.get('TELEMETRY_MOCK', '').lower() in ('1', 'true', 'yes')


# ---------------------------------------------------------------------------
# LOOP A: USB Serial Readers
# ---------------------------------------------------------------------------

async def loop_mdu_serial():
    """Read SLCAN frames from the MDU's USB CDC port."""
    print("[SYSTEM] MDU Serial Loop Started.")

    try:
        import serial_asyncio
    except ImportError:
        print("[SYSTEM] serial_asyncio not available, skipping serial loop.")
        print("[SYSTEM] Install with: pip install pyserial-asyncio")
        return

    serial_port = os.environ.get('SERIAL_PORT', '/dev/ttyUSB0')
    serial_baud = int(os.environ.get('SERIAL_BAUD', '115200'))

    while True:
        try:
            reader, writer = await serial_asyncio.open_serial_connection(
                url=serial_port, baudrate=serial_baud
            )
            print(f"[SERIAL] Connected to {serial_port}")

            buffer = b''
            while True:
                chunk = await reader.read(4096)
                if not chunk:
                    break

                buffer += chunk

                # Split on \r (SLCAN frame delimiter)
                while b'\r' in buffer:
                    line, buffer = buffer.split(b'\r', 1)
                    try:
                        text = line.decode('utf-8', errors='ignore').strip()
                        if not text:
                            continue

                        frame = parse_slcan_frame(text)
                        if isinstance(frame, SlcanFrame):
                            STATE.frames_parsed += 1
                            _process_frame(frame)
                        else:
                            STATE.frames_errors += 1
                    except Exception as e:
                        STATE.frames_errors += 1

        except Exception as e:
            print(f"[SERIAL] Connection error: {e}. Retrying in 2s...")
            await asyncio.sleep(2)


def auto_detect_binary_serial_ports() -> list[str]:
    """Find candidate STM32 ACM ports that emit binary CAN mirror frames."""
    ports = sorted(glob.glob('/dev/ttyACM*'))
    include = os.environ.get('USB_BINARY_PORTS', '').strip()
    if include:
        return [port.strip() for port in include.split(',') if port.strip()]
    return ports


def extract_binary_can_frames(buffer: bytes) -> tuple[list[tuple[int, bytes]], bytes, int]:
    """
    Parse binary-framed CAN packets.

    Wire format observed on the Pi:
      0xAA | can_id_lo | can_id_hi | data_len | payload[data_len] | 0x55
    """
    frames: list[tuple[int, bytes]] = []
    index = 0
    errors = 0

    while index < len(buffer):
        start = buffer.find(b'\xAA', index)
        if start < 0:
            return frames, b'', errors

        # Need at least header + trailer.
        if len(buffer) - start < 5:
            return frames, buffer[start:], errors

        can_id = buffer[start + 1] | (buffer[start + 2] << 8)
        data_length = buffer[start + 3]
        total_length = 1 + 2 + 1 + data_length + 1

        if len(buffer) - start < total_length:
            return frames, buffer[start:], errors

        end_byte = buffer[start + total_length - 1]
        if end_byte != 0x55:
            errors += 1
            index = start + 1
            continue

        payload_start = start + 4
        payload_end = payload_start + data_length
        frames.append((can_id, bytes(buffer[payload_start:payload_end])))
        index = start + total_length

    return frames, b'', errors


def decode_tshmu_frame(can_id: int, data: bytes) -> Optional[dict[str, int | float]]:
    """
    Decode the current mk11-tshmu DualFlowFDFrame_t layout.

    Source of truth:
      /Users/oreoturkey/Documents/telemetry_project/mk11-tshmu/Core/Src/main.c

    The checked-in firmware currently defines a single board-0 flow packet on
    CAN ID 0x102 with:
      bytes 0-3   base_timestamp
      bytes 4-5   error_flags
      bytes 6-10  first sample: flow1_u16, flow2_u16, jitter_s8
    """
    if can_id != 0x102 or len(data) < 11:
        return None

    flow1_raw = data[6] | (data[7] << 8)
    flow2_raw = data[8] | (data[9] << 8)
    jitter_raw = data[10]
    jitter_us = jitter_raw - 256 if jitter_raw > 127 else jitter_raw

    return {
        'base_timestamp': int.from_bytes(data[0:4], 'little'),
        'error_flags': data[4] | (data[5] << 8),
        'flow1': flow1_raw / 10.0,
        'flow2': flow2_raw / 10.0,
        'jitter_us': jitter_us,
    }


def _process_can_payload(can_id: int, data: bytes) -> None:
    """Route a CAN ID + payload pair to the correct decoder."""
    if len(data) == 64:
        sdu_info = parse_sdu_id(can_id)
        if sdu_info is not None:
            STATE.record_can_activity(can_id, len(data))
            STATE.apply_sdu_frame(can_id, list(data))
            return

        tshmu = decode_tshmu_frame(can_id, data)
        if tshmu is not None:
            STATE.record_can_activity(can_id, len(data))
            STATE.apply_tshmu_frame(tshmu)
            return

    if 0x4F5 <= can_id <= 0x4FA:
        STATE.record_can_activity(can_id, len(data))
        STATE.apply_imu_raw_frame(can_id, data)
        return

    STATE.record_can_activity(can_id, len(data))
    signals = decode_can_frame(can_id, data)
    if signals is not None:
        STATE.apply_dbc_signals(can_id, signals)


async def loop_binary_serial_port(port: str, baudrate: int) -> None:
    """Read binary CAN mirror packets from one STM32 ACM serial port."""
    try:
        import serial_asyncio
    except ImportError:
        print("[SYSTEM] serial_asyncio not available, skipping binary serial loop.")
        return

    while True:
        try:
            reader, writer = await serial_asyncio.open_serial_connection(
                url=port, baudrate=baudrate
            )
            print(f"[BINARY SERIAL] Connected to {port}")

            transport = writer.transport
            serial_obj = transport.serial if hasattr(transport, 'serial') else None
            if serial_obj is not None:
                try:
                    serial_obj.dtr = True
                    serial_obj.rts = True
                except Exception:
                    pass

            buffer = b''
            while True:
                chunk = await reader.read(4096)
                if not chunk:
                    break

                buffer += chunk
                parsed_frames, buffer, parse_errors = extract_binary_can_frames(buffer)
                if parse_errors:
                    STATE.frames_errors += parse_errors

                for can_id, payload in parsed_frames:
                    try:
                        _process_can_payload(can_id, payload)
                        STATE.frames_parsed += 1
                    except Exception:
                        STATE.frames_errors += 1
        except Exception as e:
            print(f"[BINARY SERIAL] {port} connection error: {e}. Retrying in 2s...")
            await asyncio.sleep(2)


async def loop_binary_serial_group() -> None:
    """Start one binary serial reader task per detected ACM device."""
    ports = auto_detect_binary_serial_ports()
    if not ports:
        print("[BINARY SERIAL] No ttyACM ports detected; skipping binary serial group.")
        return

    baudrate = int(os.environ.get('USB_BINARY_BAUD', os.environ.get('SERIAL_BAUD', '115200')))
    print(f"[BINARY SERIAL] Starting readers for: {', '.join(ports)}")
    for port in ports:
        asyncio.create_task(loop_binary_serial_port(port, baudrate))


# ---------------------------------------------------------------------------
# LOOP A2: Direct SocketCAN Reader (For PiCAN / Native Linux CAN)
# ---------------------------------------------------------------------------

async def loop_socketcan():
    """Read CAN frames directly from a Linux SocketCAN interface using python-can."""
    import sys
    if sys.platform != 'linux':
        print("[SYSTEM] SocketCAN is only supported on Linux. Skipping SocketCAN loop.")
        return

    try:
        import can
    except ImportError:
        print("[SOCKETCAN] ERROR: python-can is not installed! Cannot read CAN bus.")
        return
        
    interface = os.environ.get('CAN_INTERFACE', 'can1')
    print(f"[SYSTEM] SocketCAN Loop Started on {interface} using python-can.")
    
    try:
        bus = can.interface.Bus(channel=interface, interface='socketcan')
    except Exception as e:
        print(f"[SOCKETCAN] Cannot bind {interface} (make sure the interface is up): {e}")
        return

    loop = asyncio.get_running_loop()
    
    # Run the blocking recv() in a background thread to avoid blocking the asyncio event loop
    while True:
        try:
            msg = await loop.run_in_executor(None, bus.recv, 1.0)
            if msg is None:
                continue
                
            can_id = msg.arbitration_id
            data = bytes(msg.data)
            
            # Intercept raw IMU frames
            if 0x4F5 <= can_id <= 0x4FA:
                STATE.apply_imu_raw_frame(can_id, data)
                STATE.frames_parsed += 1
            else:
                # SocketCAN frames from VCU/BMS/Inverter are standard DBC encoded
                signals = decode_can_frame(can_id, data)
                if signals is not None:
                    STATE.apply_dbc_signals(can_id, signals)
                    STATE.frames_parsed += 1
                
        except asyncio.CancelledError:
            bus.shutdown()
            break
        except Exception as e:
            print(f"[SOCKETCAN] Read error: {e}")
            await asyncio.sleep(1)



def _process_frame(frame: SlcanFrame) -> None:
    """Route a parsed SLCAN frame to the correct decoder."""
    _process_can_payload(frame.identifier, bytes(frame.data_bytes))


# ---------------------------------------------------------------------------
# LOOP B: Mock Data Generator
# ---------------------------------------------------------------------------

async def loop_mock_generator():
    """Generate realistic fake data for laptop testing."""
    print("[SYSTEM] Mock Data Generator Started.")
    t0 = time.time()

    while True:
        t = time.time() - t0

        # GPS: simulate driving in a circle
        STATE.gps_lat = 34.068 + 0.001 * math.sin(t * 0.1)
        STATE.gps_lon = -118.445 + 0.001 * math.cos(t * 0.1)
        STATE.gps_alt = 120.5
        STATE.gps_vel = 8.5 + 3.0 * math.sin(t * 0.3)
        STATE.gps_heading = (t * 20.0) % 360.0
        STATE.gps_fix = 1
        STATE.gps_sats = 12

        # IMU Mock data (0 = COG, 1 = Front, 2 = Rear)
        # COG:
        STATE.imus[0]['ax'] = round(0.15 * math.sin(t * 1.5), 3)
        STATE.imus[0]['ay'] = round(0.8 * math.sin(t * 0.1), 3) # lateral G in corner
        STATE.imus[0]['az'] = round(1.0 + 0.05 * math.cos(t * 2.0), 3)
        STATE.imus[0]['pitch'] = round(1.2 * math.sin(t * 0.5), 1)
        STATE.imus[0]['roll'] = round(3.5 * math.sin(t * 0.1), 1)
        STATE.imus[0]['yaw'] = round((t * 20.0) % 360.0 - 180.0, 1)
        STATE.imus[0]['cal'] = 1

        # Front: leading phase (+0.3) and slightly higher noise/vibration
        STATE.imus[1]['ax'] = round(0.20 * math.sin(t * 1.5 + 0.3) + 0.05 * math.sin(t * 12.0), 3)
        STATE.imus[1]['ay'] = round(0.9 * math.sin(t * 0.1 + 0.2), 3)
        STATE.imus[1]['az'] = round(1.02 + 0.08 * math.cos(t * 2.5), 3)
        STATE.imus[1]['pitch'] = round(1.5 * math.sin(t * 0.5 + 0.3), 1)
        STATE.imus[1]['roll'] = round(4.0 * math.sin(t * 0.1 + 0.2), 1)
        STATE.imus[1]['yaw'] = round(((t * 20.0 + 5.0) % 360.0) - 180.0, 1)
        STATE.imus[1]['cal'] = 1

        # Rear: lagging phase (-0.3)
        STATE.imus[2]['ax'] = round(0.12 * math.sin(t * 1.5 - 0.3) + 0.03 * math.sin(t * 8.0), 3)
        STATE.imus[2]['ay'] = round(0.7 * math.sin(t * 0.1 - 0.2), 3)
        STATE.imus[2]['az'] = round(0.98 + 0.04 * math.cos(t * 1.8), 3)
        STATE.imus[2]['pitch'] = round(1.0 * math.sin(t * 0.5 - 0.3), 1)
        STATE.imus[2]['roll'] = round(3.0 * math.sin(t * 0.1 - 0.2), 1)
        STATE.imus[2]['yaw'] = round(((t * 20.0 - 5.0) % 360.0) - 180.0, 1)
        STATE.imus[2]['cal'] = 1

        # Keep legacy flat variables in sync
        STATE.imu_ax = STATE.imus[0]['ax']
        STATE.imu_ay = STATE.imus[0]['ay']
        STATE.imu_az = STATE.imus[0]['az']
        STATE.imu_pitch = STATE.imus[0]['pitch']
        STATE.imu_roll = STATE.imus[0]['roll']
        STATE.imu_yaw = STATE.imus[0]['yaw']
        STATE.imu_cal = STATE.imus[0]['cal']

        # Inverter
        STATE.inv_motor_speed = 3500 + 1500 * math.sin(t * 0.2)
        STATE.inv_motor_temp = 65.0 + 5.0 * math.sin(t * 0.05)
        STATE.inv_coolant_temp = 42.0 + 2.0 * math.sin(t * 0.03)
        STATE.inv_dc_bus_voltage = 340.0 + 10.0 * math.sin(t * 0.1)
        STATE.inv_dc_bus_current = 45.0 + 30.0 * math.sin(t * 0.2)
        STATE.inv_torque_cmd = 120.0 * abs(math.sin(t * 0.15))
        STATE.inv_torque_fb = STATE.inv_torque_cmd * 0.98
        STATE.inv_igbt_a_temp = 55.0 + 3.0 * math.sin(t * 0.04)
        STATE.inv_igbt_b_temp = 56.0 + 3.0 * math.sin(t * 0.04 + 0.5)
        STATE.inv_igbt_c_temp = 54.0 + 3.0 * math.sin(t * 0.04 + 1.0)
        STATE.inv_vsm_state = 6  # Motor Running

        # BMS
        STATE.bms_pack_voltage = 345.0 - 0.5 * (t % 600) / 600.0
        STATE.bms_pack_current = 42.0 + 20.0 * math.sin(t * 0.2)
        STATE.bms_soc = max(10, 85.0 - (t % 3600) / 3600.0 * 20)
        STATE.bms_high_temp = 38.0 + 2.0 * math.sin(t * 0.02)
        STATE.bms_low_temp = 32.0 + 1.0 * math.sin(t * 0.02)
        STATE.bms_high_cell_v = 4.15 - 0.01 * math.sin(t * 0.01)
        STATE.bms_low_cell_v = 4.10 - 0.02 * math.sin(t * 0.01)
        STATE.bms_dcl = 300.0

        # VCU
        STATE.vcu_vehicle_speed = max(0, 35 + 15 * math.sin(t * 0.15))
        STATE.vcu_apps1_pct = max(0, 60 * abs(math.sin(t * 0.15)))
        STATE.vcu_apps2_pct = STATE.vcu_apps1_pct
        STATE.vcu_bse_pct = max(0, 30 * abs(math.cos(t * 0.15)))
        STATE.vcu_rtd_state = 1

        # SDU boards
        for i in range(4):
            STATE.sdu[i]['shock_mm'] = 45.0 + 10.0 * math.sin(t * 3.0 + i * 0.5)
            STATE.sdu[i]['brake_c'] = 180.0 + 40.0 * math.sin(t * 0.1 + i * 0.3)
            STATE.sdu[i]['wheel_rpm'] = max(0, 800 + 300 * math.sin(t * 0.2 + i * 0.2))
            STATE.sdu[i]['tire_max_c'] = 65 + int(5 * math.sin(t * 0.05 + i))
            STATE.sdu[i]['tire_min_c'] = 45 + int(3 * math.sin(t * 0.05 + i))
            STATE.sdu[i]['tire_ctr_c'] = 55 + int(4 * math.sin(t * 0.05 + i))
            STATE.sdu[i]['tire_amb_c'] = 28

        STATE.frames_parsed += 1
        await asyncio.sleep(0.02)  # 50Hz


# ---------------------------------------------------------------------------
# LOOP C: CSV Logger with Rolling Buffer
# ---------------------------------------------------------------------------

def find_usb_drive() -> Optional[str]:
    """Find a mounted USB drive to save logs to."""
    for base in ['/media/daqpi', '/media/pi', '/media', '/Volumes']:
        if os.path.exists(base):
            for item in os.listdir(base):
                path = os.path.join(base, item)
                if os.path.ismount(path) and os.access(path, os.W_OK):
                    # Ignore Mac internal volumes
                    if item in ['Macintosh HD', 'Recovery']:
                        continue
                    return path
    return None


def get_log_directories() -> list[Path]:
    """Return the writable directories where logs may exist."""
    directories: list[Path] = []
    seen: set[str] = set()

    usb_dir = find_usb_drive()
    candidates = [usb_dir, STATE.active_log_directory, os.environ.get('LOG_DIR', './logs')]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).resolve()
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        directories.append(path)

    return directories


def choose_log_directory() -> Path:
    """Pick the current destination for new log files."""
    usb_dir = find_usb_drive()
    if usb_dir:
        return Path(usb_dir).resolve()
    return Path(os.environ.get('LOG_DIR', './logs')).resolve()


def build_log_filename(timestamp: float) -> str:
    """Generate the requested BFR filename format with 12-hour local time."""
    dt = datetime.fromtimestamp(timestamp)
    return dt.strftime('BFR_%Y-%m-%d_%I-%M-%S_%p.csv')


def encode_log_token(path: Path) -> str:
    return base64.urlsafe_b64encode(str(path).encode('utf-8')).decode('ascii')


def decode_log_token(token: str) -> Path:
    try:
        decoded = base64.urlsafe_b64decode(token.encode('ascii')).decode('utf-8')
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid log token.") from exc

    path = Path(decoded).resolve()
    allowed = [directory.resolve() for directory in get_log_directories()]
    if not any(path == directory or directory in path.parents for directory in allowed):
        raise HTTPException(status_code=403, detail="Log path is outside allowed directories.")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Log file not found.")
    return path


def csv_row_from_snapshot(snapshot: dict[str, float | int | bool | None], signal_ids: list[str]) -> list:
    return [snapshot.get(signal_id) for signal_id in signal_ids]


def parse_csv_cell(raw: str):
    if raw == '':
        return None
    lowered = raw.lower()
    if lowered == 'true':
        return True
    if lowered == 'false':
        return False
    try:
        if any(ch in raw for ch in ('.', 'e', 'E')):
            return float(raw)
        return int(raw)
    except ValueError:
        return raw

async def loop_csv_logger():
    """30-second rolling buffer with trigger-based file writes at 10Hz."""
    print("[SYSTEM] CSV Logger Loop Started.")
    was_logging = False
    current_csv = None
    writer = None
    flush_counter = 0
    flush_every_rows = max(1, LOG_FLUSH_ROWS)

    try:
        while True:
            snapshot = STATE.to_signal_map()
            HISTORY_BUFFER.append(snapshot)

            is_logging = STATE.is_logging

            if is_logging and not was_logging:
                active_log_dir = choose_log_directory()
                default_dir = Path(os.environ.get('LOG_DIR', './logs')).resolve()
                if active_log_dir != default_dir:
                    print(f"[LOGGER] Found USB Drive: {active_log_dir}")

                active_log_dir.mkdir(parents=True, exist_ok=True)
                filename = build_log_filename(STATE.timestamp or time.time())
                filepath = active_log_dir / filename
                signal_ids = list(dict.fromkeys(STATE.log_signal_ids or sorted(snapshot.keys())))
                if 'ts' not in signal_ids:
                    signal_ids.insert(0, 'ts')

                print(f"\n[LOGGER] TRIGGERED! Flushing buffer to {filepath}")

                try:
                    current_csv = open(filepath, 'w', newline='')
                    writer = csv.writer(current_csv)
                    writer.writerow(signal_ids)

                    for buffered_snapshot in HISTORY_BUFFER:
                        writer.writerow(csv_row_from_snapshot(buffered_snapshot, signal_ids))

                    current_csv.flush()
                    os.fsync(current_csv.fileno())
                    STATE.active_log_filename = filename
                    STATE.active_log_directory = str(active_log_dir)
                    STATE.log_signal_ids = signal_ids
                    flush_counter = 0
                    print(f"[LOGGER] Flushed {len(HISTORY_BUFFER)} pre-trigger rows.")
                    was_logging = True
                except Exception as e:
                    print(f"[LOGGER] ERROR: {e}")
                    STATE.is_logging = False

            elif is_logging and was_logging and writer:
                writer.writerow(csv_row_from_snapshot(snapshot, STATE.log_signal_ids))
                flush_counter += 1
                if flush_counter >= flush_every_rows:
                    current_csv.flush()
                    os.fsync(current_csv.fileno())
                    flush_counter = 0

            elif not is_logging and was_logging:
                print("[LOGGER] Stopped. File saved.")
                if current_csv:
                    current_csv.flush()
                    os.fsync(current_csv.fileno())
                    current_csv.close()
                    current_csv = None
                    writer = None
                STATE.active_log_filename = ""
                STATE.active_log_directory = ""
                was_logging = False

            await asyncio.sleep(LOG_INTERVAL_S)
    finally:
        if current_csv:
            current_csv.flush()
            os.fsync(current_csv.fileno())
            current_csv.close()


# ---------------------------------------------------------------------------
# LOOP D: WebSocket Broadcaster
# ---------------------------------------------------------------------------

async def loop_ws_broadcaster():
    """Push 50Hz JSON to all connected clients."""
    print("[SYSTEM] WS Broadcaster Loop Started.")

    while True:
        STATE.timestamp = time.time()
        if active_connections:
            payload = json.dumps(STATE.to_broadcast_dict())
            dead = []
            for ws in active_connections:
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                active_connections.remove(ws)

        await asyncio.sleep(BROADCAST_INTERVAL_S)


# ---------------------------------------------------------------------------
# LOOP E: Direct Serial UART Broadcaster (Fallback)
# ---------------------------------------------------------------------------

async def loop_serial_broadcaster():
    """Push 50Hz JSON string directly out of a secondary serial port."""
    out_serial = os.environ.get('OUT_SERIAL_PORT')
    if not out_serial:
        print("[SYSTEM] No OUT_SERIAL_PORT specified. Serial Broadcaster disabled.")
        return

    out_baud = int(os.environ.get('OUT_SERIAL_BAUD', '115200'))
    print(f"[SYSTEM] Serial Broadcaster Loop Started. Targeting {out_serial} @ {out_baud}")

    try:
        import serial_asyncio
    except ImportError:
        print("[SYSTEM] serial_asyncio not available. Skipping serial broadcast.")
        return

    while True:
        try:
            reader, writer = await serial_asyncio.open_serial_connection(
                url=out_serial, baudrate=out_baud
            )
            print(f"[SERIAL OUT] Connected to {out_serial}")

            while True:
                payload = json.dumps(STATE.to_broadcast_dict()) + "\n"
                writer.write(payload.encode('utf-8'))
                await writer.drain()
                await asyncio.sleep(0.02)  # 50Hz
        except Exception as e:
            print(f"[SERIAL OUT] Connection error: {e}. Retrying in 2s...")
            await asyncio.sleep(2)


# ---------------------------------------------------------------------------
# FastAPI Application
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start all background loops on server boot."""
    global MOCK_MODE

    # Check CLI args
    import sys
    if '--mock' in sys.argv:
        MOCK_MODE = True

    if MOCK_MODE:
        print("[SYSTEM] === MOCK MODE ENABLED ===")
        asyncio.create_task(loop_mock_generator())
    else:
        asyncio.create_task(loop_mdu_serial())
        asyncio.create_task(loop_binary_serial_group())
        asyncio.create_task(loop_socketcan())

    asyncio.create_task(loop_csv_logger())
    asyncio.create_task(loop_ws_broadcaster())
    asyncio.create_task(loop_serial_broadcaster())

    print(f"[SYSTEM] All loops started. Mock={MOCK_MODE}")
    yield
    print("[SYSTEM] Shutting down...")


app = FastAPI(title="FENRIR Pit Sync Telemetry Hub", lifespan=lifespan)

# CORS for development (Vite dev server on port 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    print(f"[NETWORK] Client connected. Active: {len(active_connections)}")
    try:
        while True:
            try:
                data = await websocket.receive_json()
                if data.get("action") == "START_LOG":
                    signal_ids = [signal_id for signal_id in data.get("signals", []) if isinstance(signal_id, str)]
                    STATE.log_signal_ids = signal_ids
                    STATE.is_logging = True
                    print("[NETWORK] START_LOG command received.")
                elif data.get("action") == "STOP_LOG":
                    STATE.is_logging = False
                    print("[NETWORK] STOP_LOG command received.")
            except WebSocketDisconnect:
                raise
            except Exception as e:
                print(f"[NETWORK] Error receiving command: {e}")
                # Don't crash the loop, just ignore the bad frame
                await asyncio.sleep(0.1)

    except WebSocketDisconnect:
        print("[NETWORK] Client disconnected.")
        if websocket in active_connections:
            active_connections.remove(websocket)


@app.get("/api/status")
async def get_status():
    """System health endpoint."""
    return JSONResponse({
        "mock_mode": MOCK_MODE,
        "is_logging": STATE.is_logging,
        "active_log_filename": STATE.active_log_filename,
        "active_log_directory": STATE.active_log_directory,
        "log_signal_ids": STATE.log_signal_ids,
        "frames_parsed": STATE.frames_parsed,
        "frames_errors": STATE.frames_errors,
        "buffer_size": len(HISTORY_BUFFER),
        "connected_clients": len(active_connections),
    })


@app.get("/api/debug/can")
async def get_can_debug():
    now = time.time()
    recent = sorted(
        (
            {
                "can_id": can_id,
                "hex": f"0x{can_id:03X}",
                "count": int(info["count"]),
                "data_len": int(info["data_len"]),
                "last_seen_s_ago": round(now - float(info["last_seen"]), 3),
            }
            for can_id, info in STATE.can_activity.items()
        ),
        key=lambda item: item["last_seen_s_ago"],
    )
    return JSONResponse({
        "recent_ids": recent[:64],
        "fusebox_valid": STATE.to_broadcast_dict()["fusebox"]["valid"],
    })


@app.post("/api/logging/start")
async def start_logging(payload: dict = Body(default={})):
    signal_ids = [signal_id for signal_id in payload.get("signals", []) if isinstance(signal_id, str)]
    STATE.log_signal_ids = signal_ids
    STATE.is_logging = True
    return JSONResponse({
        "ok": True,
        "is_logging": STATE.is_logging,
        "log_signal_ids": STATE.log_signal_ids,
    })


@app.post("/api/logging/stop")
async def stop_logging():
    STATE.is_logging = False
    return JSONResponse({
        "ok": True,
        "is_logging": STATE.is_logging,
        "active_log_filename": STATE.active_log_filename,
    })


@app.get("/api/logs")
async def list_logs():
    """List available log files."""
    logs = []
    for directory in get_log_directories():
        if not directory.exists():
            continue
        for path in directory.glob('*.csv'):
            logs.append({
                "token": encode_log_token(path.resolve()),
                "filename": path.name,
                "directory": str(directory),
                "size_bytes": path.stat().st_size,
                "modified": path.stat().st_mtime,
                "active": path.name == STATE.active_log_filename and str(directory) == STATE.active_log_directory,
            })
    logs.sort(key=lambda entry: entry["modified"], reverse=True)
    return JSONResponse({"logs": logs})


@app.get("/api/logs/{log_token}")
async def get_log_file(log_token: str):
    """Load one CSV log file for in-app playback."""
    path = decode_log_token(log_token)

    rows = []
    with path.open('r', newline='') as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        for row in reader:
            parsed_row = {key: parse_csv_cell(value) for key, value in row.items()}
            rows.append(parsed_row)

    return JSONResponse({
        "filename": path.name,
        "headers": headers,
        "rows": rows,
    })
