# MDU Debug GUI

Electron app for the USB CDC stream emitted by the STM32 firmware in this repository.

## What it does

- Auto-detects the STM32 Virtual ComPort device (`VID:PID = 0483:5740`)
- Treats the USB2514 side as a USB hub and mirrors the STM32's USB CDC child endpoint, not Bluetooth pseudo ports
- Reads the USB CDC stream from the MCU's native USB connection
- On macOS, also scans System Information so the app can show when the USB2514 hub itself is present even if no CDC child endpoint has enumerated yet
- Decodes the per-board SDU telemetry the MDU prints to USB:
  - Fast frames `[B<board> ID <hex> Fast] dT:<ms>ms | SG[mV]: ... | Shock: ... mm` for CAN IDs `0x080 + 8*boardId` (SG) and `0x081 + 8*boardId` (Shock)
  - Slow frames `[B<board> ID <hex> Slow] dT:<ms>ms | RPM: ... | Tire[...] Brk:... Amb:...` for CAN IDs `0x082 + 8*boardId` (Brake), `0x083 + 8*boardId` (Tire), and `0x084 + 8*boardId` (Wheel Speed)
- Falls back to the firmware's SLCAN-style frames (`t...` / `T...` terminated by `\r`) for everything else
- Shows live diagnostics such as bytes/sec, frames/sec, parse errors, per-board readings, active CAN IDs, and last activity
- Keeps a rolling on-screen log of raw USB lines and decoded frames
- Writes structured session logs to JSONL files for later analysis

## Important protocol details

The MDU prints SDU board lines with ANSI cursor positioning (`\033[<line>;1H\033[K...`) so terminals can pin each board to its own row. The GUI strips those escapes before parsing and stores ANSI-free strings in the log.

The SLCAN fallback is close to SLCAN but not strict — the firmware emits the CAN length field as decimal with `%u`, so lengths above 9 appear as two digits, e.g.:

```text
t077120102030405060708090A0B0C\r
```

The parser handles both 1-digit and 2-digit decimal lengths.

## Transport note

The MCU is still accessed through the host's USB CDC device node even when it is plugged through the USB2514 hub. This app therefore mirrors the STM32 CDC endpoint exposed by macOS and filters out non-USB entries such as Bluetooth pseudo ports.

If System Information shows only the USB2514 hub and no STM32 child device, the app now reports that state explicitly. In that condition there is no mirrorable USB CDC endpoint yet, so live traffic capture cannot start until the MCU enumerates a child interface that macOS exposes.

## Usage

```bash
npm install
npm start
```

## Package A macOS App

```bash
npm install
npm run dist
```

Build artifacts are written to the `dist/` folder. The package script currently creates unsigned macOS `dmg` and `zip` outputs for local use.

## Log format

Logging writes newline-delimited JSON (`.jsonl`). Each line is either:

- `session_start` / `session_end`
- `runtime` for connect/disconnect/errors
- `frame` for each received USB line, including the raw string and parsed frame fields when decoding succeeds
