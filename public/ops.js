var sessionsApiUrl = '/api/viewer/ops/sessions';
var eventsApiUrl = '/api/viewer/ops/events/recent?limit=25';

var $sessionsBody = document.getElementById('sessions-body');
var $events = document.getElementById('events');
var $summary = document.getElementById('summary');
var $statusFilter = document.getElementById('status-filter');

var allSessions = [];

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function safe(v) {
  return v === null || v === undefined ? '-' : String(v);
}

function relayClass(status) {
  if (status === 'active') return 'relay-active';
  if (status === 'stale') return 'relay-stale';
  return 'relay-closed';
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function accessClass(label) {
  if (label === 'shared') return 'access-shared';
  if (label === 'private') return 'access-private';
  return 'access-not_shared';
}

function buildJoinUrl(joinCode) {
  if (!joinCode) return '-';
  return window.location.origin + '/join/' + encodeURIComponent(joinCode);
}

function filterSessions(sessions) {
  var filter = $statusFilter.value;
  if (!filter || filter === 'all') return sessions;
  return sessions.filter(function (s) {
    return s.relayStatus === filter;
  });
}

function renderSummary(sessions) {
  var active = 0;
  var stale = 0;
  var closed = 0;
  var shared = 0;

  sessions.forEach(function (s) {
    if (s.relayStatus === 'active') active += 1;
    if (s.relayStatus === 'stale') stale += 1;
    if (s.relayStatus === 'closed') closed += 1;
    if (s.hasViewerAccess) shared += 1;
  });

  $summary.textContent =
    'total ' + sessions.length +
    ' | active ' + active +
    ' | stale ' + stale +
    ' | closed ' + closed +
    ' | shared ' + shared;
}

function renderSessionsTable(sessions) {
  if (!sessions || sessions.length === 0) {
    $sessionsBody.innerHTML = '<tr><td colspan="9" class="muted">세션이 없습니다.</td></tr>';
    return;
  }

  var rows = sessions.map(function (s) {
    var joinUrl = buildJoinUrl(s.joinCode);
    var joinCell = s.joinCode
      ? '<div>' + escapeHtml(s.joinCode) + '</div><div class="muted">' + escapeHtml(joinUrl) + '</div>'
      : '-';

    return '<tr>' +
      '<td data-label="Session">' +
        '<div>' + escapeHtml(s.sessionId) + '</div>' +
        '<div class="muted">seq: ' + safe(s.latestSequence) + '</div>' +
      '</td>' +
      '<td data-label="Relay"><span class="status-chip ' + relayClass(s.relayStatus) + '">' + safe(s.relayStatus) + '</span></td>' +
      '<td data-label="Viewer">' + safe(s.viewerStatus) + '</td>' +
      '<td data-label="Share">' +
        '<div class="' + accessClass(s.viewerAccessLabel) + '">' + safe(s.viewerAccessLabel) + '</div>' +
        '<div class="muted">enabled=' + safe(s.shareEnabled) + ', visibility=' + safe(s.visibility) + '</div>' +
      '</td>' +
      '<td data-label="Join">' + joinCell + '</td>' +
      '<td data-label="Snapshot">' + (s.hasSnapshot ? 'yes' : 'no') + '</td>' +
      '<td data-label="Heartbeat">' + fmtTime(s.lastHeartbeatAt) + '</td>' +
      '<td data-label="Updated">' + fmtTime(s.updatedAt) + '</td>' +
      '<td data-label="Control">' +
        '<a href="/host/' + encodeURIComponent(s.sessionId) + '">host</a>' +
      '</td>' +
    '</tr>';
  }).join('');

  $sessionsBody.innerHTML = rows;
}

function renderEvents(events) {
  if (!events || events.length === 0) {
    $events.innerHTML = '<div class="muted">운영 이벤트가 없습니다.</div>';
    return;
  }

  $events.innerHTML = events.map(function (e) {
    var payload = e.payload ? escapeHtml(JSON.stringify(e.payload)) : '{}';
    return '<div class="event-item">' +
      '<div><span class="event-type">' + escapeHtml(e.type) + '</span> · ' + escapeHtml(e.sessionId) + '</div>' +
      '<div class="muted">' + fmtTime(e.timestamp) + '</div>' +
      '<div class="muted">payload: ' + payload + '</div>' +
    '</div>';
  }).join('');
}

async function fetchSessions() {
  var res = await fetch(sessionsApiUrl);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'ops_sessions_failed');
  }
  allSessions = data.sessions || [];
  var filtered = filterSessions(allSessions);
  renderSummary(allSessions);
  renderSessionsTable(filtered);
}

async function fetchEvents() {
  var res = await fetch(eventsApiUrl);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'ops_events_failed');
  }
  renderEvents(data.events || []);
}

async function refreshAll() {
  try {
    await Promise.all([fetchSessions(), fetchEvents()]);
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    $events.innerHTML = '<div class="muted">데이터 로드 실패: ' + escapeHtml(msg) + '</div>';
  }
}

document.getElementById('refresh').addEventListener('click', refreshAll);
$statusFilter.addEventListener('change', function () {
  var filtered = filterSessions(allSessions);
  renderSessionsTable(filtered);
});

refreshAll();
setInterval(refreshAll, 2500);
