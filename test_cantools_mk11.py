from backend.dbc_decoder import decode_can_frame

# Let's test the payload that gave "3303V" under the old layout.
# Wait, "3303V" was raw 33030 = 0x8106.
# Let's use 390.0V -> raw 39000 (390.0 * 100) -> 0x9858
# Let's use the payload from the screenshot where Pack Voltage was 3303V.
# The user's screenshot had: 3303V, 2.7V, 0.1V, -3174A, 68%, -40C, 8C, 3338A.

# Wait, if `decode_can_frame` uses `db.get_message_by_frame_id`, it will use the overridden ones.
# 1712: VOLTAGE_DF. 1713: TEMP_DF. 1714: SOC_CURR_PACK_DF.

# Test 1714: SOC=68.0% (6800 -> 0x1A90), Curr=20.5A (2050 -> 0x0802), Volt=390.0V (39000 -> 0x9858)
data = bytes.fromhex("901A020858980000")
print("1714 test:", decode_can_frame(1714, data))

