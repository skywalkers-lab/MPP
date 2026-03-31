// viewer.js: polling 기반 viewer 클라이언트 (5단계 joinCode 진입 지원)

// joinCode 기반 진입 지원
function getJoinCodeFromPath() {
  const m = location.pathname.match(/\/join\/([A-Z0-9]{6,8})/i);
  return m ? m[1] : null;
}
const joinCode = getJoinCodeFromPath();
const sessionId = !joinCode ? location.pathname.split('/').pop() : null;
const apiUrl = joinCode
  ? `/api/viewer/join/${encodeURIComponent(joinCode)}`
  : `/api/viewer/sessions/${encodeURIComponent(sessionId)}`;

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
    <div><span class="label">Viewer Status:</span> <span class="status">${safe(data.viewerStatus)}</span></div>
    <div><span class="label">Relay Status:</span> ${safe(data.relayStatus)}</div>
    <div><span class="label">Last Update:</span> ${fmtTime(data.updatedAt)}</div>
    <div><span class="label">Last Heartbeat:</span> ${fmtTime(data.lastHeartbeatAt)}</div>
    <div><span class="label">Latest Sequence:</span> ${safe(data.latestSequence)}</div>
  `;
}

function renderSnapshotSummary(data, options = {}) {
  const { statusMessage = '', pollError = false } = options;
  let headerHtml = '';
  if (statusMessage) headerHtml += `<div style="margin-bottom:8px;">${statusMessage}</div>`;
  if (pollError) headerHtml += '<div class="error" style="margin-bottom:8px;">API 갱신 실패, 재시도 중...</div>';
  if (!data.snapshot) {
    $snapshotSummary.innerHTML = `${headerHtml}<em>스냅샷 없음</em>`;
    return;
  }
  const s = data.snapshot;
  const playerIdx = s.playerCarIndex;
  let playerCar = null;
  if (playerIdx !== undefined && playerIdx !== null && s.cars && typeof s.cars === 'object') {
    playerCar = s.cars[playerIdx] || null;
  }
  if (!playerCar) {
    $snapshotSummary.innerHTML = `${headerHtml}<em>플레이어 차량 정보가 아직 없습니다.</em>`;
    return;
  }
  $snapshotSummary.innerHTML = `
    ${headerHtml}
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
  if (data.viewerStatus === 'not_found') {
    let msg = '<span class="error">존재하지 않는 세션입니다.</span>';
    if (opts.pollError) msg += '<div class="error" style="margin-top:8px;">API 갱신 실패, 재시도 중...</div>';
    $sessionCard.innerHTML = msg;
    $snapshotSummary.innerHTML = '';
    $eventLog.innerHTML = '';
    return;
  }
  renderSessionCard(data);
  if (data.viewerStatus === 'waiting') {
    renderSnapshotSummary(data, {
      statusMessage: '호스트가 연결되었지만 아직 텔레메트리 스냅샷이 도착하지 않았습니다.',
      pollError: opts.pollError === true,
    });
    $eventLog.innerHTML = '';
    return;
  }
  if (data.viewerStatus === 'live') {
    renderSnapshotSummary(data, { pollError: opts.pollError === true });
    renderEventLog(data);
    return;
  }
  if (data.viewerStatus === 'stale') {
    renderSnapshotSummary(data, {
      statusMessage: '호스트 연결이 끊겼습니다. 마지막 상태를 표시 중입니다.',
      pollError: opts.pollError === true,
    });
    renderEventLog(data);
    return;
  }
  if (data.viewerStatus === 'ended') {
    renderSnapshotSummary(data, {
      statusMessage: '세션이 종료되었습니다.',
      pollError: opts.pollError === true,
    });
    renderEventLog(data);
    return;
  }
  $sessionCard.innerHTML = '<span class="error">알 수 없는 상태</span>';
  $snapshotSummary.innerHTML = '';
  $eventLog.innerHTML = '';
}

let lastGoodData = null;

async function poll() {
  try {
    const res = await fetch(apiUrl);
    const data = await res.json();
    lastGoodData = data;
    // joinCode 기반 진입 시 상태 분기 처리
    if (joinCode) {
      if (data.viewerStatus === 'invalid_code') {
        $sessionCard.innerHTML = '<span class="error">유효하지 않은 초대 코드입니다.</span>';
        $snapshotSummary.innerHTML = '';
        $eventLog.innerHTML = '';
        return setTimeout(poll, 3000);
      }
      if (data.viewerStatus === 'not_shared') {
        $sessionCard.innerHTML = '<span class="error">이 세션은 현재 공유 중이 아닙니다.</span>';
        $snapshotSummary.innerHTML = '';
        $eventLog.innerHTML = '';
        return setTimeout(poll, 3000);
      }
    }
    renderStatus(data);
  } catch (e) {
    if (lastGoodData) {
      renderStatus(lastGoodData, { pollError: true });
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
