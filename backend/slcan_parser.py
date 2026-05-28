"""
SLCAN Frame Parser — Pure Python
Parses the text-based SLCAN protocol used by the MDU's USB CDC output.

Each line from the MDU looks like:
    t4F380011223344556677\r
    T1806E7F4800112233445566778899\r

Where:
    t = Standard 11-bit CAN ID (3 hex chars)
    T = Extended 29-bit CAN ID (8 hex chars)
    Next 1-2 digits = data length in bytes
    Remaining = hex-encoded payload
    \r = frame delimiter
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# ANSI escape code stripper (the MDU may inject cursor-positioning sequences)
_ANSI_RE = re.compile(r'\x1B\[[0-9;?]*[ -/]*[@-~]')
_CTRL_RE = re.compile(r'[\x00\x07\x08\x0B\x0C\x0E-\x1F]')


@dataclass(slots=True)
class SlcanFrame:
    """A successfully parsed SLCAN frame."""
    raw: str
    frame_type: str          # 't' or 'T'
    id_type: str             # 'standard' or 'extended'
    identifier: int          # Numeric CAN ID
    identifier_hex: str      # Zero-padded hex string (3 or 8 chars)
    data_length: int         # Number of payload bytes
    data_hex: str            # Uppercase hex string of payload
    data_bytes: list[int] = field(default_factory=list)  # Decoded byte values


@dataclass(slots=True)
class SlcanError:
    """A failed parse attempt."""
    raw: str
    reason: str


def strip_ansi(text: str) -> str:
    """Remove ANSI escape codes and control characters."""
    text = _ANSI_RE.sub('', text)
    text = _CTRL_RE.sub('', text)
    return text


def normalize_line(raw_line: str) -> str:
    """Clean and trim a raw USB serial line."""
    return strip_ansi(raw_line).replace('\x00', '').strip()


def _try_parse_length_payload(remainder: str) -> Optional[tuple[int, str]]:
    """
    Try to extract data length and hex payload from the remainder of an SLCAN line.
    The length field can be 1 or 2 digits (for FDCAN payloads > 8 bytes).
    Returns (data_length, data_hex_uppercase) or None on failure.
    """
    for digits in (2, 1):
        if len(remainder) < digits:
            continue

        length_text = remainder[:digits]
        if not length_text.isdigit():
            continue

        data_length = int(length_text)
        if data_length > 64:
            continue

        data_hex = remainder[digits:]
        if len(data_hex) != data_length * 2:
            continue

        # Validate hex characters
        try:
            int(data_hex, 16) if data_hex else 0
        except ValueError:
            return None

        return data_length, data_hex.upper()

    return None


def parse_slcan_frame(raw_line: str) -> SlcanFrame | SlcanError:
    """
    Parse a single SLCAN-formatted line into a structured frame.

    Args:
        raw_line: Raw text line from USB serial (may contain ANSI codes, nulls, etc.)

    Returns:
        SlcanFrame on success, SlcanError on failure.
    """
    line = normalize_line(raw_line)
    if not line:
        return SlcanError(raw=line, reason='empty-line')

    frame_type = line[0]

    if frame_type == 't':
        id_length = 3
    elif frame_type == 'T':
        id_length = 8
    else:
        return SlcanError(raw=line, reason='unsupported-frame-type')

    # Minimum: type char + ID chars + at least 1 length digit
    if len(line) < 1 + id_length + 1:
        return SlcanError(raw=line, reason='frame-too-short')

    id_hex = line[1:1 + id_length].upper()

    # Validate identifier hex
    try:
        identifier = int(id_hex, 16)
    except ValueError:
        return SlcanError(raw=line, reason='invalid-identifier')

    # Parse length + payload
    remainder = line[1 + id_length:]
    result = _try_parse_length_payload(remainder)
    if result is None:
        return SlcanError(raw=line, reason='length-payload-mismatch')

    data_length, data_hex = result

    # Convert hex string to byte array
    data_bytes = [int(data_hex[i:i+2], 16) for i in range(0, len(data_hex), 2)]

    return SlcanFrame(
        raw=line,
        frame_type=frame_type,
        id_type='standard' if frame_type == 't' else 'extended',
        identifier=identifier,
        identifier_hex=id_hex,
        data_length=data_length,
        data_hex=data_hex,
        data_bytes=data_bytes,
    )


def parse_slcan_batch(batch_text: str) -> list[SlcanFrame | SlcanError]:
    """
    Parse a batch of SLCAN frames separated by \\r or \\n.
    The MDU sends multiple frames in a single USB transfer, delimited by \\r.
    """
    results = []
    # Split on \r, \n, or \r\n
    for line in re.split(r'[\r\n]+', batch_text):
        line = line.strip()
        if not line:
            continue
        results.append(parse_slcan_frame(line))
    return results
