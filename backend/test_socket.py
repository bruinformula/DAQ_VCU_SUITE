import socket
import struct
import can

# Read one packet using raw socket
s = socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW)
s.bind(("can0",))
s.setblocking(True)
print("Waiting for RAW socket packet...")
frame = s.recv(16)
print("RAW frame hex:", frame.hex())

can_id, can_dlc, pad, raw_data = struct.unpack("<IB3s8s", frame)
print(f"RAW Unpacked: ID={hex(can_id)}, DLC={can_dlc}, pad={pad.hex()}, data={raw_data.hex()}")
s.close()

# Read one packet using python-can
print("\nWaiting for python-can packet...")
bus = can.interface.Bus(channel="can0", interface="socketcan")
msg = bus.recv()
print(f"python-can: ID={hex(msg.arbitration_id)}, DLC={msg.dlc}, data={msg.data.hex()}")
bus.shutdown()
