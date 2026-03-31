// viewer.js: polling 기반 viewer 클라이언트 (정리 버전)
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

function safe(val) {
  return val === undefined || val === null ? '-' : val;
}

function renderSessionCard(data) {
  $sessionCard.innerHTML = `
    <div><span class="label">Session ID:</span> <span class="value">${data.sessionId || sessionId}</span></div>
    <div><span class="label">Viewer Status:</span> <span class="status">${data.viewerStatus}</span></div>
    <div><span class="label">Relay Status:</span> ${data.relayStatus}</div>
    <div><span class="label">Last Update:</span> ${fmtTime(data.updatedAt)}</div>
    <div><span class="label">Last Heartbeat:</span> ${fmtTime(data.lastHeartbeatAt)}</div>
    <div><span class="label">Latest Sequence:</span> ${data.latestSequence ?? '-'} </div>
  `;
}

function renderSnapshotSummary(data) {
  if (!data.snapshot) {
    $snapshotSummary.innerHTML = '<em>스냅샷 없음</em>';
    return;
  }
  const s = data.snapshot;
  const playerIdx = s.playerCarIndex;
  let playerCar = null;
  if (playerIdx !== undefined && playerIdx !== null && s.cars && typeof s.cars === 'object') {
    playerCar = s.cars[playerIdx] || null;
  }
  if (!playerCar) {
    $snapshotSummary.innerHTML = '<em>플레이어 차량 정보가 아직 없습니다.</em>';
    return;
  }
  $snapshotSummary.innerHTML = `
    <div><span class="label">Player Car Index:</span> ${safe(playerIdx)}</div>
    <div><span class="label">Lap:</span> ${safe(playerCar.currentLapNum)}</div>
    <div><span class="label">Position:</span> ${safe(playerCar.position)}</div>
    <div><span class="label">Last Lap:</span> ${safe(playerCar.lastLapTime)}</div>
    <div><span class="label">Best Lap:</span> ${safe(playerCar.bestLapTime)}</div>
    <div><span class="label">Fuel Remaining:</span> ${safe(playerCar.fuelRemaining)}</div>
    <div><span class="label">Fuel Laps Remaining:</span> ${safe(playerCar.fuelLapsRemaining)}</div>
    <div><span class="label">Tyre Age (Laps):</span> ${safe(playerCar.tyreAgeLaps)}</div>
    <div><span class="label">ERS Level:</span> ${safe(playerCar.ersLevel)}</div>
    <div><span class="label">Tyre Compound:</span> ${safe(playerCar.tyreCompound)}</div>
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

function renderStatus(data, opts = {}) {
  let statusMsg = '';
  if (data.viewerStatus === 'not_found') {
    statusMsg = '<span class="error">존재하지 않는 세션입니다.</span>';
    if (opts.pollError) statusMsg += '<div class="error" style="margin-top:8px;">API 갱신 실패, 재시도 중...</div>';
    $sessionCard.innerHTML = statusMsg;
    $snapshotSummary.innerHTML = '';
    $eventLog.innerHTML = '';
    return;
  }
  renderSessionCard(data);
  switch (data.viewerStatus) {
    case 'waiting':
      statusMsg = '<span>호스트가 연결되었지만 아직 텔레메트리 스냅샷이 도착하지 않았습니다.</span>';
      $snapshotSummary.innerHTML = statusMsg + (opts.pollError ? '<div class="error" style="margin-top:8px;">API 갱신 실패, 재시도 중...</div>' : '');
      $eventLog.innerHTML = '';
      break;
    case 'live':
      $snapshotSummary.innerHTML = (opts.pollError ? '<div class="error" style="margin-bottom:8px;">API 갱신 실패, 재시도 중...</div>' : '');
      renderSnapshotSummary(data);
      renderEventLog(data);
      break;
    case 'stale':
      statusMsg = '<span>호스트 연결이 끊겼습니다. 마지막 상태를 표시 중입니다.</span>';
      $snapshotSummary.innerHTML = statusMsg + (opts.pollError ? '<div class="error" style="margin-top:8px;">API 갱신 실패, 재시도 중...</div>' : '');
      renderSnapshotSummary(data);
      renderEventLog(data);
      break;
    case 'ended':
      statusMsg = '<span>세션이 종료되었습니다.</span>';
      $snapshotSummary.innerHTML = statusMsg + (opts.pollError ? '<div class="error" style="margin-top:8px;">API 갱신 실패, 재시도 중...</div>' : '');
      renderSnapshotSummary(data);
      renderEventLog(data);
      break;
    default:
      $snapshotSummary.innerHTML = '<span class="error">알 수 없는 상태</span>';
      $eventLog.innerHTML = '';
  }
}

let lastGoodData = null;
async function poll() {
  let pollError = false;
  try {
    const res = await fetch(apiUrl);
    const data = await res.json();
    lastGoodData = data;
    renderStatus(data);
  } catch (e) {
    pollError = true;
    if (lastGoodData) {
      renderStatus(lastGoodData, { pollError });
    } else {
      $sessionCard.innerHTML = '<span class="error">API 오류: ' + (e.message || e) + '</span>';
      $snapshotSummary.innerHTML = '';
      $eventLog.innerHTML = '';
    }
  } finally {
    setTimeout(poll, 1000);
  }
}

      case 'not_found':
        statusMsg = '<span class="error">존재하지 않는 세션입니다.</span>';
        break;
      case 'waiting':
        statusMsg = '<span>호스트가 연결되었지만 아직 텔레메트리 스냅샷이 도착하지 않았습니다.</span>';
        break;
      case 'stale':
        statusMsg = '<span>호스트 연결이 끊겼습니다. 마지막 상태를 표시 중입니다.</span>';
        break;
      case 'ended':
        statusMsg = '<span>세션이 종료되었습니다.</span>';
        break;
      case 'live':
        statusMsg = '';
        break;
      default:
        statusMsg = '<span class="error">알 수 없는 상태</span>';
    }
    // polling 실패 시 별도 안내
    if (opts.pollError) {
      statusMsg += '<div class="error" style="margin-top:8px;">API 갱신 실패, 재시도 중...</div>';
    }
    // 상태 카드/스냅샷/이벤트 분리 렌더링
    if (data.viewerStatus === 'not_found') {
      $sessionCard.innerHTML = statusMsg;
      $snapshotSummary.innerHTML = '';
      $eventLog.innerHTML = '';
      return;
    }
    renderSessionCard(data);
    $snapshotSummary.innerHTML = statusMsg;
    if (data.viewerStatus === 'live' || data.viewerStatus === 'stale' || data.viewerStatus === 'ended') {
      renderSnapshotSummary(data);
      renderEventLog(data);
    } else {
      $eventLog.innerHTML = '';
    }
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
  let lastGoodData = null;
  async function poll() {
    let pollError = false;
    try {
      const res = await fetch(apiUrl);
      const data = await res.json();
      lastGoodData = data;
      renderStatus(data);
    } catch (e) {
      pollError = true;
      if (lastGoodData) {
        renderStatus(lastGoodData, { pollError });
      } else {
        $sessionCard.innerHTML = '<span class="error">API 오류: ' + (e.message || e) + '</span>';
        $snapshotSummary.innerHTML = '';
        $eventLog.innerHTML = '';
      }
    } finally {
      setTimeout(poll, 1000);
    }
  }

  poll();
}

poll();
