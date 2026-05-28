import cantools

# Load the DBC
db = cantools.database.load_file("bfr_can.dbc", strict=False)
bms_msg = db.get_message_by_frame_id(1712)

# This is the payload that my manual little-endian parsing interpreted as:
# Pack Voltage: 13.0V, SOC: 136% -> wait, the screenshot showed SOC: 68.0%
# Let's use exactly what was in the screenshot:
# SOC 68.0% * 2 = 136 = 0x88.
# High Cell 2.6V = 26000 = 0x6590
# Low Cell 0.0V ? (wait, the FIRST screenshot showed High Cell 2.6V, Low Cell 0.0V)

data_pack = bytes.fromhex("0484008288000000") # 8 bytes
print("Cantools BMS Pack:", bms_msg.decode(data_pack))

bms_limits = db.get_message_by_frame_id(1713)
# screenshot 1: High Temp -66.0C, Low Temp 8.0C
data_limits = bytes.fromhex("00000000BE080000")
print("Cantools BMS Limits:", bms_limits.decode(data_limits))

