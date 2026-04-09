// agent-main.ts  — MPP (Mission Pitwall Platform) 드라이버 로컬 에이전트
// Windows .exe로 패키징되어 드라이버 PC에서 단독 실행된다.
// F1 25 UDP 텔레메트리를 수신하고 릴레이 서버로 전송한다.

import path from 'path';
import fs from 'fs';
import { DriverAgentRuntime, DriverAgentRuntimeSnapshot } from './agent/DriverAgentRuntime';

const VERSION = '0.1.17';

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  white:   '\x1b[97m',
  gray:    '\x1b[90m',
  magenta: '\x1b[35m',
};

function clr(code: string, text: string) {
  return code + text + C.reset;
}

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

// pkg exe 옆 디렉터리 또는 CWD에서 config 파일 찾기
function resolveConfigPath(): string {
  const filename = 'mpp-agent.config.json';
  const isPkg = typeof (process as any).pkg !== 'undefined';
  if (isPkg) {
    return path.join(path.dirname(process.execPath), filename);
  }
  return path.join(process.cwd(), filename);
}

interface AgentConfig {
  relayUrl: string;
  udpPort?: number;
  udpAddr?: string;
  sessionId?: string;
  agentVersion?: string;
}

function loadConfig(): AgentConfig | null {
  const configPath = resolveConfigPath();

  // 설정 파일이 있으면 우선 사용
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as AgentConfig;
      if (!parsed.relayUrl) {
        printError('mpp-agent.config.json에 "relayUrl" 항목이 없습니다.');
        return null;
      }
      return parsed;
    } catch (e) {
      printError(`설정 파일 파싱 실패: ${configPath}\n  오류: ${e}`);
      return null;
    }
  }

  // env var 폴백
  if (process.env.RELAY_URL) {
    return {
      relayUrl: process.env.RELAY_URL,
      udpPort: process.env.F1_UDP_PORT ? parseInt(process.env.F1_UDP_PORT) : 20777,
      udpAddr: process.env.F1_UDP_ADDR || '0.0.0.0',
      sessionId: process.env.RELAY_SESSION_ID,
    };
  }

  return null;
}

function printError(msg: string) {
  process.stderr.write(clr(C.red, '\n[오류] ') + msg + '\n');
}

function printUsage(configPath: string) {
  clearScreen();
  process.stdout.write([
    clr(C.cyan + C.bold, '═══════════════════════════════════════════════'),
    clr(C.cyan + C.bold, `  MPP Agent v${VERSION}  —  Mission Pitwall Platform`),
    clr(C.cyan + C.bold, '═══════════════════════════════════════════════'),
    '',
    clr(C.yellow, '  설정 파일을 찾을 수 없습니다.'),
    '',
    '  아래 경로에 mpp-agent.config.json 파일을 만들어주세요:',
    clr(C.white, `    ${configPath}`),
    '',
    '  파일 내용 예시:',
    clr(C.gray, '  {'),
    clr(C.gray, '    "relayUrl": "wss://your-app.replit.app/relay",'),
    clr(C.gray, '    "udpPort": 20777,'),
    clr(C.gray, '    "udpAddr": "0.0.0.0"'),
    clr(C.gray, '  }'),
    '',
    '  항목 설명:',
    `    ${clr(C.cyan, 'relayUrl')}   — 퍼블리시된 MPP 릴레이 서버 WebSocket 주소 ${clr(C.red, '(필수)')}`,
    `    ${clr(C.cyan, 'udpPort')}    — F1 25 게임 UDP 송신 포트 (기본값: 20777)`,
    `    ${clr(C.cyan, 'udpAddr')}    — 수신 바인드 주소 (기본값: 0.0.0.0)`,
    `    ${clr(C.cyan, 'sessionId')}  — 세션 재사용 시 지정 (없으면 자동 생성)`,
    '',
    '  F1 25 설정:',
    '    게임 내 UDP 텔레메트리를 활성화하고',
    '    대상 IP를 이 PC IP로, 포트를 위의 udpPort로 설정하세요.',
    '',
    clr(C.gray, '  설정 파일 생성 후 다시 실행하면 자동 연결됩니다.'),
    '',
  ].join('\n') + '\n');
}

function formatTime(ms: number | null): string {
  if (ms == null) return '--';
  const ago = Date.now() - ms;
  if (ago < 2000) return clr(C.green, '방금 전');
  if (ago < 60000) return `${Math.floor(ago / 1000)}초 전`;
  return `${Math.floor(ago / 60000)}분 전`;
}

function drawStatus(opts: DriverAgentRuntimeSnapshot) {
  const {
    relayUrl, udpPort, udpAddr,
    relayConnected, sessionId,
    udpPackets10s, lastPacketAt,
    sessionType, trackId, playerCarIndex,
    uptime,
  } = opts;

  const pktPerSec = (udpPackets10s / 10).toFixed(1);
  const uptimeSec = Math.floor(uptime / 1000);
  const uptimeStr = `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

  const relayStatus = relayConnected
    ? clr(C.green, '● 연결됨')
    : clr(C.red,   '○ 연결 중...');
  const sessionStr = sessionId
    ? clr(C.cyan, sessionId)
    : clr(C.gray, '(대기 중)');
  const udpColor = lastPacketAt && Date.now() - lastPacketAt < 3000 ? C.green : C.yellow;
  const udpStatus = lastPacketAt
    ? clr(udpColor, `수신 중 (${pktPerSec} pkt/s)`)
    : clr(C.gray, '대기 중...');

  clearScreen();
  process.stdout.write([
    clr(C.cyan + C.bold, '╔══════════════════════════════════════════════════╗'),
    clr(C.cyan + C.bold, '║  MPP Agent') +
      clr(C.gray, ` v${VERSION}`) +
      clr(C.cyan + C.bold, '                                 ║'),
    clr(C.cyan + C.bold, '║  Mission Pitwall Platform — 드라이버 로컬 에이전트 ║'),
    clr(C.cyan + C.bold, '╚══════════════════════════════════════════════════╝'),
    '',
    clr(C.bold, '  [ 릴레이 서버 ]'),
    `    상태    : ${relayStatus}`,
    `    주소    : ${clr(C.gray, relayUrl)}`,
    `    세션 ID : ${sessionStr}`,
    '',
    clr(C.bold, '  [ F1 UDP 텔레메트리 ]'),
    `    수신 포트 : ${clr(C.white, String(udpPort))}  (${udpAddr})`,
    `    상태      : ${udpStatus}`,
    `    마지막    : ${formatTime(lastPacketAt)}`,
    '',
    clr(C.bold, '  [ 레이스 정보 ]'),
    `    세션 타입 : ${clr(C.white, sessionType ?? '--')}`,
    `    트랙 ID   : ${clr(C.white, trackId != null ? String(trackId) : '--')}`,
    `    플레이어  : Car #${clr(C.white, playerCarIndex != null ? String(playerCarIndex) : '--')}`,
    '',
    `  ${clr(C.gray, `가동 시간: ${uptimeStr}`)}   ${clr(C.gray, 'Ctrl+C로 종료')}`,
    '',
  ].join('\n') + '\n');
}

async function main() {
  const configPath = resolveConfigPath();
  const config = loadConfig();

  if (!config) {
    printUsage(configPath);
    process.exit(1);
  }

  const udpPort = config.udpPort ?? 20777;
  const udpAddr = config.udpAddr ?? '0.0.0.0';
  const relayUrl = config.relayUrl;
  const sessionId = config.sessionId;

  const runtime = new DriverAgentRuntime({
    relayUrl,
    udpPort,
    udpAddr,
    sessionId,
    agentVersion: config.agentVersion ?? VERSION,
    loggerLevel: 'warn',
  });
  runtime.start();

  const statusTimer = setInterval(() => {
    drawStatus(runtime.getStatusSnapshot());
  }, 1000);

  drawStatus(runtime.getStatusSnapshot());

  function shutdown() {
    clearInterval(statusTimer);
    runtime.stop();
    process.stdout.write('\n' + clr(C.yellow, '  MPP Agent 종료됨.') + '\n\n');
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write('[Fatal] ' + String(err) + '\n');
  process.exit(1);
});
