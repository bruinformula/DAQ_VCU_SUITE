"""
FENRIR Pit Sync Telemetry Hub — Backend Engine
===============================================
The unified Python backend that runs on the Raspberry Pi.

Four asynchronous loops:
  A. MDU Serial Reader — reads SLCAN frames from USB CDC, decodes via DBC + SDU parsers
  B. Mock Data Generator — simulates all sensors for laptop testing
  C. CSV Logger — 30s rolling buffer + trigger-based file writes
  D. WebSocket Broadcaster — pushes decoded telemetry at 50Hz to all connected clients
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import time
import csv
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from slcan_parser import parse_slcan_frame, SlcanFrame
from dbc_decoder import decode_can_frame, get_message_name, BFR_CAN_DB
from sdu_decoder import decode_sdu_frame, parse_sdu_id, BOARD_TYPE_SDU, BOARD_TYPE_TSPMU

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
        self.bms_high_temp: float = 0.0
        self.bms_low_temp: float = 0.0
        self.bms_high_cell_v: float = 0.0
        self.bms_low_cell_v: float = 0.0
        self.bms_dcl: float = 0.0

        # VCU (CAN 0x500)
        self.vcu_vehicle_speed: float = 0.0
        self.vcu_apps1_pct: float = 0.0
        self.vcu_apps2_pct: float = 0.0
        self.vcu_bse_pct: float = 0.0
        self.vcu_rtd_state: int = 0

        # Fusebox (CAN 0x4F0)
        self.fusebox_dcdc_v: float = 0.0
        self.fusebox_battery_v: float = 0.0
        self.fusebox_lvb_soc: float = 0.0

        # SDU boards [0-3] = FL, FR, RL, RR — latest values only
        self.sdu = [
            {'shock_mm': 0.0, 'brake_c': 0.0, 'wheel_rpm': 0.0,
             'tire_max_c': 0, 'tire_min_c': 0, 'tire_ctr_c': 0, 'tire_amb_c': 0,
             'strain_mv': [0]*6}
            for _ in range(4)
        ]

        # Logging state
        self.is_logging: bool = False

        # Frame counters
        self.frames_parsed: int = 0
        self.frames_errors: int = 0

    def apply_dbc_signals(self, can_id: int, signals: dict[str, float]) -> None:
        """Apply decoded DBC signals to the state object."""
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
        elif can_id == 1712:
            self.bms_pack_current = signals.get('Pack_Current', self.bms_pack_current)
            self.bms_pack_voltage = signals.get('Pack_Summed_Voltage', self.bms_pack_voltage)
            self.bms_soc = signals.get('Pack_SOC', self.bms_soc)
        elif can_id == 1713:
            self.bms_high_temp = signals.get('High_Temperature', self.bms_high_temp)
            self.bms_low_temp = signals.get('Low_Temperature', self.bms_low_temp)
            self.bms_dcl = signals.get('Pack_DCL', self.bms_dcl)
        elif can_id == 1714:
            self.bms_high_cell_v = signals.get('High_Cell_Voltage', self.bms_high_cell_v)
            self.bms_low_cell_v = signals.get('Low_Cell_Voltage', self.bms_low_cell_v)

        # VCU
        elif can_id == 1280:
            self.vcu_vehicle_speed = signals.get('Calc_Vehicle_Speed', self.vcu_vehicle_speed)
            self.vcu_apps1_pct = signals.get('APPS1_as_percent', self.vcu_apps1_pct)
            self.vcu_apps2_pct = signals.get('APPS2_as_percent', self.vcu_apps2_pct)
            self.vcu_bse_pct = signals.get('BSE_as_percent', self.vcu_bse_pct)
            self.vcu_rtd_state = int(signals.get('RTD_State', self.vcu_rtd_state))

        # Fusebox
        elif can_id == 1264:
            self.fusebox_dcdc_v = signals.get('DCDC_Voltage', self.fusebox_dcdc_v)
            self.fusebox_battery_v = signals.get('Battery_Voltage', self.fusebox_battery_v)
            self.fusebox_lvb_soc = signals.get('LVB_SOC', self.fusebox_lvb_soc)

    def apply_sdu_frame(self, can_id: int, data: list[int]) -> None:
        """Apply a decoded SDU/TSPMU frame to the state."""
        decoded = decode_sdu_frame(can_id, data)
        if decoded is None or decoded.board_index >= 4:
            return

        board = self.sdu[decoded.board_index]
        if decoded.sensor_type == 'shock_pot' and decoded.latest:
            board['shock_mm'] = decoded.latest.get('shock_mm', board['shock_mm'])
        elif decoded.sensor_type == 'brake_temp' and decoded.latest:
            board['brake_c'] = decoded.latest.get('brake_c', board['brake_c'])
        elif decoded.sensor_type == 'wheel_speed' and decoded.latest:
            board['wheel_rpm'] = decoded.latest.get('wheel_rpm', board['wheel_rpm'])
        elif decoded.sensor_type == 'tire_temp' and decoded.latest:
            board['tire_max_c'] = decoded.latest.get('max_c', board['tire_max_c'])
            board['tire_min_c'] = decoded.latest.get('min_c', board['tire_min_c'])
            board['tire_ctr_c'] = decoded.latest.get('center_c', board['tire_ctr_c'])
            board['tire_amb_c'] = decoded.latest.get('ambient_c', board['tire_amb_c'])
        elif decoded.sensor_type == 'strain_gauge' and decoded.latest:
            board['strain_mv'] = decoded.latest.get('channels_mv', board['strain_mv'])

    def to_broadcast_dict(self) -> dict:
        """Construct the JSON payload for WebSocket broadcast."""
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
            },
            'bms': {
                'v': round(self.bms_pack_voltage, 1),
                'i': round(self.bms_pack_current, 1),
                'soc': round(self.bms_soc, 1),
                'hi_t': round(self.bms_high_temp, 1),
                'lo_t': round(self.bms_low_temp, 1),
                'hi_cv': round(self.bms_high_cell_v, 4),
                'lo_cv': round(self.bms_low_cell_v, 4),
                'dcl': round(self.bms_dcl),
            },
            'vcu': {
                'spd': round(self.vcu_vehicle_speed),
                'apps1': round(self.vcu_apps1_pct),
                'apps2': round(self.vcu_apps2_pct),
                'bse': round(self.vcu_bse_pct),
                'rtd': self.vcu_rtd_state,
            },
            'sdu': [
                {
                    'pos': ['FL', 'FR', 'RL', 'RR'][i],
                    'shock': round(b['shock_mm'], 2),
                    'brake': round(b['brake_c'], 1),
                    'wrpm': round(b['wheel_rpm'], 1),
                    'tire': [b['tire_max_c'], b['tire_min_c'], b['tire_ctr_c'], b['tire_amb_c']],
                }
                for i, b in enumerate(self.sdu)
            ],
            'log': self.is_logging,
            'stats': {'parsed': self.frames_parsed, 'errors': self.frames_errors},
        }

    def to_csv_row(self) -> list:
        """Construct a flat row for CSV logging."""
        return [
            self.timestamp,
            self.gps_lat, self.gps_lon, self.gps_alt, self.gps_vel, self.gps_heading,
            self.gps_fix, self.gps_sats,
            self.imu_ax, self.imu_ay, self.imu_az,
            self.imu_pitch, self.imu_roll, self.imu_yaw,
            self.inv_motor_speed, self.inv_dc_bus_voltage, self.inv_dc_bus_current,
            self.inv_torque_cmd, self.inv_torque_fb,
            self.inv_motor_temp, self.inv_coolant_temp,
            self.bms_pack_voltage, self.bms_pack_current, self.bms_soc,
            self.bms_high_temp, self.bms_low_temp,
            self.bms_high_cell_v, self.bms_low_cell_v,
            self.vcu_vehicle_speed, self.vcu_apps1_pct, self.vcu_bse_pct,
        ] + [
            self.sdu[i]['shock_mm'] for i in range(4)
        ] + [
            self.sdu[i]['wheel_rpm'] for i in range(4)
        ] + [
            self.sdu[i]['brake_c'] for i in range(4)
        ]

    @staticmethod
    def csv_header() -> list[str]:
        return [
            'timestamp',
            'gps_lat', 'gps_lon', 'gps_alt', 'gps_vel', 'gps_heading',
            'gps_fix', 'gps_sats',
            'imu_ax', 'imu_ay', 'imu_az',
            'imu_pitch', 'imu_roll', 'imu_yaw',
            'inv_rpm', 'inv_vdc', 'inv_idc',
            'inv_tq_cmd', 'inv_tq_fb',
            'inv_mot_temp', 'inv_cool_temp',
            'bms_pack_v', 'bms_pack_i', 'bms_soc',
            'bms_hi_temp', 'bms_lo_temp',
            'bms_hi_cell_v', 'bms_lo_cell_v',
            'vcu_speed', 'vcu_apps1', 'vcu_bse',
        ] + [f'sdu{i}_shock_mm' for i in range(4)] \
          + [f'sdu{i}_wheel_rpm' for i in range(4)] \
          + [f'sdu{i}_brake_c' for i in range(4)]


# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

STATE = TelemetryState()
HISTORY_BUFFER: deque[list] = deque(maxlen=1500)  # 30s × 50Hz
active_connections: list[WebSocket] = []

# Use --mock flag or MOCK env var
MOCK_MODE = os.environ.get('TELEMETRY_MOCK', '').lower() in ('1', 'true', 'yes')


# ---------------------------------------------------------------------------
# LOOP A: MDU Serial Reader (SLCAN)
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


# ---------------------------------------------------------------------------
# LOOP A2: Direct SocketCAN Reader (For PiCAN / Native Linux CAN)
# ---------------------------------------------------------------------------

async def loop_socketcan():
    """Read CAN frames directly from a Linux SocketCAN interface."""
    import sys
    if sys.platform != 'linux':
        print("[SYSTEM] SocketCAN is only supported on Linux. Skipping SocketCAN loop.")
        return

    import socket
    import struct
    
    interface = os.environ.get('CAN_INTERFACE', 'can0')
    print(f"[SYSTEM] SocketCAN Loop Started on {interface}.")
    
    try:
        # AF_CAN = 29, SOCK_RAW = 3, CAN_RAW = 1
        s = socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW)
        s.bind((interface,))
        s.setblocking(False)
    except Exception as e:
        print(f"[SOCKETCAN] Cannot bind {interface} (make sure the interface is up): {e}")
        return

    loop = asyncio.get_running_loop()
    
    while True:
        try:
            # Standard Linux CAN frame is 16 bytes: can_id (4), can_dlc (1), pad (3), data (8)
            frame = await loop.sock_recv(s, 16)
            if len(frame) == 16:
                can_id, can_dlc, _, raw_data = struct.unpack("<IB3s8s", frame)
                
                is_extended = bool(can_id & 0x80000000)
                actual_id = can_id & 0x1FFFFFFF if is_extended else can_id & 0x7FF
                
                can_dlc = min(can_dlc, 8)
                data = raw_data[:can_dlc]
                
                # SocketCAN frames from VCU/BMS/Inverter are standard DBC encoded
                signals = decode_can_frame(actual_id, data)
                if signals is not None:
                    STATE.apply_dbc_signals(actual_id, signals)
                    STATE.frames_parsed += 1
                
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[SOCKETCAN] Read error: {e}")
            await asyncio.sleep(1)



def _process_frame(frame: SlcanFrame) -> None:
    """Route a parsed SLCAN frame to the correct decoder."""
    data = bytes(frame.data_bytes)

    # Check if this is an SDU/TSPMU 64-byte frame
    if frame.data_length == 64 and frame.id_type == 'standard':
        sdu_info = parse_sdu_id(frame.identifier)
        if sdu_info is not None:
            STATE.apply_sdu_frame(frame.identifier, frame.data_bytes)
            return

    # Otherwise try DBC decoding for standard 8-byte frames
    signals = decode_can_frame(frame.identifier, data)
    if signals is not None:
        STATE.apply_dbc_signals(frame.identifier, signals)


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

        # IMU
        STATE.imu_ax = 0.05 * math.sin(t * 2.0)
        STATE.imu_ay = 0.8 * math.sin(t * 0.1)  # lateral G in corner
        STATE.imu_az = 1.0
        STATE.imu_pitch = 1.2 * math.sin(t * 0.5)
        STATE.imu_roll = 3.5 * math.sin(t * 0.1)
        STATE.imu_yaw = (t * 20.0) % 360.0 - 180.0
        STATE.imu_cal = 1

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

async def loop_csv_logger():
    """30-second rolling buffer with trigger-based file writes."""
    print("[SYSTEM] CSV Logger Loop Started.")
    was_logging = False
    current_csv = None
    writer = None
    log_dir = os.environ.get('LOG_DIR', './logs')

    while True:
        STATE.timestamp = time.time()

        # Always append to rolling buffer (flat row for speed)
        HISTORY_BUFFER.append(STATE.to_csv_row())

        is_logging = STATE.is_logging

        if is_logging and not was_logging:
            # TRIGGERED — flush 30s buffer to new file
            usb_dir = find_usb_drive()
            if usb_dir:
                active_log_dir = usb_dir
                print(f"[LOGGER] Found USB Drive: {usb_dir}")
            else:
                active_log_dir = log_dir

            os.makedirs(active_log_dir, exist_ok=True)
            time_str = time.strftime("%Y-%m-%d_%H-%M-%S", time.localtime(STATE.timestamp))
            filename = os.path.join(active_log_dir, f'BFR_{time_str}.csv')
            print(f"\n[LOGGER] TRIGGERED! Flushing buffer to {filename}")

            try:
                current_csv = open(filename, 'w', newline='')
                writer = csv.writer(current_csv)
                writer.writerow(TelemetryState.csv_header())

                for row in HISTORY_BUFFER:
                    writer.writerow(row)
                print(f"[LOGGER] Flushed {len(HISTORY_BUFFER)} pre-trigger rows.")
                was_logging = True
            except Exception as e:
                print(f"[LOGGER] ERROR: {e}")
                STATE.is_logging = False

        elif is_logging and was_logging and writer:
            writer.writerow(STATE.to_csv_row())

        elif not is_logging and was_logging:
            print("[LOGGER] Stopped. File saved.")
            if current_csv:
                current_csv.close()
                current_csv = None
                writer = None
            was_logging = False

        await asyncio.sleep(0.02)  # 50Hz


# ---------------------------------------------------------------------------
# LOOP D: WebSocket Broadcaster
# ---------------------------------------------------------------------------

async def loop_ws_broadcaster():
    """Push 50Hz JSON to all connected clients."""
    print("[SYSTEM] WS Broadcaster Loop Started.")

    while True:
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

        await asyncio.sleep(0.02)  # 50Hz


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
            data = await websocket.receive_json()

            if data.get("action") == "START_LOG":
                STATE.is_logging = True
                print("[NETWORK] START_LOG command received.")
            elif data.get("action") == "STOP_LOG":
                STATE.is_logging = False
                print("[NETWORK] STOP_LOG command received.")

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
        "frames_parsed": STATE.frames_parsed,
        "frames_errors": STATE.frames_errors,
        "buffer_size": len(HISTORY_BUFFER),
        "connected_clients": len(active_connections),
    })


@app.get("/api/logs")
async def list_logs():
    """List available log files."""
    log_dir = os.environ.get('LOG_DIR', './logs')
    if not os.path.exists(log_dir):
        return JSONResponse({"logs": []})

    logs = []
    for f in sorted(os.listdir(log_dir), reverse=True):
        if f.endswith('.csv'):
            path = os.path.join(log_dir, f)
            logs.append({
                "filename": f,
                "size_bytes": os.path.getsize(path),
                "modified": os.path.getmtime(path),
            })
    return JSONResponse({"logs": logs})
