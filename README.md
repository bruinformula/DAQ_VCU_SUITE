# DAQ_VCU_SUITE

Telemetry link and desktop dashboard for the Bruin Formula DAQ/VCU workflow.

This repo contains:
- the Pi/backend telemetry service
- the React + Electron desktop app
- offline CSV log review tools

## Desktop App Builds

The desktop app lives in [frontend](/Users/oreoturkey/Documents/telemetry_project/DAQ_VCU_SUITE/frontend).

I will keep building the packaged app for current changes when we work on this repo. The instructions below are for other teammates who pull the repo and want to build the app on their own machine.

### Prerequisites

- Node.js 20+ recommended
- `npm`
- Platform-native build machine
  - build macOS `.dmg` on a Mac
  - build Windows `.exe` on Windows

Install dependencies:

```bash
cd frontend
npm install
```

## Run The App Locally

For normal Electron development:

```bash
cd frontend
npm run electron:dev
```

That starts the Vite frontend and launches the desktop app together.

## Build On macOS

Build a macOS DMG:

```bash
cd frontend
npm run electron:build:mac
```

Output:

- `frontend/dist-electron/Bruin Formula Racing Telemetry-0.0.0-arm64.dmg`

There is also a generic build command:

```bash
cd frontend
npm run electron:build
```

On a Mac, that will produce the macOS package using the Electron Builder config in `frontend/package.json`.

## Build On Windows

Build a Windows installer:

```bash
cd frontend
npm install
npm run electron:build:win
```

Expected output:

- `frontend/dist-electron/*.exe`

The Windows target is configured as `nsis`, so the packaged output is an installer-style `.exe`.

## Important Notes

- Use a native machine for the target OS whenever possible.
- macOS signing/notarization is not required for local team builds, but unsigned local builds may show standard macOS warnings.
- If native Electron dependencies rebuild during packaging, that is expected.
- The backend on the Raspberry Pi is separate from the desktop packaging workflow.

## Backend Reminder

If backend changes are made and the Pi needs the latest parser/service code:

```bash
cd ~/DAQ_VCU_SUITE
git pull
sudo systemctl restart telemetry-hub.service
```
