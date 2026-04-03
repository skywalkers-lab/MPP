function getJoinCodeFromPath() {
  const m = location.pathname.match(/\/join\/([A-Z0-9]{6,8})/i);
  return m ? m[1] : null;
}

const joinCode = getJoinCodeFromPath();
const sessionId = !joinCode ? location.pathname.split('/').pop() : null;
const apiUrl = joinCode
  ? `/api/viewer/join/${encodeURIComponent(joinCode)}`
  : `/api/viewer/sessions/${encodeURIComponent(sessionId)}`;
const preset = window.UiCommon ? window.UiCommon.applyPreset(joinCode ? 'broadcast' : 'ops') : 'ops';
const presetIndicator = document.getElementById('preset-indicator');
if (presetIndicator) {
  presetIndicator.textContent = 'preset: ' + preset;
}

const $accessCard = document.getElementById('access-card');
const $sessionCard = document.getElementById('session-card');
const $snapshotSummary = document.getElementById('snapshot-summary');
const $eventLog = document.getElementById('event-log');

async function fetchHealth(resolvedSessionId) {
  if (!resolvedSessionId) return null;
  try {
    const healthRes = await fetch(`/api/viewer/health/${encodeURIComponent(resolvedSessionId)}`);
    if (!healthRes.ok) return null;
    return await healthRes.json();
  } catch (err) {
    return null;
  }
}

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString();
}

function safe(val) {
  return val === undefined || val === null ? '-' : val;
}

function renderAccessError(data) {
  const code = data && data.accessError && data.accessError.code
    ? data.accessError.code
    : data.viewerStatus;
  const message = data && data.accessError && data.accessError.message
    ? data.accessError.message
    : data.message;

  $accessCard.style.display = 'block';

  if (code === 'invalid_code') {
    $accessCard.innerHTML = '<div class="error"><b>접근 오류:</b> 유효하지 않은 초대 코드입니다.</div>';
  } else if (code === 'not_shared') {
    $accessCard.innerHTML = '<div class="error"><b>접근 오류:</b> 현재 세션 공유가 비활성화되어 있습니다.<br/>호스트가 shareEnabled를 ON으로 변경하고 visibility를 code로 설정해야 합니다.</div>';
  } else {
    $accessCard.innerHTML = '<div class="error"><b>접근 오류:</b> ' + safe(message) + '</div>';
  }
}

function clearAccessError() {
  $accessCard.style.display = 'none';
  $accessCard.innerHTML = '';
}

function renderSessionCard(data, healthData) {
  const access = data.access || null;
  const healthLevel = healthData && healthData.healthLevel ? healthData.healthLevel : 'connecting';
  const healthChip = window.UiCommon
    ? window.UiCommon.healthChipHtml(healthLevel)
    : safe(healthLevel);
  const healthBar = window.UiCommon
    ? window.UiCommon.freshnessBarHtml({
      heartbeatAgeMs: healthData && healthData.heartbeatAgeMs,
      snapshotFreshnessMs: healthData && healthData.snapshotFreshnessMs,
      relayFreshnessMs: healthData && healthData.relayFreshnessMs,
    })
    : '';

  $sessionCard.innerHTML = `
    <div><span class="label">Session ID:</span> <span class="value">${safe(data.sessionId || sessionId)}</span></div>
    <div><span class="label">Viewer Status:</span> <span class="status">${safe(data.viewerStatus)}</span></div>
    <div><span class="label">Health:</span> ${healthChip}</div>
    ${healthBar}
    <div><span class="label">Relay Status:</span> ${safe(data.relayStatus)}</div>
    <div><span class="label">Share Enabled:</span> ${safe(access ? access.shareEnabled : data.shareEnabled)}</div>
    <div><span class="label">Visibility:</span> ${safe(access ? access.visibility : data.visibility)}</div>
    <div><span class="label">Join Code:</span> ${safe(access ? access.joinCode : data.joinCode || joinCode)}</div>
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

function renderStatus(data, healthData, opts = {}) {
  if (data.viewerStatus === 'not_found') {
    let msg = '<span class="error">존재하지 않는 세션입니다.</span>';
    if (opts.pollError) msg += '<div class="error" style="margin-top:8px;">API 갱신 실패, 재시도 중...</div>';
    $sessionCard.innerHTML = msg;
    $snapshotSummary.innerHTML = '';
    $eventLog.innerHTML = '';
    return;
  }

  renderSessionCard(data, healthData);

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
let pollTimer = null;
let pollDelay = 1000;
let pollActive = false;

function startPolling() {
  if (pollActive) return;
  pollActive = true;
  pollLoop();
}

async function pollLoop() {
  if (!pollActive) return;
  try {
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (joinCode && (data.viewerStatus === 'invalid_code' || data.viewerStatus === 'not_shared')) {
      renderAccessError(data);
      $sessionCard.innerHTML = '<span class="label">세션 상태를 불러올 수 없습니다.</span>';
      $snapshotSummary.innerHTML = '';
      $eventLog.innerHTML = '';
      pollDelay = 3000;
      scheduleNextPoll();
      return;
    }

    clearAccessError();
    const resolvedSessionId = data.sessionId || sessionId;
    const healthData = await fetchHealth(resolvedSessionId);
    lastGoodData = data;
    renderStatus(data, healthData);
    pollDelay = 1000;
  } catch (e) {
    if (lastGoodData) {
      renderStatus(lastGoodData, null, { pollError: true });
    } else {
      $sessionCard.innerHTML = '<span class="error">API 오류: ' + (e.message || e) + '</span>';
      $snapshotSummary.innerHTML = '';
      $eventLog.innerHTML = '';
    }
    pollDelay = 3000;
  } finally {
    scheduleNextPoll();
  }
}

function scheduleNextPoll() {
  if (!pollActive) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(pollLoop, pollDelay);
}

startPolling();
