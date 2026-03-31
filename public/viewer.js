// viewer.js: polling 기반 viewer 클라이언트
const sessionId = location.pathname.split('/').pop();
const apiUrl = `/api/viewer/sessions/${encodeURIComponent(sessionId)}`;

const $sessionCard = document.getElementById('session-card');
const $snapshotSummary = document.getElementById('snapshot-summary');
const $eventLog = document.getElementById('event-log');

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString();
}

function renderSessionCard(data) {
  $sessionCard.innerHTML = `
    <div><span class="label">Session ID:</span> <span class="value">${data.sessionId || sessionId}</span></div>
    <div><span class="label">Viewer Status:</span> <span class="status">${data.viewerStatus}</span></div>
    <div><span class="label">Relay Status:</span> ${data.relayStatus}</div>
    <div><span class="label">Last Update:</span> ${fmtTime(data.updatedAt)}</div>
    <div><span class="label">Last Heartbeat:</span> ${fmtTime(data.lastHeartbeatAt)}</div>
    <div><span class="label">Latest Sequence:</span> ${data.latestSequence ?? '-'}</div>
  `;
}

function renderSnapshotSummary(data) {
  if (!data.snapshot) {
    $snapshotSummary.innerHTML = '<em>스냅샷 없음</em>';
    return;
  }
  const s = data.snapshot;
  const playerIdx = s.playerCarIndex ?? '-';
  const cars = s.cars || [];
  const playerCar = (Array.isArray(cars) && cars[playerIdx]) || {};
  const lap = playerCar.lap ?? '-';
  const pos = playerCar.position ?? '-';
  const lastLap = playerCar.lastLapTime ?? '-';
  const bestLap = playerCar.bestLapTime ?? '-';
  const fuel = playerCar.fuelRemaining ?? playerCar.fuelLapsRemaining ?? '-';
  const tyreAge = playerCar.tyreAgeLaps ?? '-';
  const ers = playerCar.ersLevel ?? '-';
  const compound = playerCar.tyreCompound ?? '-';
  $snapshotSummary.innerHTML = `
    <div><span class="label">Player Car Index:</span> ${playerIdx}</div>
    <div><span class="label">Lap:</span> ${lap}</div>
    <div><span class="label">Position:</span> ${pos}</div>
    <div><span class="label">Last Lap:</span> ${lastLap}</div>
    <div><span class="label">Best Lap:</span> ${bestLap}</div>
    <div><span class="label">Fuel:</span> ${fuel}</div>
    <div><span class="label">Tyre Age:</span> ${tyreAge}</div>
    <div><span class="label">ERS:</span> ${ers}</div>
    <div><span class="label">Tyre Compound:</span> ${compound}</div>
  `;
}

function renderEventLog(data) {
  const events = (data.snapshot && data.snapshot.eventLog) || [];
  if (!Array.isArray(events) || events.length === 0) {
    $eventLog.innerHTML = '<em>이벤트 로그 없음</em>';
    return;
  }
  const recent = events.slice(-5).reverse();
  $eventLog.innerHTML = '<div class="label">최근 이벤트</div><ul>' +
    recent.map(e => `<li>${e.type || '-'} <span style="color:#aaa">${fmtTime(e.timestamp)}</span></li>`).join('') + '</ul>';
}

function renderStatus(data) {
  switch (data.viewerStatus) {
    case 'not_found':
      $sessionCard.innerHTML = '<span class="error">존재하지 않는 세션입니다.</span>';
      $snapshotSummary.innerHTML = '';
      $eventLog.innerHTML = '';
      break;
    case 'waiting':
      renderSessionCard(data);
      $snapshotSummary.innerHTML = '<span>호스트가 연결되었지만 아직 텔레메트리 스냅샷이 도착하지 않았습니다.</span>';
      $eventLog.innerHTML = '';
      break;
    case 'live':
      renderSessionCard(data);
      renderSnapshotSummary(data);
      renderEventLog(data);
      break;
    case 'stale':
      renderSessionCard(data);
      $snapshotSummary.innerHTML = '<span>호스트 연결이 끊겼습니다. 마지막 상태를 표시 중입니다.</span>';
      renderSnapshotSummary(data);
      renderEventLog(data);
      break;
    case 'ended':
      renderSessionCard(data);
      $snapshotSummary.innerHTML = '<span>세션이 종료되었습니다.</span>';
      renderSnapshotSummary(data);
      renderEventLog(data);
      break;
    default:
      $sessionCard.innerHTML = '<span class="error">알 수 없는 상태</span>';
      $snapshotSummary.innerHTML = '';
      $eventLog.innerHTML = '';
  }
}

async function poll() {
  try {
    const res = await fetch(apiUrl);
    const data = await res.json();
    renderStatus(data);
  } catch (e) {
    $sessionCard.innerHTML = '<span class="error">API 오류: ' + (e.message || e) + '</span>';
    $snapshotSummary.innerHTML = '';
    $eventLog.innerHTML = '';
  } finally {
    setTimeout(poll, 1000);
  }
}

poll();
