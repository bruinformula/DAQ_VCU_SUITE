import cantools

db = cantools.database.load_file("bfr_can.dbc", strict=False)

# Patch the BMS messages to be little-endian
for msg in db.messages:
    if msg.senders and 'BMS' in msg.senders:
        for sig in msg.signals:
            if sig.byte_order == 'big_endian':
                sig.byte_order = 'little_endian'
                # For 16-bit values, if we switch from big to little endian,
                # we need to adjust the start_bit from MSB to LSB.
                # In DBC files, start_bit for big-endian is MSB.
                # start_bit for little-endian is LSB.
                # If they physically occupy the same two bytes (e.g. Byte 0 and Byte 1)
                # Big-endian MSB in Byte 0 is start_bit 7.
                # Little-endian LSB in Byte 0 is start_bit 0.
                if sig.length == 16:
                    sig.start = sig.start - 7
                elif sig.length == 8:
                    sig.start = sig.start - 7
                elif sig.length == 1:
                    # Single bits usually don't need adjustment if they stay within the same byte,
                    # but actually a 1-bit signal in Big Endian at bit 48 (Byte 6 bit 0? No, 48 is Byte 6 bit 7)
                    pass

data_pack = bytes.fromhex("06810A0D00000000") # 33030 -> 0x8106 -> 166.5V
bms_msg = db.get_message_by_frame_id(1712)
print("Patched BMS Pack:", bms_msg.decode(data_pack))
