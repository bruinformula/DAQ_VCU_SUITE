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
    if key == 'ts' or key == 'id_dec' or key == 'data_hex':
        return key
    return key.upper()

class ByteTracker:
    def __init__(self, f):
        self.f = f
        self.bytes_read = 0
    def __iter__(self):
        return self
    def __next__(self):
        line = next(self.f)
        self.bytes_read += len(line.encode('utf-8'))
        return line

def parse_can_log(input_file: str, output_file: str):
    print("Pass 1: Discovering signal headers dynamically...", flush=True)
    state = TelemetryState()
    
    total_size = os.path.getsize(input_file)
    time_offset = 0.0
    previous_raw_ts = None
    
    with open(input_file, 'r', encoding='utf-8') as f:
        tracker = ByteTracker(f)
        reader = csv.DictReader(tracker)
        row_count = 0
        for row in reader:
            row_count += 1
            if row_count % 10000 == 0:
                percent = min(100.0, (tracker.bytes_read / total_size) * 100.0)
                print(f"PASS 1 PROGRESS: {percent:.1f}%", flush=True)

            if 'ts' not in row or 'id_dec' not in row or 'data_hex' not in row:
                continue
                
            raw_ts = float(row['ts'])
            if previous_raw_ts is not None:
                delta = raw_ts - previous_raw_ts
                if delta < -1.0:
                    time_offset += (previous_raw_ts - raw_ts) + 0.001
            
            previous_raw_ts = raw_ts
            ts = raw_ts + time_offset
            
            can_id = int(row['id_dec'])
            data_hex = row['data_hex'].strip()
            if not data_hex:
                continue
            data = bytes.fromhex(data_hex)
            
            if can_id == 0x040:
                decoded = decode_gps_cog_timesync_frame(can_id, data)
                if decoded: state.apply_dbc_signals(can_id, decoded, log_timestamp=ts)
            elif can_id == 0x041:
                decoded = decode_gps_cog_pos_frame(can_id, data)
                if decoded: state.apply_dbc_signals(can_id, decoded, log_timestamp=ts)
            elif can_id == 0x042:
                decoded = decode_gps_cog_nav_frame(can_id, data)
                if decoded: state.apply_dbc_signals(can_id, decoded, log_timestamp=ts)
            elif can_id in (0x043, 0x04B, 0x053):
                decoded = decode_imu_fd_frame(can_id, data)
                if decoded: state.apply_imu_fd_frame(decoded, log_timestamp=ts)
            else:
                sdu_info = parse_sdu_id(can_id)
                if sdu_info is not None and len(data) >= minimum_sdu_payload_length(sdu_info):
                    state.apply_sdu_frame(can_id, list(data), log_timestamp=ts)
                else:
                    tshmu_flow = decode_tshmu_frame(can_id, data)
                    if tshmu_flow: 
                        state.apply_tshmu_frame(tshmu_flow, log_timestamp=ts)
                    
                    tshmu_temp = decode_tshmu_temp_frame(can_id, data)
                    if tshmu_temp: 
                        state.apply_tshmu_temp_frame(tshmu_temp, log_timestamp=ts)
                    
                    if 0x4F5 <= can_id <= 0x4FA:
                        state.apply_imu_raw_frame(can_id, data, log_timestamp=ts)
                    else:
                        signals = decode_can_frame(can_id, data)
                        if signals:
                            state.apply_dbc_signals(can_id, signals, log_timestamp=ts)
            
            # CLEAR the queue in pass 1 so memory doesn't explode!
            state._high_rate_queue.clear()

    # Pass 1 done, determine headers
    all_keys = set({rename_key(k) for k in state.to_signal_map().keys()})
    sorted_keys = sorted(list(all_keys))
    if 'ts' in sorted_keys: sorted_keys.remove('ts')
    if 'TS' in sorted_keys: sorted_keys.remove('TS')
    sorted_keys.insert(0, 'ts')

    print(f"\nPass 1 Complete. Found {len(sorted_keys)} unique signals.", flush=True)
    print("Pass 2: Streaming fully lossless high-rate CSV...", flush=True)

    state = TelemetryState()
    Path(output_file).parent.mkdir(parents=True, exist_ok=True)
    
    time_offset = 0.0
    previous_raw_ts = None
    
    with open(output_file, 'w', newline='', encoding='utf-8') as out_f:
        writer = csv.DictWriter(out_f, fieldnames=sorted_keys)
        writer.writeheader()
        
        with open(input_file, 'r', encoding='utf-8') as f:
            tracker = ByteTracker(f)
            reader = csv.DictReader(tracker)
            row_count = 0
            
            for row in reader:
                row_count += 1
                if row_count % 10000 == 0:
                    percent = min(100.0, (tracker.bytes_read / total_size) * 100.0)
                    print(f"PASS 2 PROGRESS: {percent:.1f}%", flush=True)

                if 'ts' not in row or 'id_dec' not in row or 'data_hex' not in row:
                    continue
                    
                raw_ts = float(row['ts'])
                if previous_raw_ts is not None:
                    delta = raw_ts - previous_raw_ts
                    if delta < -1.0:
                        time_offset += (previous_raw_ts - raw_ts) + 0.001
                
                previous_raw_ts = raw_ts
                ts = raw_ts + time_offset
                
                can_id = int(row['id_dec'])
                data_hex = row['data_hex'].strip()
                if not data_hex:
                    continue
                data = bytes.fromhex(data_hex)
                
                # Apply data to state
                if can_id == 0x040:
                    decoded = decode_gps_cog_timesync_frame(can_id, data)
                    if decoded: state.apply_dbc_signals(can_id, decoded, log_timestamp=ts)
                elif can_id == 0x041:
                    decoded = decode_gps_cog_pos_frame(can_id, data)
                    if decoded: state.apply_dbc_signals(can_id, decoded, log_timestamp=ts)
                elif can_id == 0x042:
                    decoded = decode_gps_cog_nav_frame(can_id, data)
                    if decoded: state.apply_dbc_signals(can_id, decoded, log_timestamp=ts)
                elif can_id in (0x043, 0x04B, 0x053):
                    decoded = decode_imu_fd_frame(can_id, data)
                    if decoded: state.apply_imu_fd_frame(decoded, log_timestamp=ts)
                else:
                    sdu_info = parse_sdu_id(can_id)
                    if sdu_info is not None and len(data) >= minimum_sdu_payload_length(sdu_info):
                        state.apply_sdu_frame(can_id, list(data), log_timestamp=ts)
                    else:
                        tshmu_flow = decode_tshmu_frame(can_id, data)
                        if tshmu_flow: 
                            state.apply_tshmu_frame(tshmu_flow, log_timestamp=ts)
                        
                        tshmu_temp = decode_tshmu_temp_frame(can_id, data)
                        if tshmu_temp: 
                            state.apply_tshmu_temp_frame(tshmu_temp, log_timestamp=ts)
                        
                        if 0x4F5 <= can_id <= 0x4FA:
                            state.apply_imu_raw_frame(can_id, data, log_timestamp=ts)
                        else:
                            signals = decode_can_frame(can_id, data)
                            if signals:
                                state.apply_dbc_signals(can_id, signals, log_timestamp=ts)
                
                # After applying ONE CAN frame, the high_rate_queue contains all intermediate samples 
                # (and the final sample for DBC) generated by this exact frame.
                state.timestamp = ts
                flat = state.to_signal_map()
                
                while state._high_rate_queue:
                    override = state._high_rate_queue.popleft()
                    merged = {**flat, **override}
                    override_ts = override.pop('ts', ts)
                    merged['ts'] = override_ts
                    renamed = {rename_key(k): v for k, v in merged.items()}
                    # Filter out any keys that appeared mid-log but weren't in sorted_keys 
                    # (should never happen due to Pass 1, but just in case)
                    filtered = {k: v for k, v in renamed.items() if k in sorted_keys}
                    writer.writerow(filtered)
                    
    print(f"\nSuccessfully exported completely lossless trace to {output_file}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python parse_can_log.py <input.csv> <output.csv>")
        sys.exit(1)
        
    try:
        parse_can_log(sys.argv[1], sys.argv[2])
    except TimeoutError as e:
        print(f"\n[ERROR] File read timed out: {e}", file=sys.stderr)
        print("[TIP] This usually happens if the input file is stored in iCloud Drive (or another cloud sync folder) and has been offloaded from local storage. Please right-click the file in Finder and select 'Download Now', or copy it to a local folder outside iCloud (such as inside the DAQ_VCU_SUITE workspace) and try again.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
