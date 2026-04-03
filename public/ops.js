var sessionsApiUrl = '/api/viewer/ops/sessions';
var eventsApiUrl = '/api/viewer/ops/events/recent?limit=25';
var archivesApiUrl = '/api/viewer/archives?limit=500';

var $sessionsBody = document.getElementById('sessions-body');
var $events = document.getElementById('events');
var $summary = document.getElementById('summary');
var $statusFilter = document.getElementById('status-filter');
var $healthFilter = document.getElementById('health-filter');
var $surfaceFilter = document.getElementById('surface-filter');

var allSessions = [];
var archivedSessionIds = {};
var preset = window.UiCommon ? window.UiCommon.applyPreset('ops') : 'ops';

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function fmtAgeSeconds(ts) {
  if (!ts) return '-';
  var age = Math.round((Date.now() - ts) / 1000);
  if (age < 0) return '0s';
  return age + 's ago';
}

function safe(v) {
  return v === null || v === undefined ? '-' : String(v);
}

function relayClass(status) {
  if (status === 'active') return 'relay-active';
  if (status === 'stale') return 'relay-stale';
  return 'relay-closed';
}

function getHealthLevel(s) {
  if (s.healthLevel) return s.healthLevel;
  if (s.relayStatus !== 'active') return 'stale';
  if (!s.hasSnapshot) return 'connecting';
  var age = Date.now() - (s.lastHeartbeatAt || 0);
  if (age < 3000) return 'healthy';
  if (age < 6000) return 'delayed';
  if (age < 10000) return 'stale_risk';
  return 'stale';
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Copy failed:', err);
    return false;
  }
}

function filterSessions(sessions) {
  return sessions.filter(function (s) {
    var statusFilter = $statusFilter.value;
    var healthFilter = $healthFilter.value;
    var surfaceFilter = $surfaceFilter.value;
    var healthLevel = getHealthLevel(s);

    if (statusFilter && statusFilter !== 'all' && s.relayStatus !== statusFilter) return false;
    if (healthFilter && healthFilter !== 'all' && healthLevel !== healthFilter) return false;

    if (surfaceFilter === 'live' && !['active'].includes(s.relayStatus)) return false;
    if (surfaceFilter === 'stale' && !(healthLevel === 'stale' || healthLevel === 'stale_risk')) return false;
    if (surfaceFilter === 'archive' && !archivedSessionIds[s.sessionId]) return false;

    return true;
  });
}

function renderSummary(sessions) {
  var active = 0;
  var stale = 0;
  var closed = 0;
  var shared = 0;
  var staleRisk = 0;

  sessions.forEach(function (s) {
    if (s.relayStatus === 'active') active += 1;
    if (s.relayStatus === 'stale') stale += 1;
    if (s.relayStatus === 'closed') closed += 1;
    if (s.hasViewerAccess) shared += 1;
    if (getHealthLevel(s) === 'stale_risk') staleRisk += 1;
  });

  var archivedCount = sessions.filter(function (s) { return !!archivedSessionIds[s.sessionId]; }).length;

  $summary.textContent =
    'total ' + sessions.length +
    ' | active ' + active +
    ' | stale ' + stale +
    ' | closed ' + closed +
    ' | shared ' + shared +
    ' | archive ' + archivedCount +
    (staleRisk > 0 ? ' | ⚠ stale_risk ' + staleRisk : '');
}

function renderSessionsTable(sessions) {
  if (!sessions || sessions.length === 0) {
    $sessionsBody.innerHTML = '<tr><td colspan="11" class="muted">세션이 없습니다.</td></tr>';
    return;
  }

  var rows = sessions.map(function (s) {
    var joinUrl = buildJoinUrl(s.joinCode);
    var healthLevel = getHealthLevel(s);
    var rowClass = (healthLevel === 'stale_risk' || healthLevel === 'stale') ? ' class="row-' + healthLevel + '"' : '';
    var archiveUrl = '/archives?session=' + encodeURIComponent(s.sessionId) + '&preset=replay';
    var overlayJoinUrl = s.joinCode
      ? '/overlay/join/' + encodeURIComponent(s.joinCode) + '?preset=broadcast'
      : null;
    var shareBadgeClass = s.shareEnabled ? 'on' : 'off';
    var shareBadgeLabel = s.shareEnabled ? 'share ON' : 'share OFF';
    var freshnessHtml = window.UiCommon
      ? window.UiCommon.freshnessBarHtml({
          heartbeatAgeMs: s.heartbeatAgeMs,
          snapshotFreshnessMs: s.snapshotFreshnessMs,
          relayFreshnessMs: s.relayFreshnessMs,
        })
      : '';

    return '<tr' + rowClass + '>' +
      '<td data-label="Session">' +
        '<div style="font-family:monospace;font-size:12px;">' + escapeHtml(s.sessionId) + '</div>' +
        '<div class="muted">seq: ' + safe(s.latestSequence) + '</div>' +
      '</td>' +
      '<td data-label="Health">' +
        (window.UiCommon ? window.UiCommon.healthChipHtml(healthLevel) : safe(healthLevel)) +
        freshnessHtml +
      '</td>' +
      '<td data-label="Relay"><span class="status-chip ' + relayClass(s.relayStatus) + '">' + safe(s.relayStatus) + '</span></td>' +
      '<td data-label="Viewer">' + safe(s.viewerStatus) + '</td>' +
      '<td data-label="Share">' +
        '<div class="share-emphasis ' + shareBadgeClass + '">' + shareBadgeLabel + '</div>' +
        '<div class="' + accessClass(s.viewerAccessLabel) + '">' + safe(s.viewerAccessLabel) + '</div>' +
        '<div class="muted">shared=' + safe(s.shareEnabled) + ', ' + safe(s.visibility) + '</div>' +
      '</td>' +
      '<td data-label="Join" class="inline-actions">' +
        (s.joinCode
          ? '<div>' +
              '<a href="' + escapeHtml(joinUrl) + '" target="_blank" rel="noopener" class="mini-btn">open</a>' +
              '<button class="mini-btn copy-join" data-join-url="' + escapeHtml(joinUrl) + '">copy</button>' +
              '<div class="muted" style="font-size: 11px; word-break: break-all;">' + escapeHtml(s.joinCode) + '</div>' +
            '</div>'
          : '-') +
      '</td>' +
      '<td data-label="Notes">' +
        '<div>count: ' + safe(s.noteCount || 0) + '</div>' +
        '<div class="muted" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' +
          escapeHtml(s.latestNotePreview || '-') +
        '</div>' +
      '</td>' +
      '<td data-label="Strategy">' +
        '<div>' + safe(s.strategyLabel || '-') + '</div>' +
        '<div class="muted">alt=' + safe(s.strategySecondaryLabel || '-') + '</div>' +
        '<div class="muted">sev=' + safe(s.strategySeverity || '-') + ', traffic=' + safe(s.strategyTrafficBand || '-') + '</div>' +
        '<div class="muted">conf=' + safe(s.strategyConfidence) + ', stable=' + safe(s.strategyStability) + '</div>' +
        '<div class="muted">changed=' + safe(s.strategyChanged) + '</div>' +
        '<div class="muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">trend=' + escapeHtml(safe(s.strategyTrendReason || '-')) + '</div>' +
        '<div class="muted">generated=' + fmtTime(s.strategyGeneratedAt) + '</div>' +
      '</td>' +
      '<td data-label="Heartbeat">' +
        '<div>' + (Number.isFinite(s.heartbeatAgeMs) && s.heartbeatAgeMs >= 0 ? Math.round(s.heartbeatAgeMs / 1000) + 's ago' : fmtAgeSeconds(s.lastHeartbeatAt)) + '</div>' +
        '<div class="muted" style="font-size:11px;">' + fmtTime(s.lastHeartbeatAt) + '</div>' +
      '</td>' +
      '<td data-label="Updated">' + fmtTime(s.updatedAt) + '</td>' +
      '<td data-label="Control">' +
        '<div class="inline-actions">' +
          '<a href="/host/' + encodeURIComponent(s.sessionId) + '?preset=host" class="mini-btn">host</a>' +
          '<a href="/overlay/' + encodeURIComponent(s.sessionId) + '?preset=broadcast" class="mini-btn" target="_blank" rel="noopener">overlay</a>' +
          (overlayJoinUrl ? '<a href="' + overlayJoinUrl + '" class="mini-btn" target="_blank" rel="noopener">overlay/join</a>' : '') +
          '<a href="' + archiveUrl + '" class="mini-btn">archive</a>' +
        '</div>' +
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

async function fetchArchives() {
  var res = await fetch(archivesApiUrl);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'archives_failed');
  }

  archivedSessionIds = {};
  (data.archives || []).forEach(function (row) {
    if (row && row.sessionId) archivedSessionIds[row.sessionId] = true;
  });
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
    await Promise.all([fetchArchives(), fetchSessions(), fetchEvents()]);
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

$healthFilter.addEventListener('change', function () {
  var filtered = filterSessions(allSessions);
  renderSessionsTable(filtered);
});

$surfaceFilter.addEventListener('change', function () {
  var filtered = filterSessions(allSessions);
  renderSessionsTable(filtered);
});

// Event delegation for copy buttons
$sessionsBody.addEventListener('click', async function (e) {
  if (e.target && e.target.classList && e.target.classList.contains('copy-join')) {
    var joinUrl = e.target.getAttribute('data-join-url');
    if (joinUrl) {
      var success = await copyText(joinUrl);
      if (success) {
        var originalText = e.target.textContent;
        e.target.textContent = 'copied!';
        e.target.style.background = '#1a4d2e';
        setTimeout(function () {
          e.target.textContent = originalText;
          e.target.style.background = '';
        }, 800);
      }
    }
  }
});

refreshAll();
setInterval(refreshAll, 2500);
