"""
Centralized configuration for the Pit Sync Telemetry Hub backend.
"""

from __future__ import annotations

import argparse
import platform
from dataclasses import dataclass


@dataclass
class Config:
    """Runtime configuration for the telemetry backend."""

    # Serial (MDU USB CDC)
    serial_port: str = '/dev/ttyUSB0'
    serial_baud: int = 115200  # USB CDC doesn't actually use baud, but pyserial requires it

    # CAN interface (for direct socketcan, not used when reading from MDU)
    can_interface: str = 'can0'

    # WebSocket / HTTP
    host: str = '0.0.0.0'
    port: int = 8000

    # Logging
    log_dir: str = './logs'
    buffer_seconds: int = 30
    buffer_hz: int = 50       # 50Hz = 20ms per sample

    # Mock mode (for laptop testing without hardware)
    mock: bool = False

    # Number of SDU boards on the car
    sdu_board_count: int = 4

    @property
    def buffer_maxlen(self) -> int:
        """Maximum number of samples in the rolling RAM buffer."""
        return self.buffer_seconds * self.buffer_hz

    @classmethod
    def from_args(cls) -> 'Config':
        """Parse configuration from command-line arguments."""
        parser = argparse.ArgumentParser(description='FENRIR Pit Sync Telemetry Hub')

        parser.add_argument('--serial-port', default=cls.serial_port,
                            help=f'MDU USB serial port (default: {cls.serial_port})')
        parser.add_argument('--serial-baud', type=int, default=cls.serial_baud,
                            help=f'Serial baud rate (default: {cls.serial_baud})')
        parser.add_argument('--can-interface', default=cls.can_interface,
                            help=f'SocketCAN interface (default: {cls.can_interface})')
        parser.add_argument('--host', default=cls.host,
                            help=f'Listen host (default: {cls.host})')
        parser.add_argument('--port', type=int, default=cls.port,
                            help=f'Listen port (default: {cls.port})')
        parser.add_argument('--log-dir', default=cls.log_dir,
                            help=f'Log output directory (default: {cls.log_dir})')
        parser.add_argument('--mock', action='store_true',
                            help='Run with simulated data (no hardware required)')
        parser.add_argument('--sdu-boards', type=int, default=cls.sdu_board_count,
                            help=f'Number of SDU boards (default: {cls.sdu_board_count})')

        args = parser.parse_args()

        return cls(
            serial_port=args.serial_port,
            serial_baud=args.serial_baud,
            can_interface=args.can_interface,
            host=args.host,
            port=args.port,
            log_dir=args.log_dir,
            mock=args.mock,
            sdu_board_count=args.sdu_boards,
        )

    @classmethod
    def auto_detect_serial(cls) -> str:
        """Auto-detect the MDU serial port based on platform."""
        system = platform.system()
        if system == 'Linux':
            # Raspberry Pi / Linux
            import glob
            candidates = glob.glob('/dev/ttyACM*') + glob.glob('/dev/ttyUSB*')
            return candidates[0] if candidates else '/dev/ttyUSB0'
        elif system == 'Darwin':
            # macOS
            import glob
            candidates = glob.glob('/dev/tty.usbmodem*') + glob.glob('/dev/cu.usbmodem*')
            return candidates[0] if candidates else '/dev/tty.usbmodem0'
        else:
            # Windows
            return 'COM3'
