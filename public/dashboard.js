// F1 25 Local Pitwall Dashboard - SPA JS
// 엔지니어링 중심, null-safe, polling 기반

const API_URL = '/state';
const POLL_INTERVAL = 1500; // ms

let lastState = null;
let pollTimer = null;

function $(id) { return document.getElementById(id); }

function setStatus(msg, isError = false) {
  const status = $("status");
  status.textContent = msg;
  status.style.color = isError ? '#ff5252' : '#ffd600';
}

function setLastUpdated(ts) {
  const el = $("last-updated");
  if (el) el.textContent = ts ? `업데이트: ${ts}` : '';
}

function fetchState() {
  setStatus('데이터 갱신 중...');
  fetch(API_URL)
    .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
    .then(state => {
      lastState = state;
      renderAll(state);
      setStatus('정상');
      setLastUpdated(new Date().toLocaleTimeString());
    })
    .catch(err => {
      setStatus('데이터 수신 실패', true);
      setLastUpdated('');
      renderAll(null);
    });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(fetchState, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
}

function renderAll(state) {
  renderTimingBoard(state);
  renderPlayerFocus(state);
  renderTyreFuelDamage(state);
  renderEventLog(state);
}

function renderTimingBoard(state) {
  const el = $("timing-board");
  if (!state || !state.timingBoard || !Array.isArray(state.timingBoard)) {
    el.innerHTML = '<div class="muted">타이밍 데이터 없음</div>';
    return;
  }
  const rows = state.timingBoard.map(driver => {
    const isPlayer = driver.isPlayer ? 'player-row' : '';
    const pit = driver.inPit ? '<span class="badge-pit">PIT</span>' : '';
    const penalty = driver.penalty ? `<span class="badge-penalty">${driver.penalty}</span>` : '';
    const tyre = renderTyreCompound(driver.tyre);
    return `<tr class="${isPlayer}">
      <td>${driver.position ?? ''}</td>
      <td>${driver.name ?? ''}</td>
      <td>${driver.team ?? ''}</td>
      <td>${driver.gap ?? ''}</td>
      <td>${driver.bestLap ?? ''}</td>
      <td>${tyre}</td>
      <td>${pit}${penalty}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="timing-table">
    <thead><tr><th>Pos</th><th>드라이버</th><th>팀</th><th>Gap</th><th>BestLap</th><th>타이어</th><th>상태</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderTyreCompound(tyre) {
  if (!tyre) return '<span class="muted">-</span>';
  if (window.MPPBranding) {
    return window.MPPBranding.tyreBadgeHtml(tyre, { compact: true });
  }
  const map = {
    'Soft': 'tyre-soft',
    'Medium': 'tyre-medium',
    'Hard': 'tyre-hard',
    'Inter': 'tyre-inter',
    'Wet': 'tyre-wet',
  };
  const cls = map[tyre] || '';
  return `<span class="${cls}">${tyre}</span>`;
}

function renderPlayerFocus(state) {
  const el = $("player-focus");
  if (!state || !state.player) {
    el.innerHTML = '<div class="muted">플레이어 데이터 없음</div>';
    return;
  }
  const p = state.player;
  el.innerHTML = `
    <div><b>${p.name ?? ''}</b> (${p.team ?? ''}) - P${p.position ?? ''}</div>
    <div>랩: ${p.lap ?? '-'} / ${state.session?.totalLaps ?? '-'}</div>
    <div>타이어: ${renderTyreCompound(p.tyre)}</div>
    <div>최고랩: ${p.bestLap ?? '-'}</div>
    <div>피트: ${p.inPit ? '<span class="badge-pit">IN PIT</span>' : '아님'}</div>
    <div>페널티: ${p.penalty ?? '없음'}</div>
  `;
}

function renderTyreFuelDamage(state) {
  const el = $("tyre-fuel-damage");
  if (!state || !state.player) {
    el.innerHTML = '<div class="muted">데이터 없음</div>';
    return;
  }
  const p = state.player;
  el.innerHTML = `
    <div>연료: <b>${p.fuel ?? '-'} L</b></div>
    <div>ERS: <b>${p.ers ?? '-'} %</b></div>
    <div>타이어 마모: <b>${p.tyreWear?.join(' / ') ?? '-'}</b></div>
    <div>데미지: ${renderDamageBar(p.damage)}</div>
  `;
}

function renderDamageBar(damage) {
  if (!damage) return '<span class="muted">-</span>';
  const val = typeof damage === 'number' ? damage : 0;
  let cls = 'low';
  if (val > 50) cls = 'high';
  else if (val > 20) cls = 'med';
  return `<span class="damage-bar ${cls}"></span> <span>${val}%</span>`;
}

function renderEventLog(state) {
  const el = $("event-log");
  if (!state || !Array.isArray(state.events) || state.events.length === 0) {
    el.innerHTML = '<div class="muted">최근 이벤트 없음</div>';
    return;
  }
  el.innerHTML = state.events.map(ev =>
    `<div>[${ev.time ?? '-'}] <b>${ev.type ?? ''}</b> ${ev.detail ?? ''}</div>`
  ).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  $("refresh-btn").addEventListener('click', fetchState);
  fetchState();
  startPolling();
});
