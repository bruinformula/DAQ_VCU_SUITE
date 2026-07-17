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

There are two ways to run the app locally from the `frontend` directory:

### Option A: Standard Run (Recommended for general use)
Builds the static assets once and launches the Electron application.
```bash
cd frontend
npm start
```

### Option B: Active Development (Recommended when editing code)
Starts the Vite dev server with Hot Module Replacement (HMR) and opens Electron. Any changes you make to the UI code will instantly reload in the window.
```bash
cd frontend
npm run electron:dev
```

## Build On macOS

Build a macOS DMG:

```bash
cd frontend
npm run electron:build:mac
```

Output:

- `frontend/dist/MDU Debug GUI-0.1.0-arm64.dmg` (or similar)

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

- `frontend/dist/*.exe` (e.g., `frontend/dist/MDU Debug GUI Setup 0.1.0.exe`)

The Windows target is configured as `nsis`, so the packaged output is an installer-style `.exe`.

## Important Notes

- Use a native machine for the target OS whenever possible.
- macOS signing/notarization is not required for local team builds, but unsigned local builds may show standard macOS warnings.
- If native Electron dependencies rebuild during packaging, that is expected.
- The backend on the Raspberry Pi is separate from the desktop packaging workflow.

## Backend Reminder & Raspberry Pi Connection

The backend telemetry service runs directly on the Raspberry Pi installed in the car. 

### 1. Connect to the Pi's Wi-Fi Network
### 2. SSH into the Pi
### 3. Transferring Files (SFTP/SCP)
### 4. Apply Changes & Restart Service
After pulling changes from Git or uploading them via SFTP, restart the background Python service on the Pi so it loads the new code:
```bash
# In the Pi's SSH terminal:
cd ~/DAQ_VCU_SUITE
git pull # (if using the Git workflow)

# Restart the service:
sudo systemctl restart telemetry-hub.service
```
