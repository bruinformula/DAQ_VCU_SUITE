from dbc_decoder import Signal, _extract_intel, _extract_motorola

# BMS payload bytes (from 3328V, -3174A, 68% SOC, 2.6V, 5.9V, -51C, 8C)
# Let's just create a raw byte payload that matches the endian-swapped values:
# 390.0V (0x0F3C) -> 3900 -> swapped: 0x3C0F
# But wait, we deduced Pack Voltage was actually 13.0V! (0x0082) -> swapped: 0x8200 -> 33280 -> 3328.0V!
# So let's test if we decode 0x8200 as Little Endian, do we get 13.0V?

data_pack = bytes.fromhex("0484008288000000") # 8 bytes
# Byte 0/1: Pack Current: 04 84 (Little Endian) -> 0x8404 = -31740 = -3174.0A? Wait, if it's signed 16-bit:
# 0x8404 signed is -31740. So 0x0484 Little Endian is 0x8404? 
# No! 0x0484 Little Endian is 0x8404! 
# Let's decode it:
print("Pack Current (LE 0):", _extract_intel(data_pack, 0, 16) - (65536 if _extract_intel(data_pack, 0, 16) > 32767 else 0))
print("Pack Voltage (LE 16):", _extract_intel(data_pack, 16, 16))
print("SOC (LE 32):", _extract_intel(data_pack, 32, 8))

data_limits = bytes.fromhex("78E6906500000000") # Cell voltages
print("Low Cell (LE 0):", _extract_intel(data_limits, 0, 16))
print("High Cell (LE 16):", _extract_intel(data_limits, 16, 16))

data_temps = bytes.fromhex("00000000CD080000") # Temps
print("High Temp (LE 32):", _extract_intel(data_temps, 32, 8) - (256 if _extract_intel(data_temps, 32, 8) > 127 else 0))
print("Low Temp (LE 40):", _extract_intel(data_temps, 40, 8) - (256 if _extract_intel(data_temps, 40, 8) > 127 else 0))
