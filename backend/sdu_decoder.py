"""
SDU Frame Decoder — Decodes the 64-byte FDCAN frames from SDU (Sensor Distribution Unit) boards.

The SDU boards use a packed 11-bit CAN ID scheme:
    Bits [10:6] = Board Type  (2 = SDU, 6 = TSPMU)
    Bits [5:3]  = Board Index (0-3 → FL, FR, RL, RR)
    Bits [2:0]  = Sensor Num  (0=StrainGauge, 1=ShockPot, 2=BrakeTemp, 3=TireTemp, 4=WheelSpeed)

Each 64-byte frame contains multiple time-stamped samples packed together.
This decoder is a Python port of mdu-frame.js from the mk11-mdu-code debug GUI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# Board type constants
BOARD_TYPE_SDU = 2
BOARD_TYPE_TSPMU = 6

# Sensor type constants
SENSOR_STRAIN_GAUGE = 0
SENSOR_SHOCK_POT = 1
SENSOR_BRAKE_TEMP = 2
SENSOR_TIRE_TEMP = 3
SENSOR_WHEEL_SPEED = 4

# TSPMU sensor types
TSPMU_PRESSURE = 0
TSPMU_TEMPERATURE = 1

# Board position names
BOARD_POSITIONS = {0: 'FL', 1: 'FR', 2: 'RL', 3: 'RR'}

MIN_SDU_PAYLOAD_LENGTHS = {
    (BOARD_TYPE_SDU, SENSOR_STRAIN_GAUGE): 16,
    (BOARD_TYPE_SDU, SENSOR_SHOCK_POT): 9,
    (BOARD_TYPE_SDU, SENSOR_BRAKE_TEMP): 9,
    (BOARD_TYPE_SDU, SENSOR_TIRE_TEMP): 11,
    (BOARD_TYPE_SDU, SENSOR_WHEEL_SPEED): 9,
    (BOARD_TYPE_TSPMU, TSPMU_PRESSURE): 9,
    (BOARD_TYPE_TSPMU, TSPMU_TEMPERATURE): 13,
}


@dataclass
class SduFrameInfo:
    """Parsed metadata from an SDU CAN ID."""
    board_type: int       # 2 = SDU, 6 = TSPMU
    board_index: int      # 0-3
    sensor_num: int       # 0-4 for SDU, 0-1 for TSPMU
    position: str         # 'FL', 'FR', 'RL', 'RR'


@dataclass
class StrainGaugeBlock:
    """A single strain gauge sample block (6 channels)."""
    index: int
    channels_mv: list[int]   # 6 channels in millivolts
    jitter_us: int


@dataclass
class SensorSample:
    """A single time-stamped sensor sample."""
    index: int
    value: float
    jitter_us: int


@dataclass
class TireTempBlock:
    """A single tire temperature history block."""
    index: int
    max_c: int
    min_c: int
    center_c: int
    ambient_c: int
    jitter_ms: int


@dataclass
class TspmuPressureBlock:
    """A single TSPMU pressure block."""
    index: int
    pressure1: float
    pressure2: float
    jitter: int


@dataclass
class TspmuTempBlock:
    """A single TSPMU temperature block."""
    index: int
    temp1: float
    temp2: float
    temp3: float
    temp4: float
    jitter_ms: int


@dataclass
class SduDecodedFrame:
    """Complete decoded SDU frame."""
    board_type: int
    board_index: int
    position: str
    sensor_type: str       # Human-readable: 'strain_gauge', 'shock_pot', etc.
    error_flags: int

    # SDU sensor data (only one of these will be populated)
    strain_blocks: list[StrainGaugeBlock] = field(default_factory=list)
    shock_samples: list[SensorSample] = field(default_factory=list)
    brake_samples: list[SensorSample] = field(default_factory=list)
    tire_blocks: list[TireTempBlock] = field(default_factory=list)
    wheel_samples: list[SensorSample] = field(default_factory=list)

    # TSPMU data
    pressure_blocks: list[TspmuPressureBlock] = field(default_factory=list)
    temp_blocks: list[TspmuTempBlock] = field(default_factory=list)

    # Convenience: latest single value for each sensor type
    latest: dict = field(default_factory=dict)


def _to_signed8(value: int) -> int:
    return value - 256 if value > 127 else value


def _to_signed16(value: int) -> int:
    return value - 65536 if value > 32767 else value


def parse_sdu_id(can_id: int) -> Optional[SduFrameInfo]:
    """
    Extract board type, index, and sensor number from an 11-bit CAN ID.
    Returns None if the ID doesn't match the SDU/TSPMU scheme.
    """
    board_type = (can_id >> 6) & 0x1F
    board_index = (can_id >> 3) & 0x07
    sensor_num = can_id & 0x07

    if board_type not in (BOARD_TYPE_SDU, BOARD_TYPE_TSPMU):
        return None
    if board_index > 3:
        return None
    if (board_type, sensor_num) not in MIN_SDU_PAYLOAD_LENGTHS:
        return None

    return SduFrameInfo(
        board_type=board_type,
        board_index=board_index,
        sensor_num=sensor_num,
        position=BOARD_POSITIONS.get(board_index, f'B{board_index}'),
    )


def minimum_sdu_payload_length(info: SduFrameInfo) -> int:
    """Return the shortest payload that can hold one valid sample block."""
    return MIN_SDU_PAYLOAD_LENGTHS[(info.board_type, info.sensor_num)]


def _decode_strain_gauge_blocks(data: list[int]) -> list[StrainGaugeBlock]:
    """Decode up to 5 strain gauge sample blocks from a 64-byte frame."""
    blocks = []
    for i in range(5):
        offset = 6 + i * 10
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

        raw_vals = [
            (ch1_upper << 4) | (ch1_ch2_lower >> 4),
            (ch2_upper << 4) | (ch1_ch2_lower & 0x0F),
            (ch3_upper << 4) | (ch3_ch4_lower >> 4),
            (ch4_upper << 4) | (ch3_ch4_lower & 0x0F),
            (ch5_upper << 4) | (ch5_ch6_lower >> 4),
            (ch6_upper << 4) | (ch5_ch6_lower & 0x0F),
        ]

        channels_mv = [round((v / 4095.0) * 6600.0 - 3300.0) for v in raw_vals]

        blocks.append(StrainGaugeBlock(index=i, channels_mv=channels_mv, jitter_us=jitter_us))

    return blocks


def _decode_sensor_samples(data: list[int], sample_count: int, scale_factor: float) -> list[SensorSample]:
    """Decode time-stamped sensor samples (shock pot, brake temp, wheel speed)."""
    samples = []
    for i in range(sample_count):
        offset = 6 + i * 3
        if offset + 2 >= len(data):
            break

        raw_val = data[offset] | (data[offset + 1] << 8)
        value = raw_val / scale_factor
        jitter_us = _to_signed8(data[offset + 2])

        samples.append(SensorSample(index=i, value=value, jitter_us=jitter_us))

    return samples


def _decode_tire_temp_blocks(data: list[int]) -> list[TireTempBlock]:
    """Decode tire temperature history blocks."""
    blocks = []
    for i in range(11):
        offset = 6 + i * 5
        if offset + 4 >= len(data):
            break

        blocks.append(TireTempBlock(
            index=i,
            max_c=data[offset],
            min_c=data[offset + 1],
            center_c=data[offset + 2],
            ambient_c=data[offset + 3],
            jitter_ms=_to_signed8(data[offset + 4]),
        ))

    return blocks


def _decode_tspmu_pressure_blocks(data: list[int]) -> list[TspmuPressureBlock]:
    """Decode TSPMU pressure blocks."""
    blocks = []
    for i in range(11):
        offset = 4 + i * 5
        if offset + 4 >= len(data):
            break

        raw_p1 = data[offset] | (data[offset + 1] << 8)
        raw_p2 = data[offset + 2] | (data[offset + 3] << 8)
        pressure1 = _to_signed16(raw_p1) / 100.0
        pressure2 = _to_signed16(raw_p2) / 100.0
        jitter = data[offset + 4]

        blocks.append(TspmuPressureBlock(index=i, pressure1=pressure1, pressure2=pressure2, jitter=jitter))

    return blocks


def _decode_tspmu_temp_blocks(data: list[int]) -> list[TspmuTempBlock]:
    """Decode TSPMU temperature blocks."""
    blocks = []
    for i in range(6):
        offset = 4 + i * 9
        if offset + 8 >= len(data):
            break

        raw_t1 = data[offset] | (data[offset + 1] << 8)
        raw_t2 = data[offset + 2] | (data[offset + 3] << 8)
        raw_t3 = data[offset + 4] | (data[offset + 5] << 8)
        raw_t4 = data[offset + 6] | (data[offset + 7] << 8)
        jitter_ms = _to_signed8(data[offset + 8])

        blocks.append(TspmuTempBlock(
            index=i,
            temp1=_to_signed16(raw_t1) / 10.0,
            temp2=_to_signed16(raw_t2) / 10.0,
            temp3=_to_signed16(raw_t3) / 10.0,
            temp4=_to_signed16(raw_t4) / 10.0,
            jitter_ms=jitter_ms,
        ))

    return blocks


def decode_sdu_frame(can_id: int, data: list[int]) -> Optional[SduDecodedFrame]:
    """
    Decode a 64-byte SDU/TSPMU frame.

    Args:
        can_id: The 11-bit CAN identifier (from SLCAN 't' frame).
        data: The 64-byte payload as a list of ints.

    Returns:
        SduDecodedFrame on success, None if the CAN ID doesn't match SDU/TSPMU.
    """
    info = parse_sdu_id(can_id)
    if info is None:
        return None

    if len(data) < minimum_sdu_payload_length(info):
        return None

    # Some bridges forward shortened FD payloads with trailing zero bytes
    # omitted. Pad locally so board-index 3 frames like 0x098-0x09C still
    # decode through the normal fixed-layout parser.
    if len(data) < 64:
        data = data + ([0] * (64 - len(data)))

    frame = SduDecodedFrame(
        board_type=info.board_type,
        board_index=info.board_index,
        position=info.position,
        sensor_type='',
        error_flags=0,
    )

    if info.board_type == BOARD_TYPE_SDU:
        frame.error_flags = data[4] | (data[5] << 8)

        if info.sensor_num == SENSOR_STRAIN_GAUGE:
            frame.sensor_type = 'strain_gauge'
            frame.strain_blocks = _decode_strain_gauge_blocks(data)
            if frame.strain_blocks:
                frame.latest = {'channels_mv': frame.strain_blocks[-1].channels_mv}

        elif info.sensor_num == SENSOR_SHOCK_POT:
            frame.sensor_type = 'shock_pot'
            frame.shock_samples = _decode_sensor_samples(data, 19, 100.0)
            if frame.shock_samples:
                frame.latest = {'shock_mm': frame.shock_samples[-1].value}

        elif info.sensor_num == SENSOR_BRAKE_TEMP:
            frame.sensor_type = 'brake_temp'
            frame.brake_samples = _decode_sensor_samples(data, 19, 10.0)
            if frame.brake_samples:
                frame.latest = {'brake_c': frame.brake_samples[-1].value}

        elif info.sensor_num == SENSOR_TIRE_TEMP:
            frame.sensor_type = 'tire_temp'
            frame.tire_blocks = _decode_tire_temp_blocks(data)
            if frame.tire_blocks:
                b = frame.tire_blocks[-1]
                frame.latest = {
                    'max_c': b.max_c, 'min_c': b.min_c,
                    'center_c': b.center_c, 'ambient_c': b.ambient_c,
                }

        elif info.sensor_num == SENSOR_WHEEL_SPEED:
            frame.sensor_type = 'wheel_speed'
            frame.wheel_samples = _decode_sensor_samples(data, 19, 10.0)
            if frame.wheel_samples:
                frame.latest = {'wheel_rpm': frame.wheel_samples[-1].value}

    elif info.board_type == BOARD_TYPE_TSPMU:
        frame.error_flags = data[62] | (data[63] << 8)

        if info.sensor_num == TSPMU_PRESSURE:
            frame.sensor_type = 'tspmu_pressure'
            frame.pressure_blocks = _decode_tspmu_pressure_blocks(data)
            if frame.pressure_blocks:
                b = frame.pressure_blocks[-1]
                frame.latest = {'pressure1': b.pressure1, 'pressure2': b.pressure2}

        elif info.sensor_num == TSPMU_TEMPERATURE:
            frame.sensor_type = 'tspmu_temperature'
            frame.temp_blocks = _decode_tspmu_temp_blocks(data)
            if frame.temp_blocks:
                b = frame.temp_blocks[-1]
                frame.latest = {'temp1': b.temp1, 'temp2': b.temp2, 'temp3': b.temp3, 'temp4': b.temp4}

    return frame
