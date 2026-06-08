"""MDU board-frame parser ported from mk11-mdu-code/mdu debug gui/src/main/mdu-frame.js.

This module intentionally mirrors the MDU GUI's decode rules for SDU/TSPMU/
TSHMU/GPS/IMU board traffic so the DAQ backend can use the same parsing logic
for board-originated frames.
"""

from __future__ import annotations

from typing import Optional, Sequence


def _to_signed8(value: int) -> int:
    return value - 256 if value > 127 else value


def _to_signed16(value: int) -> int:
    return value - 65536 if value > 32767 else value


def _get_u16_le(data: list[int], offset: int) -> int:
    return data[offset] | (data[offset + 1] << 8)


def _get_u32_le(data: list[int], offset: int) -> int:
    return (
        data[offset]
        | (data[offset + 1] << 8)
        | (data[offset + 2] << 16)
        | (data[offset + 3] << 24)
    ) & 0xFFFFFFFF


def _get_s32_le(data: list[int], offset: int) -> int:
    raw = _get_u32_le(data, offset)
    return raw - 0x100000000 if raw > 0x7FFFFFFF else raw


def _decode_strain_gauge_blocks(data: list[int]) -> list[dict]:
    blocks = []
    for index in range(5):
        offset = 6 + index * 10
        if offset + 9 >= len(data):
            break

        ch1_upper = data[offset]
        ch2_upper = data[offset + 1]
        ch1_ch2_lower = data[offset + 2]
        ch3_upper = data[offset + 3]
        ch4_upper = data[offset + 4]
        ch3_ch4_lower = data[offset + 5]
        ch5_upper = data[offset + 6]
        ch6_upper = data[offset + 7]
        ch5_ch6_lower = data[offset + 8]
        jitter_us = _to_signed8(data[offset + 9])

        raw_values = [
            (ch1_upper << 4) | (ch1_ch2_lower >> 4),
            (ch2_upper << 4) | (ch1_ch2_lower & 0x0F),
            (ch3_upper << 4) | (ch3_ch4_lower >> 4),
            (ch4_upper << 4) | (ch3_ch4_lower & 0x0F),
            (ch5_upper << 4) | (ch5_ch6_lower >> 4),
            (ch6_upper << 4) | (ch5_ch6_lower & 0x0F),
        ]

        blocks.append({
            'index': index,
            'strainGaugesMv': [round((value / 4095.0) * 6600.0 - 3300.0) for value in raw_values],
            'jitterUs': jitter_us,
        })
    return blocks


def _decode_sensor_samples(data: list[int], sample_count: int, scale_factor: float) -> list[dict]:
    samples = []
    for index in range(sample_count):
        offset = 6 + index * 3
        if offset + 2 >= len(data):
            break
        raw_val = data[offset] | (data[offset + 1] << 8)
        samples.append({
            'index': index,
            'value': raw_val / scale_factor,
            'jitterUs': _to_signed8(data[offset + 2]),
        })
    return samples


def _decode_tire_history_blocks(data: list[int]) -> list[dict]:
    blocks = []
    for index in range(11):
        offset = 6 + index * 5
        if offset + 4 >= len(data):
            break
        blocks.append({
            'index': index,
            'max': data[offset],
            'min': data[offset + 1],
            'center': data[offset + 2],
            'ambient': data[offset + 3],
            'jitterMs': _to_signed8(data[offset + 4]),
        })
    return blocks


def _decode_flow_blocks(data: list[int]) -> list[dict]:
    blocks = []
    for index in range(6):
        offset = 6 + index * 9
        if offset + 8 >= len(data):
            break
        blocks.append({
            'index': index,
            'raw1': _get_u16_le(data, offset),
            'flow1': _get_u16_le(data, offset + 2) / 10.0,
            'raw2': _get_u16_le(data, offset + 4),
            'flow2': _get_u16_le(data, offset + 6) / 10.0,
            'jitter': _to_signed8(data[offset + 8]),
        })
    return blocks


def _decode_tshmu_temp_blocks(data: list[int]) -> list[dict]:
    blocks = []
    for index in range(4):
        offset = 6 + index * 13
        if offset + 12 >= len(data):
            break
        blocks.append({
            'index': index,
            'temp1': _to_signed16(_get_u16_le(data, offset)) / 10.0,
            'temp2': _to_signed16(_get_u16_le(data, offset + 2)) / 10.0,
            'temp3': _to_signed16(_get_u16_le(data, offset + 4)) / 10.0,
            'temp4': _to_signed16(_get_u16_le(data, offset + 6)) / 10.0,
            'temp5': _to_signed16(_get_u16_le(data, offset + 8)) / 10.0,
            'temp6': _to_signed16(_get_u16_le(data, offset + 10)) / 10.0,
            'jitterMs': _to_signed8(data[offset + 12]),
        })
    return blocks


def _decode_tspmu_pressure_blocks(data: list[int]) -> list[dict]:
    blocks = []
    for index in range(11):
        offset = 4 + index * 5
        if offset + 4 >= len(data):
            break
        blocks.append({
            'index': index,
            'pressure1': _to_signed16(_get_u16_le(data, offset)) / 100.0,
            'pressure2': _to_signed16(_get_u16_le(data, offset + 2)) / 100.0,
            'jitter': data[offset + 4],
        })
    return blocks


def _decode_tspmu_temp_blocks(data: list[int]) -> list[dict]:
    blocks = []
    for index in range(6):
        offset = 4 + index * 9
        if offset + 8 >= len(data):
            break
        blocks.append({
            'index': index,
            'temp1': _to_signed16(_get_u16_le(data, offset)) / 10.0,
            'temp2': _to_signed16(_get_u16_le(data, offset + 2)) / 10.0,
            'temp3': _to_signed16(_get_u16_le(data, offset + 4)) / 10.0,
            'temp4': _to_signed16(_get_u16_le(data, offset + 6)) / 10.0,
            'jitterMs': _to_signed8(data[offset + 8]),
        })
    return blocks


def _decode_imu_samples(data: list[int]) -> dict:
    def sample_at(offset: int) -> dict:
        return {
            'index': 0 if offset == 7 else 1,
            'accelX': _to_signed16(_get_u16_le(data, offset)),
            'accelY': _to_signed16(_get_u16_le(data, offset + 2)),
            'accelZ': _to_signed16(_get_u16_le(data, offset + 4)),
            'accelA': _to_signed16(_get_u16_le(data, offset + 6)),
            'accelB': _to_signed16(_get_u16_le(data, offset + 8)),
            'accelC': _to_signed16(_get_u16_le(data, offset + 10)),
            'veloX': _to_signed16(_get_u16_le(data, offset + 12)),
            'veloY': _to_signed16(_get_u16_le(data, offset + 14)),
            'veloZ': _to_signed16(_get_u16_le(data, offset + 16)),
            'veloA': _to_signed16(_get_u16_le(data, offset + 18)),
            'veloB': _to_signed16(_get_u16_le(data, offset + 20)),
            'veloC': _to_signed16(_get_u16_le(data, offset + 22)),
        }

    sample1 = sample_at(7)
    sample1['jitter'] = _get_u16_le(data, 31)
    sample2 = sample_at(33)

    return {
        'baseTimestamp': _get_u32_le(data, 0),
        'expectedPeriod': data[4],
        'errorFlags': _get_u16_le(data, 5),
        'samples': [sample1, sample2],
    }


def _decode_gps_timesync(data: list[int]) -> dict:
    return {
        'timestampUs': _get_u32_le(data, 0),
        'utcMsOfDay': _get_u32_le(data, 4),
        'utcDate': _get_u32_le(data, 8),
        'fixValid': data[12],
        'fixQuality': data[13],
        'satellites': data[14],
        'headingValid': data[15],
        'sentenceCount': _get_u32_le(data, 16),
        'rmcCount': _get_u32_le(data, 20),
        'ggaCount': _get_u32_le(data, 24),
        'pqtmtarCount': _get_u32_le(data, 28),
        'errorFlags': data[63],
    }


def _decode_gps_pos(data: list[int]) -> dict:
    return {
        'timestampUs': _get_u32_le(data, 0),
        'latDeg': _get_s32_le(data, 4) / 10000000.0,
        'lonDeg': _get_s32_le(data, 8) / 10000000.0,
        'altM': _get_s32_le(data, 12) / 1000.0,
        'hdop': _get_u16_le(data, 16) / 100.0,
        'fixValid': data[18],
        'fixQuality': data[19],
        'satellites': data[20],
        'errorFlags': data[63],
    }


def _decode_gps_nav(data: list[int]) -> dict:
    return {
        'timestampUs': _get_u32_le(data, 0),
        'velMps': _get_u32_le(data, 4) / 100.0,
        'courseDeg': _get_s32_le(data, 8) / 100.0,
        'headingDeg': _get_s32_le(data, 12) / 100.0,
        'headingAccDeg': _get_u16_le(data, 16) / 100.0,
        'headingValid': data[18],
        'headingQuality': data[19],
        'baselineM': _get_u32_le(data, 20) / 1000.0,
        'pitchDeg': _get_s32_le(data, 24) / 100.0,
        'errorFlags': data[63],
    }


def parse_can_payload_to_board(can_id: int, payload: Sequence[int] | bytes) -> Optional[dict]:
    data = list(payload)
    if len(data) < 64:
        return None

    identifier_hex = f"{can_id:03X}"
    board_type = (can_id >> 6) & 0x0F
    board_id = (can_id >> 3) & 0x07
    sensor_num = can_id & 0x07

    if can_id in (0x040, 0x041, 0x042):
        board = {
            'boardType': 7,
            'boardId': 0,
            'kind': 'fast',
            'identifier': can_id,
            'identifierHex': identifier_hex,
            'idText': f'0x{identifier_hex}',
            'timeSinceLastMs': 100,
            'errorFlags': data[63],
        }
        if can_id == 0x040:
            board['gpsTimesync'] = _decode_gps_timesync(data)
        elif can_id == 0x041:
            board['gpsPos'] = _decode_gps_pos(data)
        else:
            board['gpsNav'] = _decode_gps_nav(data)
        return board

    if board_type == 2 and board_id <= 3:
        err = data[4] | (data[5] << 8)
        base = {
            'boardType': board_type,
            'boardId': board_id,
            'identifier': can_id,
            'identifierHex': identifier_hex,
            'idText': f'0x{identifier_hex}',
            'errorFlags': err,
        }
        if sensor_num == 0:
            strain_blocks = _decode_strain_gauge_blocks(data)
            return {
                **base,
                'kind': 'fast',
                'timeSinceLastMs': 5,
                'strainGaugesMv': strain_blocks[0]['strainGaugesMv'] if strain_blocks else [],
                'strainBlocks': strain_blocks,
            }
        if sensor_num == 1:
            shock_samples = _decode_sensor_samples(data, 19, 100.0)
            return {
                **base,
                'kind': 'fast',
                'timeSinceLastMs': 5,
                'shockMm': shock_samples[0]['value'] if shock_samples else 0.0,
                'shockSamples': shock_samples,
            }
        if sensor_num == 2:
            brake_samples = _decode_sensor_samples(data, 19, 10.0)
            return {
                **base,
                'kind': 'slow',
                'timeSinceLastMs': 100,
                'brakeC': brake_samples[0]['value'] if brake_samples else 0.0,
                'brakeAmbientC': 25.0,
                'brakeSamples': brake_samples,
            }
        if sensor_num == 3:
            tire_blocks = _decode_tire_history_blocks(data)
            latest = tire_blocks[0] if tire_blocks else {'max': 0, 'min': 0, 'center': 0, 'ambient': 0}
            return {
                **base,
                'kind': 'slow',
                'timeSinceLastMs': 100,
                'tireC': {
                    'max': latest['max'],
                    'min': latest['min'],
                    'center': latest['center'],
                    'ambient': latest['ambient'],
                },
                'tireBlocks': tire_blocks,
            }
        if sensor_num == 4:
            wheel_samples = _decode_sensor_samples(data, 19, 10.0)
            return {
                **base,
                'kind': 'slow',
                'timeSinceLastMs': 100,
                'rpm': wheel_samples[0]['value'] if wheel_samples else 0.0,
                'wheelSamples': wheel_samples,
            }
        return None

    if board_type == 4:
        err = data[4] | (data[5] << 8)
        base = {
            'boardType': board_type,
            'boardId': board_id,
            'identifier': can_id,
            'identifierHex': identifier_hex,
            'idText': f'0x{identifier_hex}',
            'errorFlags': err,
        }
        if sensor_num == 2:
            flow_blocks = _decode_flow_blocks(data)
            latest = flow_blocks[0] if flow_blocks else {'raw1': 0, 'flow1': 0.0, 'raw2': 0, 'flow2': 0.0, 'jitter': 0}
            return {
                **base,
                'kind': 'slow',
                'timeSinceLastMs': 600,
                'raw1': latest['raw1'],
                'flow1': latest['flow1'],
                'raw2': latest['raw2'],
                'flow2': latest['flow2'],
                'jitter': latest['jitter'],
                'flowBlocks': flow_blocks,
            }
        if sensor_num == 3:
            temp_blocks = _decode_tshmu_temp_blocks(data)
            latest = temp_blocks[0] if temp_blocks else {}
            return {
                **base,
                'kind': 'fast',
                'timeSinceLastMs': 600,
                'temp1': latest.get('temp1', 0.0),
                'temp2': latest.get('temp2', 0.0),
                'temp3': latest.get('temp3', 0.0),
                'temp4': latest.get('temp4', 0.0),
                'temp5': latest.get('temp5', 0.0),
                'temp6': latest.get('temp6', 0.0),
                'jitterMs': latest.get('jitterMs', 0),
                'tempBlocks': temp_blocks,
            }
        return None

    if board_type == 6:
        err = data[62] | (data[63] << 8)
        base = {
            'boardType': board_type,
            'boardId': board_id,
            'identifier': can_id,
            'identifierHex': identifier_hex,
            'idText': f'0x{identifier_hex}',
            'errorFlags': err,
        }
        if sensor_num == 0:
            pressure_blocks = _decode_tspmu_pressure_blocks(data)
            latest = pressure_blocks[0] if pressure_blocks else {'pressure1': 0.0, 'pressure2': 0.0, 'jitter': 0}
            return {
                **base,
                'kind': 'fast',
                'timeSinceLastMs': 45,
                'pressure1': latest['pressure1'],
                'pressure2': latest['pressure2'],
                'jitter': latest['jitter'],
                'pressureBlocks': pressure_blocks,
            }
        if sensor_num == 1:
            temp_blocks = _decode_tspmu_temp_blocks(data)
            latest = temp_blocks[0] if temp_blocks else {'temp1': 0.0, 'temp2': 0.0, 'temp3': 0.0, 'temp4': 0.0, 'jitterMs': 0}
            return {
                **base,
                'kind': 'slow',
                'timeSinceLastMs': 1333,
                'tspmuTemp1': latest['temp1'],
                'tspmuTemp2': latest['temp2'],
                'tspmuTemp3': latest['temp3'],
                'tspmuTemp4': latest['temp4'],
                'jitterMs': latest['jitterMs'],
                'tempBlocks': temp_blocks,
            }
        return None

    if board_type == 1:
        base = {
            'boardType': board_type,
            'boardId': board_id,
            'identifier': can_id,
            'identifierHex': identifier_hex,
            'idText': f'0x{identifier_hex}',
        }
        if sensor_num == 0:
            gps_timesync = _decode_gps_timesync(data)
            return {**base, 'kind': 'slow', 'timeSinceLastMs': 100, 'errorFlags': gps_timesync['errorFlags'], 'gpsTimesync': gps_timesync}
        if sensor_num == 1:
            gps_pos = _decode_gps_pos(data)
            return {**base, 'kind': 'slow', 'timeSinceLastMs': 50, 'errorFlags': gps_pos['errorFlags'], 'gpsPos': gps_pos}
        if sensor_num == 2:
            gps_nav = _decode_gps_nav(data)
            return {**base, 'kind': 'slow', 'timeSinceLastMs': 50, 'errorFlags': gps_nav['errorFlags'], 'gpsNav': gps_nav}
        if sensor_num == 3:
            imu_data = _decode_imu_samples(data)
            latest = imu_data['samples'][1]
            return {
                **base,
                'kind': 'fast',
                'timeSinceLastMs': 50,
                'errorFlags': imu_data['errorFlags'],
                'baseTimestamp': imu_data['baseTimestamp'],
                'expectedPeriod': imu_data['expectedPeriod'],
                'samples': imu_data['samples'],
                'accelX': latest['accelX'],
                'accelY': latest['accelY'],
                'accelZ': latest['accelZ'],
                'accelA': latest['accelA'],
                'accelB': latest['accelB'],
                'accelC': latest['accelC'],
                'veloX': latest['veloX'],
                'veloY': latest['veloY'],
                'veloZ': latest['veloZ'],
                'veloA': latest['veloA'],
                'veloB': latest['veloB'],
                'veloC': latest['veloC'],
                'jitter': imu_data['samples'][0]['jitter'],
            }
        return None

    return None