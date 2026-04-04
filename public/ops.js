var sessionsApiUrl = '/api/viewer/ops/sessions';
var eventsApiUrl = '/api/viewer/ops/events/recent?limit=25';
var archivesApiUrl = '/api/viewer/archives?limit=500';
var relayInfoApiUrl = '/api/viewer/relay-info';

var $sessionsBody = document.getElementById('sessions-body');
var $events = document.getElementById('events');
var $summary = document.getElementById('summary');
var $statusFilter = document.getElementById('status-filter');
var $healthFilter = document.getElementById('health-filter');
var $surfaceFilter = document.getElementById('surface-filter');
var $relayEndpoint = document.getElementById('relay-endpoint');
var $relayDot = document.getElementById('relay-dot');
var $relayNamespace = document.getElementById('relay-namespace');

var allSessions = [];
var archivedSessionIds = {};
var reboundEventsBySession = {};
var preset = window.UiCommon ? window.UiCommon.applyPreset('ops') : 'ops';
var relayInfoCache = null;

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

function num(v) {
  return Number.isFinite(v) ? Number(v) : null;
}

function toScoreText(v) {
  var n = num(v);
  return n === null ? '-' : String(Math.round(Math.max(0, Math.min(100, n))));
}

function pitEtaFromSummary(s) {
  if (s.strategyPitWindowHint === 'open_now') return 'NOW';
  if (s.strategyPitWindowHint === 'open_soon') return '1-2 laps';
  if (s.strategyPitWindowHint === 'monitor') return '3-5 laps';
  if (s.strategyPitWindowHint === 'too_early') return '5+ laps';
  return '-';
}

function pitwallSummary(s) {
  var conf = num(s.strategyConfidence);
  var stable = num(s.strategyStability);
  var callStrength = conf !== null && stable !== null
    ? conf * 0.6 + stable * 0.4
    : conf;
  var stress = (num(s.strategyTyreUrgency) !== null || num(s.strategyFuelRisk) !== null)
    ? (num(s.strategyTyreUrgency) || 0) * 0.55 + (num(s.strategyFuelRisk) || 0) * 0.45
    : null;
  var trafficExposure = (num(s.strategyTrafficRisk) !== null || num(s.strategyCleanAirProbability) !== null)
    ? (num(s.strategyTrafficRisk) || 50) * 0.7 + (100 - (num(s.strategyCleanAirProbability) || 50)) * 0.3
    : null;

  return {
    callStrength: toScoreText(callStrength),
    stress: toScoreText(stress),
    trafficExposure: toScoreText(trafficExposure),
    pitEta: pitEtaFromSummary(s),
    lapsRemaining: num(s.strategyLapsRemaining),
  };
}

function formatOpsEventLine(e) {
  if (!e) return '-';
  if (e.type === 'session_rebound') {
    var prev = e.payload && e.payload.previousSessionId ? String(e.payload.previousSessionId) : '-';
    var next = e.payload && e.payload.canonicalSessionId ? String(e.payload.canonicalSessionId) : safe(e.sessionId);
    var uid = e.payload && e.payload.telemetrySessionUid ? String(e.payload.telemetrySessionUid) : '-';
    return '같은 경기 sessionUID(' + uid + ') 감지로 canonical 병합: ' + prev + ' -> ' + next;
  }
  if (e.type === 'session_stale') return 'heartbeat 지연으로 stale 전환';
  if (e.type === 'session_recovered') return '연결 복구로 active 전환';
  if (e.type === 'session_started') return '새 host 연결로 세션 시작';
  if (e.type === 'share_enabled_changed') return 'shareEnabled 변경';
  if (e.type === 'visibility_changed') return 'visibility 변경';
  if (e.type === 'session_closed') return '세션 종료';
  return safe(e.type);
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
  var base = relayInfoCache && relayInfoCache.viewerBaseUrl
    ? String(relayInfoCache.viewerBaseUrl).replace(/\/$/, '')
    : window.location.origin;
  return base + '/join/' + encodeURIComponent(joinCode);
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
    var pw = pitwallSummary(s);
    var reboundEvent = reboundEventsBySession[s.sessionId] || null;
    var reboundBadge = reboundEvent
      ? '<div class="muted" style="margin-top:3px;color:#9fd8ff;">merged: ' +
        escapeHtml(safe(reboundEvent.payload && reboundEvent.payload.previousSessionId)) +
        ' -> ' + escapeHtml(safe(s.sessionId)) + '</div>'
      : '';

    return '<tr' + rowClass + '>' +
      '<td data-label="Session">' +
        '<div><strong>' + escapeHtml(safe(s.roomTitle || '-')) + '</strong></div>' +
        '<div class="muted">driver=' + escapeHtml(safe(s.driverLabel || '-')) + ' · car=' + escapeHtml(safe(s.carLabel || '-')) + '</div>' +
        '<div style="font-family:monospace;font-size:12px;">' + escapeHtml(s.sessionId) + '</div>' +
        '<div class="muted">seq: ' + safe(s.latestSequence) + '</div>' +
        reboundBadge +
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
        '<div class="muted">shared=' + safe(s.shareEnabled) + ', ' + safe(s.visibility) + ', password=' + safe(s.passwordEnabled ? 'on' : 'off') + '</div>' +
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
        '<div><strong>' + safe(s.strategyLabel || '-') + '</strong></div>' +
        '<div class="muted">alt=' + safe(s.strategySecondaryLabel || '-') + ' · sev=' + safe(s.strategySeverity || '-') + '</div>' +
        '<div class="muted" title="confidence + stability + severity aggregate">call=' + pw.callStrength + '/100</div>' +
        '<div class="muted" title="tyre urgency + fuel risk + degradation 합성">stress=' + pw.stress + '/100 · traffic=' + pw.trafficExposure + '/100</div>' +
        '<div class="muted" title="pitWindowHint + pitLoss 기반 ETA">pit_eta=' + pw.pitEta + (pw.lapsRemaining !== null ? (' · laps_rem=' + pw.lapsRemaining) : '') + '</div>' +
        '<div class="muted">window=' + safe(s.strategyPitWindowHint || '-') + ', rejoin=' + safe(s.strategyRejoinRiskHint || '-') + ', band=' + safe(s.strategyTrafficBand || '-') + '</div>' +
        (s.strategySyncingCanonicalSession ? '<div class="muted" style="color:#8ad0ff;">syncing canonical session...</div>' : '') +
        '<div class="muted">changed=' + safe(s.strategyChanged) + '</div>' +
        '<div class="muted" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">trend=' + escapeHtml(safe(s.strategyTrendReason || '-')) + '</div>' +
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

  reboundEventsBySession = {};

  $events.innerHTML = events.map(function (e) {
    if (e.type === 'session_rebound' && e.sessionId) {
      reboundEventsBySession[e.sessionId] = e;
    }
    var payload = e.payload ? escapeHtml(JSON.stringify(e.payload)) : '{}';
    var eventClass = e.type === 'session_rebound' ? 'event-type rebound' : 'event-type';
    return '<div class="event-item">' +
      '<div><span class="' + eventClass + '">' + escapeHtml(e.type) + '</span> · ' + escapeHtml(e.sessionId) + '</div>' +
      '<div class="muted">' + fmtTime(e.timestamp) + '</div>' +
      '<div class="event-message">' + escapeHtml(formatOpsEventLine(e)) + '</div>' +
      '<div class="muted">payload: ' + payload + '</div>' +
    '</div>';
  }).join('');
}

function renderRelayInfo(info) {
  if (!$relayEndpoint || !$relayDot) return;
  if (!info) {
    relayInfoCache = null;
    $relayEndpoint.textContent = 'relay: -';
    $relayDot.className = 'relay-dot';
    if ($relayNamespace) $relayNamespace.textContent = 'namespace: -';
    return;
  }

  relayInfoCache = info;
  $relayEndpoint.textContent = 'relay: ' + safe(info.relayLabel || 'relay') + ' (' + safe(info.relayWsUrl || ('ws://127.0.0.1:' + safe(info.relayWsPort))) + ')';
  if ($relayNamespace) {
    $relayNamespace.textContent = 'namespace: ' + safe(info.relayNamespace || info.viewerBaseUrl || '-');
  }
  var active = Number(info.activeSessions || 0);
  $relayDot.className = 'relay-dot ' + (active > 0 ? 'connected' : 'idle');
}

async function fetchRelayInfo() {
  var res = await fetch(relayInfoApiUrl);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'relay_info_failed');
  }
  renderRelayInfo(data);
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

  if (allSessions && allSessions.length > 0) {
    var filtered = filterSessions(allSessions);
    renderSessionsTable(filtered);
  }
}

async function refreshAll() {
  try {
    await Promise.all([fetchArchives(), fetchSessions(), fetchEvents(), fetchRelayInfo()]);
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
