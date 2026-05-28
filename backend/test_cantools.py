import sys
import cantools
from dbc_decoder import decode_can_frame

db = cantools.database.load_file("bfr_can.dbc", strict=False)

# Test BMS Pack Summary (Motorola)
bms_msg = db.get_message_by_frame_id(1712)
bms_data = b'\x0A\x0B\x0C\x0D\x0E\x0F\x1A\x1B'
print("BMS Data:", bms_data.hex())
print("Cantools BMS:", bms_msg.decode(bms_data))
print("My Code BMS :", decode_can_frame(1712, bms_data))
print("-" * 40)

# Test Inverter (Intel)
inv_msg = db.get_message_by_frame_id(167)
inv_data = b'\x0A\x0B\x0C\x0D\x0E\x0F\x1A\x1B'
print("INV Data:", inv_data.hex())
print("Cantools INV:", inv_msg.decode(inv_data))
print("My Code INV :", decode_can_frame(167, inv_data))
