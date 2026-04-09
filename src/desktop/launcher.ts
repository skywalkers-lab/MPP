import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { DriverAgentRuntime } from '../agent/DriverAgentRuntime';
import {
  buildViewerRoomsUrl,
  DesktopConfig,
  sanitizeDesktopConfig,
  validateDesktopConfig,
} from './config';

const VERSION = '0.1.18';
const PANEL_HOST = '127.0.0.1';

type LauncherFlags = {
  forceSetup: boolean;
  forceEngineer: boolean;
  forceDriver: boolean;
  noBrowser: boolean;
};

const runtimeDefaults = sanitizeDesktopConfig({
  viewerBaseUrl: process.env.MPP_VIEWER_URL || process.env.RELAY_PUBLIC_URL || '',
  relayWsUrl: process.env.MPP_RELAY_WS_URL || process.env.RELAY_PUBLIC_WS_URL || '',
  launchMode: 'manual',
  autoLaunch: false,
  udpPort: process.env.F1_UDP_PORT ? Number.parseInt(process.env.F1_UDP_PORT, 10) : 20777,
  udpAddr: process.env.F1_UDP_ADDR || '0.0.0.0',
});

let currentConfig = loadConfig();
let driverRuntime: DriverAgentRuntime | null = null;
let controlPanelUrl = '';

function parseFlags(argv: string[]): LauncherFlags {
  const args = new Set(argv);
  return {
    forceSetup: args.has('--setup'),
    forceEngineer: args.has('--engineer'),
    forceDriver: args.has('--driver'),
    noBrowser: args.has('--no-browser'),
  };
}

function resolveConfigPath(): string {
  const appDataDir = process.env.APPDATA || process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(appDataDir, 'MPP', 'desktop-config.json');
}

function ensureConfigDir(): void {
  fs.mkdirSync(path.dirname(resolveConfigPath()), { recursive: true });
}

function loadConfig(): DesktopConfig {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    return runtimeDefaults;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return sanitizeDesktopConfig(JSON.parse(raw) as Partial<DesktopConfig>, runtimeDefaults);
  } catch {
    return runtimeDefaults;
  }
}

function saveConfig(nextConfig: DesktopConfig): DesktopConfig {
  const sanitized = sanitizeDesktopConfig(nextConfig, runtimeDefaults);
  ensureConfigDir();
  fs.writeFileSync(resolveConfigPath(), `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
  currentConfig = sanitized;
  return sanitized;
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return;
    }

    if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }

    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // Ignore browser open failures. The panel still prints the URL.
  }
}

function startDriverRuntime(config: DesktopConfig): DriverAgentRuntime {
  const runtime = new DriverAgentRuntime({
    relayUrl: config.relayWsUrl,
    udpPort: config.udpPort,
    udpAddr: config.udpAddr,
    agentVersion: VERSION,
    loggerLevel: 'warn',
  });
  runtime.start();
  driverRuntime = runtime;
  return runtime;
}

function restartDriverRuntime(config: DesktopConfig): DriverAgentRuntime {
  if (driverRuntime) {
    driverRuntime.stop();
    driverRuntime = null;
  }
  return startDriverRuntime(config);
}

function stopDriverRuntime(): void {
  if (!driverRuntime) {
    return;
  }
  driverRuntime.stop();
  driverRuntime = null;
}

function getStatusPayload() {
  return {
    version: VERSION,
    config: currentConfig,
    configPath: resolveConfigPath(),
    controlPanelUrl,
    viewerRoomsUrl: buildViewerRoomsUrl(currentConfig.viewerBaseUrl),
    driver: driverRuntime
      ? { running: true, ...driverRuntime.getStatusSnapshot() }
      : {
          running: false,
          started: false,
          relayUrl: currentConfig.relayWsUrl,
          udpPort: currentConfig.udpPort,
          udpAddr: currentConfig.udpAddr,
          relayConnected: false,
          sessionId: null,
          udpPackets10s: 0,
          lastPacketAt: null,
          sessionType: null,
          trackId: null,
          playerCarIndex: null,
          uptime: 0,
          bindSucceeded: false,
          bindError: null,
          lastValidPacketId: null,
          lastSessionUID: null,
          lastParseSuccessAt: null,
          parseFailureCount: 0,
        },
  };
}

function renderPage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MPP Desktop Launcher</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #06131b;
      --panel: rgba(10, 27, 38, 0.88);
      --panel-strong: #0d2432;
      --line: rgba(134, 213, 255, 0.18);
      --text: #eef7fb;
      --muted: #8fb5c9;
      --accent: #59d4ff;
      --accent-2: #ffd166;
      --danger: #ff7b72;
      --ok: #7df2b1;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: 'Rajdhani', 'Segoe UI', sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top right, rgba(89, 212, 255, 0.18), transparent 28%),
        radial-gradient(circle at bottom left, rgba(255, 209, 102, 0.15), transparent 26%),
        linear-gradient(180deg, #041018 0%, #071823 48%, #09131b 100%);
    }

    .shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 20px 40px;
    }

    .hero {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 16px;
      padding: 22px 24px;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: linear-gradient(140deg, rgba(6, 25, 35, 0.94), rgba(10, 28, 38, 0.78));
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
    }

    .hero h1 {
      margin: 0;
      font-family: 'Orbitron', sans-serif;
      letter-spacing: 0.1em;
      font-size: clamp(28px, 5vw, 44px);
    }

    .hero p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 18px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
      font-weight: 600;
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(320px, 1.05fr) minmax(320px, 0.95fr);
      gap: 18px;
      margin-top: 18px;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 24px;
      background: var(--panel);
      padding: 22px;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.18);
    }

    h2 {
      margin: 0 0 14px;
      font-family: 'Orbitron', sans-serif;
      font-size: 20px;
      letter-spacing: 0.04em;
    }

    .form-grid {
      display: grid;
      gap: 14px;
    }

    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-weight: 600;
      font-size: 15px;
    }

    input, select {
      width: 100%;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      padding: 12px 14px;
      color: var(--text);
      background: rgba(4, 14, 20, 0.9);
      font: inherit;
    }

    .inline {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .checkbox {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text);
    }

    .checkbox input {
      width: 18px;
      height: 18px;
      margin: 0;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }

    button {
      border: 0;
      border-radius: 14px;
      padding: 12px 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      color: #04202c;
      background: linear-gradient(135deg, var(--accent), #7de9ff);
    }

    button.secondary {
      color: var(--text);
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    button.danger {
      color: white;
      background: linear-gradient(135deg, #cc4a41, var(--danger));
    }

    .status-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 10px;
    }

    .status-card {
      padding: 14px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .status-card strong {
      display: block;
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 8px;
    }

    .status-value {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.1;
      word-break: break-word;
    }

    .hint, .meta {
      color: var(--muted);
      font-size: 15px;
    }

    .meta {
      margin-top: 16px;
      display: grid;
      gap: 6px;
    }

    .message {
      min-height: 24px;
      margin-top: 12px;
      font-weight: 700;
    }

    .message.error { color: var(--danger); }
    .message.ok { color: var(--ok); }

    @media (max-width: 880px) {
      .grid { grid-template-columns: 1fr; }
      .inline { grid-template-columns: 1fr; }
      .status-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div>
        <div class="pill">v${VERSION}</div>
        <h1>MPP Desktop</h1>
        <p>드라이버는 Sender를 켜고, 엔지니어는 같은 실행 파일에서 Render Rooms를 바로 엽니다.</p>
      </div>
      <div class="pill">한 번 저장하면 다음 실행부터 자동 모드 진입</div>
    </section>

    <div class="grid">
      <section class="panel">
        <h2>Launch Setup</h2>
        <p class="hint">Public Viewer URL에 Render 배포 주소를 넣으면 Relay WebSocket URL은 자동으로 채워집니다.</p>

        <div class="form-grid">
          <label>
            Public Viewer URL
            <input id="viewerBaseUrl" placeholder="https://your-mpp.onrender.com" />
          </label>

          <label>
            Relay WebSocket URL
            <input id="relayWsUrl" placeholder="wss://your-mpp.onrender.com" />
          </label>

          <div class="inline">
            <label>
              Launch Mode
              <select id="launchMode">
                <option value="manual">수동 선택</option>
                <option value="engineer">Engineer 자동 열기</option>
                <option value="driver">Driver Sender 자동 시작</option>
              </select>
            </label>

            <label>
              UDP Port
              <input id="udpPort" type="number" min="1" max="65535" placeholder="20777" />
            </label>
          </div>

          <label>
            UDP Bind Address
            <input id="udpAddr" placeholder="0.0.0.0" />
          </label>

          <label class="checkbox">
            <input id="autoLaunch" type="checkbox" />
            다음 실행부터 위 Launch Mode로 자동 시작
          </label>
        </div>

        <div class="actions">
          <button id="saveBtn">설정 저장</button>
          <button id="openEngineerBtn" class="secondary">Engineer 열기</button>
          <button id="startDriverBtn" class="secondary">Driver Sender 시작</button>
          <button id="stopDriverBtn" class="danger">Sender 중지</button>
        </div>

        <div id="message" class="message"></div>
      </section>

      <section class="panel">
        <h2>Live Status</h2>
        <div class="status-grid">
          <div class="status-card">
            <strong>Sender</strong>
            <div id="driverRunning" class="status-value">대기</div>
          </div>
          <div class="status-card">
            <strong>Relay 연결</strong>
            <div id="relayConnected" class="status-value">미연결</div>
          </div>
          <div class="status-card">
            <strong>Session ID</strong>
            <div id="sessionId" class="status-value">-</div>
          </div>
          <div class="status-card">
            <strong>UDP packets/10s</strong>
            <div id="udpPackets" class="status-value">0</div>
          </div>
          <div class="status-card">
            <strong>Bind 상태</strong>
            <div id="bindState" class="status-value">대기</div>
          </div>
          <div class="status-card">
            <strong>최근 패킷</strong>
            <div id="lastPacket" class="status-value">-</div>
          </div>
        </div>

        <div class="meta">
          <div>Viewer Rooms: <span id="viewerRoomsUrl">-</span></div>
          <div>Config Path: <span id="configPath">-</span></div>
          <div>Control Panel: <span id="panelUrl">-</span></div>
        </div>
      </section>
    </div>
  </div>

  <script>
    const els = {
      viewerBaseUrl: document.getElementById('viewerBaseUrl'),
      relayWsUrl: document.getElementById('relayWsUrl'),
      launchMode: document.getElementById('launchMode'),
      udpPort: document.getElementById('udpPort'),
      udpAddr: document.getElementById('udpAddr'),
      autoLaunch: document.getElementById('autoLaunch'),
      saveBtn: document.getElementById('saveBtn'),
      openEngineerBtn: document.getElementById('openEngineerBtn'),
      startDriverBtn: document.getElementById('startDriverBtn'),
      stopDriverBtn: document.getElementById('stopDriverBtn'),
      message: document.getElementById('message'),
      driverRunning: document.getElementById('driverRunning'),
      relayConnected: document.getElementById('relayConnected'),
      sessionId: document.getElementById('sessionId'),
      udpPackets: document.getElementById('udpPackets'),
      bindState: document.getElementById('bindState'),
      lastPacket: document.getElementById('lastPacket'),
      viewerRoomsUrl: document.getElementById('viewerRoomsUrl'),
      configPath: document.getElementById('configPath'),
      panelUrl: document.getElementById('panelUrl'),
    };

    let formDirty = false;
    let suppressDirtyTracking = false;
    let relayManuallyEdited = false;
    let lastAutoRelayValue = '';

    function showMessage(text, kind) {
      els.message.textContent = text || '';
      els.message.className = 'message' + (kind ? ' ' + kind : '');
    }

    function relTime(ts) {
      if (!ts) return '-';
      const diff = Date.now() - ts;
      if (diff < 2000) return '방금 전';
      if (diff < 60000) return Math.floor(diff / 1000) + '초 전';
      return Math.floor(diff / 60000) + '분 전';
    }

    function markFormDirty() {
      if (!suppressDirtyTracking) {
        formDirty = true;
      }
    }

    function deriveRelayFromViewer(viewer) {
      if (!viewer) return '';
      try {
        const normalized = viewer.includes('://') ? viewer : 'https://' + viewer;
        const url = new URL(normalized);
        return (url.protocol === 'https:' ? 'wss://' : 'ws://') + url.host;
      } catch (_) {
        return '';
      }
    }

    function maybeFillRelayFromViewer() {
      const viewer = String(els.viewerBaseUrl.value || '').trim();
      const derivedRelay = deriveRelayFromViewer(viewer);
      if (!derivedRelay) return;

      const currentRelay = String(els.relayWsUrl.value || '').trim();
      const canReplaceCurrentRelay =
        !currentRelay ||
        currentRelay === lastAutoRelayValue ||
        relayManuallyEdited === false;

      if (!canReplaceCurrentRelay) {
        return;
      }

      suppressDirtyTracking = true;
      els.relayWsUrl.value = derivedRelay;
      suppressDirtyTracking = false;
      relayManuallyEdited = false;
      lastAutoRelayValue = derivedRelay;
    }

    function readForm() {
      return {
        viewerBaseUrl: String(els.viewerBaseUrl.value || '').trim(),
        relayWsUrl: String(els.relayWsUrl.value || '').trim(),
        launchMode: String(els.launchMode.value || 'manual'),
        autoLaunch: Boolean(els.autoLaunch.checked),
        udpPort: Number.parseInt(String(els.udpPort.value || '20777'), 10),
        udpAddr: String(els.udpAddr.value || '').trim(),
      };
    }

    function writeForm(config, options) {
      const force = options && options.force === true;
      if (!force && formDirty) {
        return;
      }

      suppressDirtyTracking = true;
      els.viewerBaseUrl.value = config.viewerBaseUrl || '';
      els.relayWsUrl.value = config.relayWsUrl || '';
      els.launchMode.value = config.launchMode || 'manual';
      els.autoLaunch.checked = config.autoLaunch === true;
      els.udpPort.value = String(config.udpPort || 20777);
      els.udpAddr.value = config.udpAddr || '0.0.0.0';
      suppressDirtyTracking = false;
      formDirty = false;
      relayManuallyEdited = false;
      lastAutoRelayValue = String(config.relayWsUrl || '').trim();
    }

    function renderStatus(data) {
      const driver = data.driver;
      els.driverRunning.textContent = driver.running ? '실행 중' : '대기';
      els.relayConnected.textContent = driver.relayConnected ? '연결됨' : '미연결';
      els.sessionId.textContent = driver.sessionId || '-';
      els.udpPackets.textContent = String(driver.udpPackets10s || 0);
      els.bindState.textContent = driver.bindSucceeded ? '바인드 성공' : (driver.bindError || '대기');
      els.lastPacket.textContent = relTime(driver.lastPacketAt);
      els.viewerRoomsUrl.textContent = data.viewerRoomsUrl || '-';
      els.configPath.textContent = data.configPath || '-';
      els.panelUrl.textContent = data.controlPanelUrl || '-';
    }

    async function refresh() {
      const res = await fetch('/api/status');
      const data = await res.json();
      writeForm(data.config);
      renderStatus(data);
    }

    async function post(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '요청 실패');
      }
      if (data.config) writeForm(data.config, { force: true });
      if (data.driver) renderStatus(data);
      return data;
    }

    els.viewerBaseUrl.addEventListener('input', () => {
      markFormDirty();
      maybeFillRelayFromViewer();
    });
    els.viewerBaseUrl.addEventListener('blur', maybeFillRelayFromViewer);
    els.relayWsUrl.addEventListener('input', () => {
      markFormDirty();
      relayManuallyEdited = true;
    });
    els.launchMode.addEventListener('change', markFormDirty);
    els.udpPort.addEventListener('input', markFormDirty);
    els.udpAddr.addEventListener('input', markFormDirty);
    els.autoLaunch.addEventListener('change', markFormDirty);
    els.saveBtn.addEventListener('click', async () => {
      try {
        maybeFillRelayFromViewer();
        const data = await post('/api/config', readForm());
        showMessage(data.message || '설정이 저장되었습니다.', 'ok');
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
    els.openEngineerBtn.addEventListener('click', async () => {
      try {
        maybeFillRelayFromViewer();
        const data = await post('/api/open-engineer', readForm());
        showMessage(data.message || 'Engineer 화면을 열었습니다.', 'ok');
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
    els.startDriverBtn.addEventListener('click', async () => {
      try {
        maybeFillRelayFromViewer();
        const data = await post('/api/start-driver', readForm());
        showMessage(data.message || 'Driver Sender를 시작했습니다.', 'ok');
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
    els.stopDriverBtn.addEventListener('click', async () => {
      try {
        const data = await post('/api/stop-driver', {});
        showMessage(data.message || 'Driver Sender를 중지했습니다.', 'ok');
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });

    refresh().catch((error) => showMessage(error.message, 'error'));
    setInterval(() => {
      refresh().catch((error) => showMessage(error.message, 'error'));
    }, 1000);
  </script>
</body>
</html>`;
}

function normalizeIncomingConfig(body: unknown): DesktopConfig {
  return sanitizeDesktopConfig((body || {}) as Partial<DesktopConfig>, runtimeDefaults);
}

function ensureLaunchableConfig(config: DesktopConfig): DesktopConfig {
  const errors = validateDesktopConfig(config);
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }
  return config;
}

function openViewerRooms(config: DesktopConfig): string {
  const roomsUrl = buildViewerRoomsUrl(config.viewerBaseUrl);
  if (!roomsUrl) {
    throw new Error('Public Viewer URL을 먼저 저장하세요.');
  }
  openBrowser(roomsUrl);
  return roomsUrl;
}

async function startControlPanel(flags: LauncherFlags): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.type('html').send(renderPage());
  });

  app.get('/api/status', (_req, res) => {
    res.json(getStatusPayload());
  });

  app.post('/api/config', (req, res) => {
    try {
      const nextConfig = saveConfig(normalizeIncomingConfig(req.body));
      res.json({ ...getStatusPayload(), config: nextConfig, message: '설정을 저장했습니다.' });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/open-engineer', (req, res) => {
    try {
      const nextConfig = saveConfig(normalizeIncomingConfig(req.body));
      const validated = ensureLaunchableConfig(nextConfig);
      const roomsUrl = openViewerRooms(validated);
      res.json({ ...getStatusPayload(), message: `Engineer 화면을 열었습니다: ${roomsUrl}` });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/start-driver', (req, res) => {
    try {
      const nextConfig = saveConfig(normalizeIncomingConfig(req.body));
      const validated = ensureLaunchableConfig(nextConfig);
      restartDriverRuntime(validated);
      const roomsUrl = openViewerRooms(validated);
      res.json({ ...getStatusPayload(), message: `Driver Sender를 시작했습니다: ${roomsUrl}` });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/stop-driver', (_req, res) => {
    stopDriverRuntime();
    res.json({ ...getStatusPayload(), message: 'Driver Sender를 중지했습니다.' });
  });

  await new Promise<void>((resolve) => {
    const server = app.listen(0, PANEL_HOST, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      controlPanelUrl = `http://${PANEL_HOST}:${port}`;

      if (!flags.noBrowser) {
        openBrowser(controlPanelUrl);
      }

      if (flags.forceDriver) {
        try {
          const validated = ensureLaunchableConfig(currentConfig);
          restartDriverRuntime(validated);
          openViewerRooms(validated);
        } catch {
          // The panel remains open so the user can correct settings.
        }
      } else if (!flags.forceSetup && currentConfig.autoLaunch && currentConfig.launchMode === 'driver') {
        try {
          const validated = ensureLaunchableConfig(currentConfig);
          restartDriverRuntime(validated);
          if (!flags.noBrowser) {
            openViewerRooms(validated);
          }
        } catch {
          // Invalid saved config falls back to the panel.
        }
      }

      resolve();
    });

    server.on('close', () => {
      stopDriverRuntime();
    });
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  if (
    !flags.forceSetup &&
    !flags.forceDriver &&
    (flags.forceEngineer || (currentConfig.autoLaunch && currentConfig.launchMode === 'engineer'))
  ) {
    try {
      const validated = ensureLaunchableConfig(currentConfig);
      if (!flags.noBrowser) {
        openViewerRooms(validated);
      }
      setTimeout(() => process.exit(0), 150);
      return;
    } catch {
      // Saved config is incomplete; fall through to the control panel.
    }
  }

  await startControlPanel(flags);

  process.on('SIGINT', () => {
    stopDriverRuntime();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopDriverRuntime();
    process.exit(0);
  });

  process.stdout.write(`MPP Desktop v${VERSION}\n`);
  if (controlPanelUrl) {
    process.stdout.write(`Control Panel: ${controlPanelUrl}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`[Fatal] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});