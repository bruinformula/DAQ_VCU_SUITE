import cantools
from dbc_decoder import decode_can_frame

db = cantools.database.load_file("bfr_can.dbc", strict=False)

data = bytes.fromhex("00000F3C00000000")
msg = db.get_message_by_frame_id(1712)
print("Cantools:", msg.decode(data))
print("My Code:", decode_can_frame(1712, data))
