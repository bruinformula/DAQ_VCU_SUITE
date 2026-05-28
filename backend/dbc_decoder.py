import os
import cantools

# Load the DBC file directly
DBC_PATH = os.path.join(os.path.dirname(__file__), "bfr_can.dbc")
db = cantools.database.load_file(DBC_PATH, strict=False)

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
