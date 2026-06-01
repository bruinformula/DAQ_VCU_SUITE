import os
import cantools

# Load the DBC file directly
DBC_PATH = os.path.join(os.path.dirname(__file__), "bfr_can.dbc")
db = cantools.database.load_file(DBC_PATH, strict=False)

# PATCH: The Bruin Racing mk11-bms-mcu uses a completely custom layout for 
# IDs 1712, 1713, and 1714. The old Orion DBC file is entirely invalid for this car.
# We completely override these messages with the MK11 C-struct layouts.
import cantools.database.can.signal as can_signal
import cantools.database.can.message as can_message

import cantools.database.conversion as can_conv

# Create conversion objects
conv_0_01 = can_conv.LinearConversion.factory(scale=0.01, offset=0, is_float=False)
conv_1 = can_conv.LinearConversion.factory(scale=1, offset=0, is_float=False)
conv_gps_deg_e7 = can_conv.LinearConversion.factory(scale=0.0000001, offset=0, is_float=False)
conv_gps_alt_dm = can_conv.LinearConversion.factory(scale=0.1, offset=0, is_float=False)

# 1712: VOLTAGE_DF
msg_1712 = can_message.Message(frame_id=1712, name='BMS_Voltages', length=8, signals=[
    can_signal.Signal('Avg_Cell_Voltage', 0, 16, byte_order='little_endian', is_signed=False, conversion=conv_0_01, unit='V'),
    can_signal.Signal('Low_Cell_Voltage', 16, 16, byte_order='little_endian', is_signed=False, conversion=conv_0_01, unit='V'),
    can_signal.Signal('High_Cell_Voltage', 32, 16, byte_order='little_endian', is_signed=False, conversion=conv_0_01, unit='V'),
    can_signal.Signal('num_valid_voltages', 48, 8, byte_order='little_endian', is_signed=False, conversion=conv_1)
])

# 1713: TEMP_DF
msg_1713 = can_message.Message(frame_id=1713, name='BMS_Temperatures', length=8, signals=[
    can_signal.Signal('Avg_Temperature', 0, 16, byte_order='little_endian', is_signed=True, conversion=conv_0_01, unit='C'),
    can_signal.Signal('High_Temperature', 16, 16, byte_order='little_endian', is_signed=True, conversion=conv_0_01, unit='C'),
    can_signal.Signal('Low_Temperature', 32, 16, byte_order='little_endian', is_signed=True, conversion=conv_0_01, unit='C'),
    can_signal.Signal('num_valid_temps', 48, 8, byte_order='little_endian', is_signed=False, conversion=conv_1)
])

# 1714: SOC_CURR_PACK_DF
msg_1714 = can_message.Message(frame_id=1714, name='BMS_Soc_Curr_Pack', length=8, signals=[
    can_signal.Signal('Pack_SOC', 0, 16, byte_order='little_endian', is_signed=False, conversion=conv_0_01, unit='%'),
    can_signal.Signal('Pack_Current', 16, 16, byte_order='little_endian', is_signed=True, conversion=conv_0_01, unit='A'),
    can_signal.Signal('Pack_Summed_Voltage', 32, 16, byte_order='little_endian', is_signed=False, conversion=conv_0_01, unit='V')
])

# 1267 / 0x4F3: GPS1 position frame from mk11-smu
msg_1267 = can_message.Message(frame_id=1267, name='GPS1_Position', length=8, signals=[
    can_signal.Signal('GPS_Latitude', 0, 32, byte_order='little_endian', is_signed=True, conversion=conv_gps_deg_e7, unit='deg'),
    can_signal.Signal('GPS_Longitude', 32, 32, byte_order='little_endian', is_signed=True, conversion=conv_gps_deg_e7, unit='deg'),
])

# 1268 / 0x4F4: GPS1 navigation frame from mk11-smu
msg_1268 = can_message.Message(frame_id=1268, name='GPS1_Navigation', length=8, signals=[
    can_signal.Signal('GPS_Velocity', 0, 16, byte_order='little_endian', is_signed=False, conversion=conv_0_01, unit='m/s'),
    can_signal.Signal('GPS_Heading', 16, 16, byte_order='little_endian', is_signed=True, conversion=conv_0_01, unit='deg'),
    can_signal.Signal('GPS_Altitude', 32, 16, byte_order='little_endian', is_signed=True, conversion=conv_gps_alt_dm, unit='m'),
    can_signal.Signal('GPS_Fix_Valid', 48, 8, byte_order='little_endian', is_signed=False, conversion=conv_1),
    can_signal.Signal('GPS_Satellites', 56, 8, byte_order='little_endian', is_signed=False, conversion=conv_1),
])

# Apply overrides
for i in range(len(db.messages)):
    if db.messages[i].frame_id == 1712:
        db.messages[i] = msg_1712
    elif db.messages[i].frame_id == 1713:
        db.messages[i] = msg_1713
    elif db.messages[i].frame_id == 1714:
        db.messages[i] = msg_1714
    elif db.messages[i].frame_id == 1267:
        db.messages[i] = msg_1267
    elif db.messages[i].frame_id == 1268:
        db.messages[i] = msg_1268

db._frame_id_to_message[1712] = msg_1712
db._frame_id_to_message[1713] = msg_1713
db._frame_id_to_message[1714] = msg_1714
db._frame_id_to_message[1267] = msg_1267
db._frame_id_to_message[1268] = msg_1268

def decode_can_frame(can_id: int, data: bytes):
    try:
        msg = db.get_message_by_frame_id(can_id)
        return msg.decode(data)
    except KeyError:
        # ID not in DBC
        return None
    except Exception as e:
        # Decoding error
        # print(f"Decode error for {can_id}: {e}")
        return None

# Keep SDU decoding exactly as it was, since it's a custom 64-byte multiplexed format
from dataclasses import dataclass
from typing import Optional

@dataclass
class SDUFrame:
    board_index: int
    sensor_type: str
    latest: Optional[dict] = None

def decode_sdu_frame(can_id: int, data: bytes) -> Optional[SDUFrame]:
    import struct
    board_index = can_id - 1712
    if board_index < 0 or board_index > 3:
        return None
        
    sensor_id = data[0]
    if sensor_id == 0:
        if len(data) >= 5:
            val = struct.unpack('<f', data[1:5])[0]
            return SDUFrame(board_index, 'shock_pot', {'shock_mm': round(val, 1)})
    elif sensor_id == 1:
        if len(data) >= 5:
            val = struct.unpack('<f', data[1:5])[0]
            return SDUFrame(board_index, 'brake_temp', {'brake_c': round(val, 1)})
    elif sensor_id == 2:
        if len(data) >= 5:
            val = struct.unpack('<f', data[1:5])[0]
            return SDUFrame(board_index, 'wheel_speed', {'wheel_rpm': round(val, 1)})
    elif sensor_id == 3:
        if len(data) >= 17:
            t1, t2, t3, t4 = struct.unpack('<ffff', data[1:17])
            return SDUFrame(board_index, 'tire_temp', {
                'max_c': round(t1, 1), 'min_c': round(t2, 1),
                'center_c': round(t3, 1), 'ambient_c': round(t4, 1)
            })
    return None
