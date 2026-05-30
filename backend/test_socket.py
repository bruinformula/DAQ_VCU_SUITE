import asyncio
import websockets
import json

async def test():
    async with websockets.connect("ws://localhost:8000/ws") as websocket:
        print("Connected.")
        await websocket.send(json.dumps({"action": "START_LOG"}))
        print("Sent START_LOG")
        await asyncio.sleep(1)
        await websocket.send(json.dumps({"action": "STOP_LOG"}))
        print("Sent STOP_LOG")
        await asyncio.sleep(1)
        print("Done.")

asyncio.run(test())
