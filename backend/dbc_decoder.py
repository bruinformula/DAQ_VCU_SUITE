"""
DBC Signal Decoder — Decodes standard 8-byte CAN frames using the BFR DBC definitions.

Handles all inverter (Cascadia PM100DZ), BMS (Orion BMS 2), VCU, and fusebox messages.
Supports both little-endian (Intel, @1) and big-endian (Motorola, @0) byte orders.

Note on Motorola byte ordering in DBC files:
  The start_bit for @0 signals uses Motorola bit numbering, which counts within each byte
  from MSB (bit 7) down to LSB (bit 0), then jumps to the next byte.
  Example: start_bit=7 with length=16 means bytes[0] high byte, bytes[1] low byte.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Optional


@dataclass(slots=True)
class Signal:
    """Definition of a single CAN signal within a message."""
    name: str
    start_bit: int
    bit_length: int
    is_little_endian: bool   # True = Intel (@1), False = Motorola (@0)
    is_signed: bool
    factor: float
    offset: float
    unit: str
    min_val: float = 0.0
    max_val: float = 0.0


@dataclass(slots=True)
class Message:
    """Definition of a CAN message."""
    can_id: int
    name: str
    dlc: int
    sender: str
    signals: list[Signal] = field(default_factory=list)
    cycle_time_ms: int = 0  # 0 = event-driven


def _extract_intel(data: bytes, start_bit: int, bit_length: int) -> int:
    """Extract a value using Intel (little-endian) bit ordering."""
    value = 0
    for i in range(bit_length):
        bit_pos = start_bit + i
        byte_idx = bit_pos // 8
        bit_idx = bit_pos % 8
        if byte_idx < len(data):
            if data[byte_idx] & (1 << bit_idx):
                value |= (1 << i)
    return value


def _extract_motorola(data: bytes, start_bit: int, bit_length: int) -> int:
    """
    Extract a value using Motorola (big-endian) bit ordering.
    In Motorola ordering, start_bit is the MSB position using the DBC numbering:
      byte_num = start_bit // 8
      bit_in_byte = start_bit % 8  (7 = MSB, 0 = LSB)
    """
    value = 0
    bit_pos = start_bit
    for i in range(bit_length):
        byte_idx = bit_pos // 8
        bit_in_byte = bit_pos % 8
        if byte_idx < len(data):
            if data[byte_idx] & (1 << bit_in_byte):
                value |= (1 << (bit_length - 1 - i))

        # Advance to next bit in Motorola order
        if bit_in_byte == 0:
            # Jump to bit 7 of the next byte
            bit_pos += 15
        else:
            bit_pos -= 1
    return value


def decode_signal(data: bytes, signal: Signal) -> float:
    """Decode a single signal from raw CAN data bytes."""
    if signal.is_little_endian:
        raw = _extract_intel(data, signal.start_bit, signal.bit_length)
    else:
        raw = _extract_motorola(data, signal.start_bit, signal.bit_length)

    # Apply signedness
    if signal.is_signed:
        max_unsigned = (1 << signal.bit_length)
        if raw >= (max_unsigned >> 1):
            raw -= max_unsigned

    # Apply factor and offset
    return raw * signal.factor + signal.offset


def decode_message(data: bytes, message: Message) -> dict[str, float]:
    """Decode all signals in a message. Returns {signal_name: physical_value}."""
    result = {}
    for sig in message.signals:
        try:
            result[sig.name] = decode_signal(data, sig)
        except (IndexError, ValueError):
            pass  # Skip signals that don't fit in the available data
    return result


# ---------------------------------------------------------------------------
# BFR CAN Database — hardcoded from the DBC for zero-dependency speed
# ---------------------------------------------------------------------------

def build_bfr_database() -> dict[int, Message]:
    """
    Build the complete CAN message database from the BFR DBC file.
    Returns a dict mapping CAN ID -> Message definition.
    """
    db: dict[int, Message] = {}

    # ---- INVERTER (Cascadia PM100DZ) ---- CAN IDs 160-177 (0xA0-0xB1)

    # 0xA0 (160) - Temperature Set 1
    db[160] = Message(160, 'Inverter_Temperature_Set_1', 8, 'INV', cycle_time_ms=100, signals=[
        Signal('INV_Module_A_Temp',          0, 16, True, True, 0.1, 0, '°C'),
        Signal('INV_Module_B_Temp',         16, 16, True, True, 0.1, 0, '°C'),
        Signal('INV_Module_C_Temp',         32, 16, True, True, 0.1, 0, '°C'),
        Signal('INV_Gate_Driver_Board_Temp', 48, 16, True, True, 0.1, 0, '°C'),
    ])

    # 0xA1 (161) - Temperature Set 2
    db[161] = Message(161, 'Inverter_Temperature_Set_2', 8, 'INV', cycle_time_ms=100, signals=[
        Signal('INV_Control_Board_Temp',    0, 16, True, True, 0.1, 0, '°C'),
        Signal('INV_RTD1_Temperature',     16, 16, True, True, 0.1, 0, '°C'),
        Signal('INV_RTD2_Temperature',     32, 16, True, True, 0.1, 0, '°C'),
        Signal('INV_Stall_Burst_Model_Temp', 48, 16, True, True, 0.1, 0, '°C'),
    ])

    # 0xA2 (162) - Temperature Set 3
    db[162] = Message(162, 'Inverter_Temperature_Set_3', 8, 'INV', cycle_time_ms=100, signals=[
        Signal('INV_Coolant_Temp',    0, 16, True, True, 0.1, 0, '°C'),
        Signal('INV_Hot_Spot_Temp',  16, 16, True, True, 0.1, 0, '°C'),
        Signal('INV_Motor_Temp',     32, 16, True, True, 0.1, 0, '°C'),
        Signal('INV_Torque_Shudder', 48, 16, True, True, 0.1, 0, 'N·m'),
    ])

    # 0xA3 (163) - Analog Inputs (10-bit packed signals)
    db[163] = Message(163, 'Inverter_Analog_Input_Voltages', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_Analog_Input_1',  0, 10, True, False, 0.01, 0, 'V'),
        Signal('INV_Analog_Input_2', 10, 10, True, False, 0.01, 0, 'V'),
        Signal('INV_Analog_Input_3', 20, 10, True, False, 0.01, 0, 'V'),
        Signal('INV_Analog_Input_4', 32, 10, True, False, 0.01, 0, 'V'),
        Signal('INV_Analog_Input_5', 42, 10, True, False, 0.01, 0, 'V'),
        Signal('INV_Analog_Input_6', 52, 10, True, False, 0.01, 0, 'V'),
    ])

    # 0xA5 (165) - Motor Position
    db[165] = Message(165, 'Inverter_Motor_Position_Info', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_Motor_Angle_Electrical',      0, 16, True, False, 0.1, 0, '°'),
        Signal('INV_Motor_Speed',                16, 16, True, True,  1.0, 0, 'RPM'),
        Signal('INV_Electrical_Output_Frequency', 32, 16, True, True,  0.1, 0, 'Hz'),
        Signal('INV_Delta_Resolver_Filtered',    48, 16, True, True,  0.1, 0, '°'),
    ])

    # 0xA6 (166) - Current Info
    db[166] = Message(166, 'Inverter_Current_Info', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_Phase_A_Current',  0, 16, True, True, 0.1, 0, 'A'),
        Signal('INV_Phase_B_Current', 16, 16, True, True, 0.1, 0, 'A'),
        Signal('INV_Phase_C_Current', 32, 16, True, True, 0.1, 0, 'A'),
        Signal('INV_DC_Bus_Current',  48, 16, True, True, 0.1, 0, 'A'),
    ])

    # 0xA7 (167) - Voltage Info
    db[167] = Message(167, 'Inverter_Voltage_Info', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_DC_Bus_Voltage',   0, 16, True, True, 0.1, 0, 'V'),
        Signal('INV_Output_Voltage',  16, 16, True, True, 0.1, 0, 'V'),
        Signal('INV_VAB_Vd_Voltage',  32, 16, True, True, 0.1, 0, 'V'),
        Signal('INV_VBC_Vq_Voltage',  48, 16, True, True, 0.1, 0, 'V'),
    ])

    # 0xA8 (168) - Flux / Id / Iq
    db[168] = Message(168, 'Inverter_Flux_ID_IQ_Info', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_Vd_ff',  0, 16, True, True, 0.1, 0, 'V'),
        Signal('INV_Vq_ff', 16, 16, True, True, 0.1, 0, 'V'),
        Signal('INV_Id',    32, 16, True, True, 0.1, 0, 'A'),
        Signal('INV_Iq',    48, 16, True, True, 0.1, 0, 'A'),
    ])

    # 0xA9 (169) - Internal Voltages
    db[169] = Message(169, 'Inverter_Internal_Voltages', 8, 'INV', cycle_time_ms=100, signals=[
        Signal('INV_Ref_Voltage_1_5',  0, 16, True, True, 0.01, 0, 'V'),
        Signal('INV_Ref_Voltage_2_5', 16, 16, True, True, 0.01, 0, 'V'),
        Signal('INV_Ref_Voltage_5_0', 32, 16, True, True, 0.01, 0, 'V'),
        Signal('INV_Ref_Voltage_12_0', 48, 16, True, True, 0.01, 0, 'V'),
    ])

    # 0xAA (170) - Internal States
    db[170] = Message(170, 'Inverter_Internal_States', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_VSM_State',              0, 8, True, False, 1, 0, ''),
        Signal('INV_PWM_Frequency',          8, 8, True, False, 1, 0, ''),
        Signal('INV_Inverter_State',        16, 8, True, False, 1, 0, ''),
        Signal('INV_Relay_1_Status',        24, 1, True, False, 1, 0, ''),
        Signal('INV_Relay_2_Status',        25, 1, True, False, 1, 0, ''),
        Signal('INV_Relay_3_Status',        26, 1, True, False, 1, 0, ''),
        Signal('INV_Relay_4_Status',        27, 1, True, False, 1, 0, ''),
        Signal('INV_Relay_5_Status',        28, 1, True, False, 1, 0, ''),
        Signal('INV_Relay_6_Status',        29, 1, True, False, 1, 0, ''),
        Signal('INV_Inverter_Run_Mode',     32, 1, True, False, 1, 0, ''),
        Signal('INV_Inverter_Discharge_State', 37, 3, True, False, 1, 0, ''),
        Signal('INV_Inverter_Command_Mode', 40, 1, True, False, 1, 0, ''),
        Signal('INV_Inverter_Enable_State', 48, 1, True, False, 1, 0, ''),
        Signal('INV_Direction_Command',     56, 1, True, False, 1, 0, ''),
        Signal('INV_BMS_Active',            57, 1, True, False, 1, 0, ''),
        Signal('INV_BMS_Limiting_Motor_Torque', 58, 1, True, False, 1, 0, ''),
    ])

    # 0xAB (171) - Fault Codes
    db[171] = Message(171, 'Inverter_Fault_Codes', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_Post_Fault_Lo', 0, 16, True, False, 1, 0, ''),
        Signal('INV_Post_Fault_Hi', 16, 16, True, False, 1, 0, ''),
        Signal('INV_Run_Fault_Lo',  32, 16, True, False, 1, 0, ''),
        Signal('INV_Run_Fault_Hi',  48, 16, True, False, 1, 0, ''),
    ])

    # 0xAC (172) - Torque and Timer
    db[172] = Message(172, 'Inverter_Torque_And_Timer_Info', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_Commanded_Torque',  0, 16, True, True, 0.1, 0, 'N·m'),
        Signal('INV_Torque_Feedback',  16, 16, True, True, 0.1, 0, 'N·m'),
        Signal('INV_Power_On_Timer',   32, 32, True, False, 0.003, 0, 's'),
    ])

    # 0xAD (173) - Modulation and Flux
    db[173] = Message(173, 'Inverter_Mod_And_Flux_Info', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_Modulation_Index',       0, 16, True, True, 0.0001, 0, ''),
        Signal('INV_Flux_Weakening_Output', 16, 16, True, True, 0.1, 0, 'A'),
        Signal('INV_Id_Command',            32, 16, True, True, 0.1, 0, 'A'),
        Signal('INV_Iq_Command',            48, 16, True, True, 0.1, 0, 'A'),
    ])

    # 0xB0 (176) - Fast Info (3ms cycle!)
    db[176] = Message(176, 'Inverter_Fast_Info', 8, 'INV', cycle_time_ms=3, signals=[
        Signal('INV_Fast_Torque_Command',   0, 16, True, True, 0.1, 0, 'N·m'),
        Signal('INV_Fast_Torque_Feedback', 16, 16, True, True, 0.1, 0, 'N·m'),
        Signal('INV_Fast_Motor_Speed',     32, 16, True, True, 1.0, 0, 'RPM'),
        Signal('INV_Fast_DC_Bus_Voltage',  48, 16, True, True, 0.1, 0, 'V'),
    ])

    # 0xB1 (177) - Torque Capability
    db[177] = Message(177, 'Inverter_Torque_Capability', 8, 'INV', cycle_time_ms=10, signals=[
        Signal('INV_Torque_Capability_Motor', 0, 16, True, True, 0.1, 0, 'N·m'),
        Signal('INV_Torque_Capability_Regen', 16, 16, True, True, 0.1, 0, 'N·m'),
    ])

    # ---- BMS (Orion BMS 2) ----

    # 0x6B0 (1712) — Pack summary (8ms cycle, Motorola byte order!)
    db[1712] = Message(1712, 'BMS_Pack_Summary', 8, 'BMS', cycle_time_ms=8, signals=[
        Signal('Pack_Current',        7, 16, False, True,  0.1, 0, 'A'),
        Signal('Pack_Summed_Voltage', 23, 16, False, False, 0.1, 0, 'V'),
        Signal('Pack_SOC',            39, 8,  False, False, 0.5, 0, '%'),
        Signal('Discharge_Relay',     48, 1,  True,  False, 1, 0, ''),
        Signal('Charge_Relay',        49, 1,  True,  False, 1, 0, ''),
        Signal('Ready_Power_Signal',  54, 1,  True,  False, 1, 0, ''),
    ])

    # 0x6B1 (1713) — Pack limits & temps (104ms cycle, Motorola)
    db[1713] = Message(1713, 'BMS_Pack_Limits', 8, 'BMS', cycle_time_ms=104, signals=[
        Signal('Pack_DCL',          7, 16, False, False, 1.0, 0, 'A'),
        Signal('Pack_CCL',         23,  8, False, False, 1.0, 0, 'A'),
        Signal('High_Temperature', 39,  8, False, True,  1, 0, '°C'),
        Signal('Low_Temperature',  47,  8, False, True,  1, 0, '°C'),
    ])

    # 0x6B2 (1714) — Cell voltages (8ms cycle, Motorola)
    db[1714] = Message(1714, 'BMS_Cell_Voltages', 8, 'BMS', cycle_time_ms=8, signals=[
        Signal('Low_Cell_Voltage',  7, 16, False, False, 0.0001, 0, 'V'),
        Signal('High_Cell_Voltage', 23, 16, False, False, 0.0001, 0, 'V'),
    ])

    # 0x202 (514) - BMS Current Limit
    db[514] = Message(514, 'BMS_Current_Limit', 8, 'BMS', signals=[
        Signal('BMS_Max_Discharge_Current', 0, 16, True, False, 1, 0, 'A'),
        Signal('BMS_Max_Charge_Current',   16, 16, True, False, 1, 0, 'A'),
    ])

    # ---- VCU ----

    # 0x500 (1280) - VCU Diagnostics
    db[1280] = Message(1280, 'VCU_Diagnostics', 8, 'VCU', cycle_time_ms=100, signals=[
        Signal('Calc_Vehicle_Speed',  0, 16, True, True, 1, 0, 'mph'),
        Signal('Requested_Torque',   16, 16, True, True, 1, 0, 'N·m'),
        Signal('APPS1_as_percent',   32,  8, True, True, 1, 0, '%'),
        Signal('APPS2_as_percent',   40,  8, True, True, 1, 0, '%'),
        Signal('BSE_as_percent',     48,  8, True, True, 1, 0, '%'),
        Signal('IMD_Fault',          56,  1, True, False, 1, 0, ''),
        Signal('RTD_State',          57,  1, True, False, 1, 0, ''),
        Signal('Precharge_Relay_State', 58, 1, True, False, 1, 0, ''),
        Signal('AIR_POS_Relay_State', 59, 1, True, False, 1, 0, ''),
        Signal('AIR_NEG_Relay_State', 60, 1, True, False, 1, 0, ''),
    ])

    # 0xC0 (192) - Inverter Command
    db[192] = Message(192, 'Inverter_Command_Message', 8, 'VCU', cycle_time_ms=10, signals=[
        Signal('VCU_INV_Torque_Command',     0, 16, True, True, 0.1, 0, 'N·m'),
        Signal('VCU_INV_Speed_Command',     16, 16, True, True, 1.0, 0, 'RPM'),
        Signal('VCU_INV_Direction_Command', 32,  1, True, False, 1, 0, ''),
        Signal('VCU_INV_Inverter_Enable',   40,  1, True, False, 1, 0, ''),
        Signal('VCU_INV_Inverter_Discharge', 41, 1, True, False, 1, 0, ''),
    ])

    # ---- FUSEBOX ----

    # 0x4F0 (1264) - Fusebox State
    db[1264] = Message(1264, 'Fusebox_State', 7, 'Fusebox', cycle_time_ms=200, signals=[
        Signal('Fusebox_State',   0, 8, True, False, 1, 0, ''),
        Signal('DCDC_Voltage',    8, 16, True, False, 1, 0, 'mV'),
        Signal('Battery_Voltage', 24, 16, True, False, 1, 0, 'mV'),
        Signal('LVB_SOC',        40,  8, True, False, 1, 0, '%'),
        Signal('DCDC_Temp',      48,  8, True, False, 10, 0, '°C'),
    ])

    # 0x4F1 (1265) - Fusebox Power Draw
    db[1265] = Message(1265, 'Fusebox_Power_Draw', 8, 'Fusebox', cycle_time_ms=50, signals=[
        Signal('Accy_Fan_Power',       0, 16, True, False, 100, 0, 'W'),
        Signal('Tractive_Fan_Power',  16, 16, True, False, 100, 0, 'W'),
        Signal('Tractive_Pumps_Power', 32, 16, True, False, 100, 0, 'W'),
        Signal('Charging_Power',      48, 16, True, False, 100, 0, 'W'),
    ])

    # 0x4F2 (1266) - Fusebox Secondary Diag
    db[1266] = Message(1266, 'Fusebox_Secondary_Diag', 8, 'Fusebox', signals=[
        Signal('Ambient_Temp', 0, 8, True, False, 1, 0, '°C'),
    ])

    # ---- SMU (GPS + IMU, from the mk11-smu firmware) ----

    # 0x4F3 (1267) - GPS Position
    db[0x4F3] = Message(0x4F3, 'GPS_Position', 8, 'SMU', cycle_time_ms=100, signals=[
        Signal('GPS_Latitude',   0, 32, True, True, 1e-7, 0, '°'),
        Signal('GPS_Longitude', 32, 32, True, True, 1e-7, 0, '°'),
    ])

    # 0x4F4 (1268) - GPS Navigation
    db[0x4F4] = Message(0x4F4, 'GPS_Navigation', 8, 'SMU', cycle_time_ms=100, signals=[
        Signal('GPS_Velocity',    0, 16, True, False, 0.01, 0, 'm/s'),
        Signal('GPS_Heading',    16, 16, True, True,  0.01, 0, '°'),
        Signal('GPS_Altitude',   32, 16, True, True,  0.1, 0, 'm'),
        Signal('GPS_Fix_Valid',  48,  8, True, False, 1, 0, ''),
        Signal('GPS_Satellites', 56,  8, True, False, 1, 0, ''),
    ])

    # 0x4F5 (1269) - IMU Acceleration
    db[0x4F5] = Message(0x4F5, 'IMU_Acceleration', 8, 'SMU', cycle_time_ms=10, signals=[
        Signal('IMU_Accel_X',    0, 16, True, True, 0.001, 0, 'g'),
        Signal('IMU_Accel_Y',   16, 16, True, True, 0.001, 0, 'g'),
        Signal('IMU_Accel_Z',   32, 16, True, True, 0.001, 0, 'g'),
        Signal('IMU_Cal_Done',  48,  8, True, False, 1, 0, ''),
    ])

    # 0x4F6 (1270) - IMU Attitude
    db[0x4F6] = Message(0x4F6, 'IMU_Attitude', 8, 'SMU', cycle_time_ms=10, signals=[
        Signal('IMU_Pitch',      0, 16, True, True, 0.01, 0, '°'),
        Signal('IMU_Roll',      16, 16, True, True, 0.01, 0, '°'),
        Signal('IMU_Yaw',       32, 16, True, True, 0.01, 0, '°'),
        Signal('IMU_Comm_OK',   48,  8, True, False, 1, 0, ''),
        Signal('IMU_Init_OK',   56,  8, True, False, 1, 0, ''),
    ])

    # ---- Custom BMS Diag ----
    db[1715] = Message(1715, 'CustomBMS_DiagInfo', 8, 'BMS', signals=[
        Signal('Precharge_Complete', 0, 1, True, False, 1, 0, ''),
    ])

    return db


# Module-level singleton
BFR_CAN_DB = build_bfr_database()


def decode_can_frame(can_id: int, data: bytes) -> Optional[dict[str, float]]:
    """
    Decode a CAN frame using the BFR database.

    Args:
        can_id: The 11-bit or 29-bit CAN identifier.
        data: Raw payload bytes.

    Returns:
        Dict of {signal_name: physical_value} if the CAN ID is known, else None.
    """
    msg = BFR_CAN_DB.get(can_id)
    if msg is None:
        return None
    return decode_message(data, msg)


def get_message_name(can_id: int) -> Optional[str]:
    """Get the human-readable message name for a CAN ID."""
    msg = BFR_CAN_DB.get(can_id)
    return msg.name if msg else None
