const { app, BrowserWindow, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let overlayWindow = null;
let relayProc = null;
let clickThrough = true;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, attempts, delayMs) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return true;
      }
    } catch (_) {
      // ignore and retry
    }
    await wait(delayMs);
  }
  return false;
}

function startRelayIfNeeded() {
  const shouldStartRelay = String(process.env.MPP_HUD_START_RELAY || 'true').toLowerCase() !== 'false';
  if (!shouldStartRelay) {
    return;
  }

  const useTsx = String(process.env.MPP_HUD_RELAY_USE_TSX || '').toLowerCase() === 'true';
  const relayEntry = path.join(__dirname, '..', 'dist', 'relay', 'index.js');
  const projectRoot = path.join(__dirname, '..');
  const relayEnv = {
    ...process.env,
    MPP_AUTO_OPEN_DASHBOARD: 'false',
  };

  if (!useTsx && fs.existsSync(relayEntry)) {
    relayProc = spawn(process.execPath, [relayEntry], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: relayEnv,
    });
  } else {
    // Dev-friendly fallback when dist relay entry is missing or ESM import resolution differs.
    relayProc = spawn('npx', ['tsx', 'src/relay/index.ts'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: relayEnv,
      shell: process.platform === 'win32',
    });
  }

  relayProc.on('exit', (code) => {
    console.warn('[HUD] relay process exited with code', code);
    relayProc = null;
  });
}

function buildHudUrl() {
  const base = process.env.MPP_HUD_BASE_URL || 'http://127.0.0.1:4100';
  const joinCode = process.env.MPP_HUD_JOIN_CODE;
  const sessionId = process.env.MPP_HUD_SESSION_ID || 'DEMO';
  const preset = process.env.MPP_HUD_PRESET || 'driver_hud';

  if (joinCode) {
    return `${base}/hud/join/${encodeURIComponent(joinCode)}?preset=${encodeURIComponent(preset)}&surface=native`;
  }
  return `${base}/hud/${encodeURIComponent(sessionId)}?preset=${encodeURIComponent(preset)}&surface=native`;
}

function applyClickThroughMode(enabled) {
  clickThrough = enabled;
  if (!overlayWindow) return;
  overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 560,
    height: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      backgroundThrottling: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  applyClickThroughMode(true);
  overlayWindow.loadURL(buildHudUrl());

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

async function bootstrap() {
  startRelayIfNeeded();
  const healthUrl = `${process.env.MPP_HUD_BASE_URL || 'http://127.0.0.1:4100'}/healthz`;
  await waitForHealth(healthUrl, 40, 250);
  createOverlayWindow();

  globalShortcut.register('CommandOrControl+Shift+F10', () => {
    applyClickThroughMode(!clickThrough);
    console.log('[HUD] click-through:', clickThrough ? 'on' : 'off');
  });

  globalShortcut.register('CommandOrControl+Shift+F11', () => {
    if (!overlayWindow) return;
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.showInactive();
    }
  });
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (relayProc) {
    relayProc.kill('SIGTERM');
    relayProc = null;
  }
});
