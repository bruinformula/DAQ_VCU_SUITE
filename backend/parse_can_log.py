import csv
import sys
import re
import os
from pathlib import Path

# Add the parent directory and current directory to sys.path so we can import backend modules properly
# if this script is executed directly from the frontend child_process
_backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(_backend_dir)
sys.path.append(os.path.dirname(_backend_dir))

# Mock FastAPI so we can import backend_engine without it being installed
from unittest.mock import MagicMock
sys.modules['fastapi'] = MagicMock()
sys.modules['fastapi.middleware.cors'] = MagicMock()
sys.modules['fastapi.responses'] = MagicMock()
sys.modules['fastapi.staticfiles'] = MagicMock()

from backend.backend_engine import TelemetryState
from backend.dbc_decoder import decode_can_frame
from backend.sdu_decoder import parse_sdu_id, minimum_sdu_payload_length
from backend.backend_engine import (
    decode_gps_cog_timesync_frame,
    decode_gps_cog_pos_frame,
    decode_gps_cog_nav_frame,
    decode_imu_fd_frame,
    decode_tshmu_frame,
    decode_tshmu_temp_frame,
)

def rename_key(key):
    board_positions = {0: 'FL', 1: 'FR', 2: 'RL', 3: 'RR'}
    # Rename arrays to their physical locations
    m = re.match(r'^(sdu|tspmu|tshmu)\[(\d+)\]\.(.*)$', key)
    if m:
        prefix, idx, rest = m.groups()
        idx = int(idx)
        pos = board_positions.get(idx, f"B{idx}")
        return f"{pos}_{prefix.upper()}_{rest.upper()}"
    return key.upper()

def parse_can_log(input_file: str, output_file: str):
    state = TelemetryState()
    
    rows_to_write = []
    last_sample_ts = None
    
    with open(input_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if 'ts' not in row or 'id_dec' not in row or 'data_hex' not in row:
                continue
                
            ts = float(row['ts'])
            can_id = int(row['id_dec'])
            data_hex = row['data_hex'].strip()
            
            if not data_hex:
                continue
                
            data = bytes.fromhex(data_hex)
            
            if can_id == 0x040:
                decoded = decode_gps_cog_timesync_frame(can_id, data)
                if decoded: state.apply_dbc_signals(can_id, decoded)
            elif can_id == 0x041:
                decoded = decode_gps_cog_pos_frame(can_id, data)
                if decoded: state.apply_dbc_signals(can_id, decoded)
            elif can_id == 0x042:
                decoded = decode_gps_cog_nav_frame(can_id, data)
                if decoded: state.apply_dbc_signals(can_id, decoded)
            elif can_id in (0x043, 0x04B, 0x053):
                decoded = decode_imu_fd_frame(can_id, data)
                if decoded: state.apply_imu_fd_frame(decoded)
            else:
                sdu_info = parse_sdu_id(can_id)
                if sdu_info is not None and len(data) >= minimum_sdu_payload_length(sdu_info):
                    state.apply_sdu_frame(can_id, list(data))
                else:
                    tshmu_flow = decode_tshmu_frame(can_id, data)
                    if tshmu_flow: 
                        state.apply_tshmu_frame(tshmu_flow)
                    
                    tshmu_temp = decode_tshmu_temp_frame(can_id, data)
                    if tshmu_temp: 
                        state.apply_tshmu_temp_frame(tshmu_temp)
                    
                    if 0x4F5 <= can_id <= 0x4FA:
                        state.apply_imu_raw_frame(can_id, data)
                    else:
                        # Decode standard DBC
                        signals = decode_can_frame(can_id, data)
                        if signals:
                            state.apply_dbc_signals(can_id, signals)

            # Sample at 50Hz (0.02s) to avoid massive files, but keep it high res enough for graphs
            if last_sample_ts is None or (ts - last_sample_ts) >= 0.02:
                state.timestamp = ts
                flat = state.to_signal_map()
                renamed = {rename_key(k): v for k, v in flat.items()}
                rows_to_write.append(renamed)
                last_sample_ts = ts

    if not rows_to_write:
        print("No valid rows parsed.")
        return

    # Collect all unique keys for header
    all_keys = set()
    for r in rows_to_write:
        all_keys.update(r.keys())
    
    # Sort keys, ensure TS is first
    sorted_keys = sorted(list(all_keys))
    if 'TS' in sorted_keys:
        sorted_keys.remove('TS')
    sorted_keys.insert(0, 'TS')

    # Ensure output dir exists
    Path(output_file).parent.mkdir(parents=True, exist_ok=True)

    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=sorted_keys)
        writer.writeheader()
        writer.writerows(rows_to_write)
        
    print(f"Successfully exported to {output_file}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python parse_can_log.py <input.csv> <output.csv>")
        sys.exit(1)
        
    parse_can_log(sys.argv[1], sys.argv[2])
