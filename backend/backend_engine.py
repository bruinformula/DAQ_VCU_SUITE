import asyncio
import time
import csv
from collections import deque
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="FENRIR Pit Sync Telemetry Hub")

# --- GLOBAL STATE ---
# At 50Hz, 30 seconds = 1500 samples.
HISTORY_BUFFER = deque(maxlen=1500) 

# Instead of nested dicts that require expensive deep copies at 50Hz, 
# we flatten the state slightly or explicitly construct snapshots.
CURRENT_STATE = {
    "timestamp": 0.0,
    "Pack_SOC": 0,
    "Pack_Summed_Voltage": 0.0,
    "INV_Motor_Speed": 0,
    "suspension_fl": 0.0,
    "steering_angle": 0.0,
    "is_logging": False
}

active_connections: list[WebSocket] = []

# --- LOOP A: CAN BUS (MOCKED) ---
async def loop_can_drainer():
    """Simulates draining the socketcan buffer and parsing DBC."""
    print("[SYSTEM] CAN Bus Loop Started.")
    while True:
        CURRENT_STATE["INV_Motor_Speed"] = int(5000 + (time.time() % 10) * 100)
        CURRENT_STATE["Pack_Summed_Voltage"] = round(384.2 - (time.time() % 10), 2)
        CURRENT_STATE["Pack_SOC"] = 85
        await asyncio.sleep(0.01)

# --- LOOP B: MDU SERIAL (MOCKED) ---
async def loop_mdu_serial():
    """Simulates reading /dev/ttyUSB0 via pyserial."""
    print("[SYSTEM] MDU Serial Loop Started.")
    while True:
        CURRENT_STATE["suspension_fl"] = round(45.2 + (time.time() % 2), 2)
        CURRENT_STATE["steering_angle"] = -12.5
        await asyncio.sleep(0.02)

# --- LOOP C: THE MASTER LOGGER ---
async def loop_csv_logger():
    """Handles the 30s rolling buffer and writes to NVMe/SD."""
    print("[SYSTEM] CSV Logger Loop Started.")
    was_logging = False
    current_csv = None
    writer = None

    while True:
        timestamp = time.time()
        CURRENT_STATE["timestamp"] = timestamp
        
        # 1. Efficient Snapshot Construction (O(1) dictionary creation instead of deepcopy)
        snapshot = {
            "timestamp": timestamp,
            "Pack_SOC": CURRENT_STATE["Pack_SOC"],
            "Pack_Summed_Voltage": CURRENT_STATE["Pack_Summed_Voltage"],
            "INV_Motor_Speed": CURRENT_STATE["INV_Motor_Speed"],
            "suspension_fl": CURRENT_STATE["suspension_fl"],
            "steering_angle": CURRENT_STATE["steering_angle"],
            # is_logging is not needed in the buffer
        }
        HISTORY_BUFFER.append(snapshot)

        # 2. Handle Logging State Transitions
        is_logging = CURRENT_STATE["is_logging"]

        if is_logging and not was_logging:
            # Triggered! Flush the 30-second buffer to a new file
            filename = f"bfr_log_{int(timestamp)}.csv"
            print(f"\n[LOGGER] TRIGGERED! Flushing buffer to {filename}")
            
            try:
                current_csv = open(filename, 'w', newline='')
                writer = csv.writer(current_csv)
                writer.writerow(["timestamp", "Pack_SOC", "Pack_Summed_Voltage", "INV_Motor_Speed", "suspension_fl", "steering_angle"])
                
                # Flush history efficiently
                for past_state in HISTORY_BUFFER:
                    writer.writerow([
                        past_state["timestamp"], 
                        past_state["Pack_SOC"], 
                        past_state["Pack_Summed_Voltage"],
                        past_state["INV_Motor_Speed"],
                        past_state["suspension_fl"],
                        past_state["steering_angle"]
                    ])
                print(f"[LOGGER] Flushed {len(HISTORY_BUFFER)} pre-trigger rows.")
                was_logging = True
            except Exception as e:
                print(f"[LOGGER] ERROR opening file: {e}")
                CURRENT_STATE["is_logging"] = False

        elif is_logging and was_logging and writer:
            # Continually append live data
            writer.writerow([
                timestamp, 
                snapshot["Pack_SOC"], 
                snapshot["Pack_Summed_Voltage"],
                snapshot["INV_Motor_Speed"],
                snapshot["suspension_fl"],
                snapshot["steering_angle"]
            ])
            # Optional: flush periodically if running long logs
            # current_csv.flush()

        elif not is_logging and was_logging:
            # Stopped logging
            print("[LOGGER] Stopped. File saved.")
            if current_csv:
                current_csv.close()
                current_csv = None
                writer = None
            was_logging = False

        # Run exactly at 50Hz (0.02s) to match telemetry
        await asyncio.sleep(0.02)

# --- LOOP D: WEBSOCKET BROADCASTER ---
async def loop_ws_broadcaster():
    """Pushes 50Hz JSON to all connected React clients."""
    print("[SYSTEM] WS Broadcaster Loop Started.")
    while True:
        if active_connections:
            # We reconstruct the nested structure here so the frontend gets a clean API
            # This is fast because we just do it once per frame, not per client
            payload = {
                "timestamp": CURRENT_STATE["timestamp"],
                "can": {
                    "Pack_SOC": CURRENT_STATE["Pack_SOC"],
                    "Pack_Summed_Voltage": CURRENT_STATE["Pack_Summed_Voltage"],
                    "INV_Motor_Speed": CURRENT_STATE["INV_Motor_Speed"]
                },
                "mdu": {
                    "suspension_fl": CURRENT_STATE["suspension_fl"],
                    "steering_angle": CURRENT_STATE["steering_angle"]
                },
                "is_logging": CURRENT_STATE["is_logging"]
            }
            
            # Send to all connected clients
            dead_connections = []
            for ws in active_connections:
                try:
                    await ws.send_json(payload)
                except Exception:
                    dead_connections.append(ws)
            
            for ws in dead_connections:
                active_connections.remove(ws)
                
        await asyncio.sleep(0.02) # 50Hz Output Throttle

# --- FASTAPI LIFESPAN & ENDPOINTS ---
@app.on_event("startup")
async def startup_event():
    """Fires up all background loops when the server boots."""
    asyncio.create_task(loop_can_drainer())
    asyncio.create_task(loop_mdu_serial())
    asyncio.create_task(loop_csv_logger())
    asyncio.create_task(loop_ws_broadcaster())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    print(f"[NETWORK] Laptop Connected! Active links: {len(active_connections)}")
    try:
        while True:
            # Listen for commands from the React GUI
            data = await websocket.receive_json()
            
            if data.get("action") == "START_LOG":
                CURRENT_STATE["is_logging"] = True
                print("[NETWORK] Received START_LOG command from GUI.")
            elif data.get("action") == "STOP_LOG":
                CURRENT_STATE["is_logging"] = False
                print("[NETWORK] Received STOP_LOG command from GUI.")
                
    except WebSocketDisconnect:
        print("[NETWORK] Laptop Disconnected.")
        if websocket in active_connections:
            active_connections.remove(websocket)
