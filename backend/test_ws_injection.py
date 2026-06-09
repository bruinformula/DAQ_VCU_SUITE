import asyncio
import json
import time
import websockets

async def inject_mock_frames():
    uri = "ws://127.0.0.1:8000/ws"
    
    frames = [
        # VCU Cooling CMD (1281)
        {
            "ts": time.time(),
            "id": 1281,
            "dlc": 4,
            "d": "01321400" # Enable=1, Tractive Fan=50(0x32), Tractive Pump=20(0x14), Accy Fan=0(0x00)
        },
        # VCU Diagnostics (1280)
        {
            "ts": time.time(),
            "id": 1280,
            "dlc": 8,
            "d": "1A002C0110200003" # Speed=26, Torque=300, APPS1=16, APPS2=32, BSE=0, Flags=3 (IMD Fault, RTD)
        },
        # Fusebox State (1264)
        {
            "ts": time.time(),
            "id": 1264,
            "dlc": 7,
            "d": "05B004D0075023" # State=5, DCDC=1200mV, Batt=2000mV, SOC=80%, Temp=35C
        }
    ]
    
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected to WebSocket.")
            await websocket.send(json.dumps(frames))
            print("Injected test CAN frames.")
            await asyncio.sleep(1)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(inject_mock_frames())
