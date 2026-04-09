var archivesApiUrl = '/api/viewer/archives?limit=120';

var $archivesBody = document.getElementById('archives-body');
var $summary = document.getElementById('summary');
var $archiveSummary = document.getElementById('archive-summary');
var $timelineList = document.getElementById('timeline-list');
var $snapshotFocus = document.getElementById('snapshot-focus');
var $archiveFinalize = document.getElementById('archive-finalize');
var $timelineKind = document.getElementById('timeline-kind');

var archiveRows = [];
var selectedSessionId = null;
var selectedTimeline = [];
var preset = window.UiCommon ? window.UiCommon.applyPreset('replay') : 'replay';

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  var sec = Math.floor(ms / 1000);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}

function safe(v) {
  return v === null || v === undefined ? '-' : String(v);
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function opsEventMessage(event) {
  if (!event) return '-';
  if (event.type === 'session_rebound') {
    var prev = event.payload && event.payload.previousSessionId ? String(event.payload.previousSessionId) : '-';
    var next = event.payload && event.payload.canonicalSessionId ? String(event.payload.canonicalSessionId) : safe(event.sessionId);
    var uid = event.payload && event.payload.telemetrySessionUid ? String(event.payload.telemetrySessionUid) : '-';
    return 'canonical 병합: ' + prev + ' -> ' + next + ' (sessionUID=' + uid + ')';
  }
  if (event.type === 'session_stale') return 'heartbeat 지연으로 stale';
  if (event.type === 'session_recovered') return '연결 복구';
  if (event.type === 'session_started') return '세션 시작';
  if (event.type === 'session_closed') return '세션 종료';
  return safe(event.type);
}

function renderArchiveSummary(summary) {
  if (!summary) {
    $archiveSummary.innerHTML = '<div class="muted">아카이브를 선택하세요.</div>';
    return;
  }

  var rows = [
    ['Session', summary.sessionId],
    ['Archive ID', summary.archiveId],
    ['Started', fmtTime(summary.startedAt)],
    ['Ended', fmtTime(summary.endedAt)],
    ['Duration', fmtDuration(summary.durationMs)],
    ['Snapshots', summary.snapshotCount],
    ['Ops Events', summary.opsEventCount],
    ['Notes', summary.noteCount],
    ['Latest Sequence', summary.latestSequence],
    ['Status', summary.lastKnownStatus],
    ['Last Recommendation', summary.lastRecommendation],
    ['Join Code', summary.joinCode],
    ['Visibility', summary.visibility],
    ['Finalize Reason', summary.finalizeReason]
  ];

  $archiveSummary.innerHTML = rows.map(function (pair) {
    return '<div class="chip"><strong>' + escapeHtml(pair[0]) + '</strong>' + escapeHtml(safe(pair[1])) + '</div>';
  }).join('');
}

function renderSnapshotFocus(snapshot) {
  if (!snapshot) {
    $snapshotFocus.className = 'snapshot-focus-grid muted';
    $snapshotFocus.textContent = 'timeline에서 snapshot 항목을 클릭하세요.';
    return;
  }

  var state = snapshot.state || {};
  var playerIndex = state.playerCarIndex;
  var player = (playerIndex !== null && playerIndex !== undefined && state.cars)
    ? state.cars[playerIndex]
    : null;
  var meta = state.sessionMeta || null;
  var rec = snapshot.recommendation;

  var branding = window.MPPBranding || null;
  var tyreMarkup = branding
    ? branding.tyreBadgeHtml(player && player.tyreCompound, { compact: true })
    : escapeHtml(safe(player && player.tyreCompound));
  var weatherMarkup = branding
    ? branding.weatherBadgeHtml(meta && meta.weather, { compact: true })
    : escapeHtml(safe(meta && meta.weather));

  $snapshotFocus.className = 'snapshot-focus-grid';

  $snapshotFocus.innerHTML =
    '<div class="chip"><strong>Timestamp</strong>' + escapeHtml(fmtTime(snapshot.timestamp)) + '</div>' +
    '<div class="chip"><strong>Sequence</strong>' + escapeHtml(safe(snapshot.sequence)) + '</div>' +
    '<div class="chip"><strong>Lap</strong>' + escapeHtml(safe(player && player.currentLapNum || (meta && meta.currentLap))) + '</div>' +
    '<div class="chip"><strong>Position</strong>' + escapeHtml(safe(player && player.position)) + '</div>' +
    '<div class="chip"><strong>Tyre</strong>' + tyreMarkup + '</div>' +
    '<div class="chip"><strong>Weather</strong>' + weatherMarkup + '</div>' +
    '<div class="chip"><strong>Tyre Age</strong>' + escapeHtml(safe(player && player.tyreAgeLaps)) + ' laps</div>' +
    '<div class="chip"><strong>Fuel Remaining</strong>' + escapeHtml(safe(player && player.fuelRemaining)) + '</div>' +
    '<div class="chip"><strong>Fuel Laps</strong>' + escapeHtml(safe(player && player.fuelLapsRemaining)) + '</div>' +
    '<div class="chip"><strong>ERS</strong>' + (player && player.ersLevel != null ? Math.round(Number(player.ersLevel) * 100) + '%' : '-') + '</div>' +
    '<div class="chip"><strong>Track Lap</strong>' + escapeHtml(safe(meta && meta.currentLap)) + ' / ' + escapeHtml(safe(meta && meta.totalLaps)) + '</div>' +
    '<div class="chip" style="grid-column:span 2;">' +
      '<strong>Recommendation</strong>' +
      escapeHtml(safe(rec && (rec.primaryRecommendation || rec.recommendation))) +
      (rec && rec.severity ? ' <span class="muted">(' + escapeHtml(rec.severity) + ')</span>' : '') +
      '<div class="muted" style="margin-top:4px;">alt=' + escapeHtml(safe(rec && rec.secondaryRecommendation)) +
      ' | conf=' + escapeHtml(safe(rec && rec.confidenceScore)) +
      ' | stable=' + escapeHtml(safe(rec && rec.stabilityScore)) +
      ' | changed=' + escapeHtml(safe(rec && rec.recommendationChanged)) + '</div>' +
      '<div class="muted" style="margin-top:4px;">trend=' + escapeHtml(safe(rec && rec.trendReason)) + '</div>' +
      '<div class="muted" style="margin-top:4px;">why=' + escapeHtml(safe(rec && rec.reasons && rec.reasons.slice(0, 2).join(' | '))) + '</div>' +
    '</div>';
}

function renderTimeline(timeline) {
  selectedTimeline = Array.isArray(timeline) ? timeline : [];

  var kindFilter = $timelineKind ? $timelineKind.value : 'all';
  var rows = kindFilter && kindFilter !== 'all'
    ? selectedTimeline.filter(function (item) { return item.kind === kindFilter; })
    : selectedTimeline;

  if (!rows || rows.length === 0) {
    $timelineList.innerHTML = '<div class="muted">타임라인 항목이 없습니다.</div>';
    $timelineList.dataset.timeline = '[]';
    return;
  }

  $timelineList.dataset.timeline = JSON.stringify(rows);

  $timelineList.innerHTML = rows.map(function (item, idx) {
    if (item.kind === 'snapshot') {
      var snap = item.snapshot || {};
      var recPrimary = snap.recommendation
        ? (snap.recommendation.primaryRecommendation || snap.recommendation.recommendation)
        : null;
      var recSecondary = snap.recommendation ? snap.recommendation.secondaryRecommendation : null;
      var recConfidence = snap.recommendation ? snap.recommendation.confidenceScore : null;
      var state = snap.state || {};
      var playerIdx = state.playerCarIndex;
      var player = (playerIdx != null && state.cars) ? state.cars[playerIdx] : null;
      var lapStr = player
        ? 'L' + safe(player.currentLapNum || (state.sessionMeta && state.sessionMeta.currentLap)) +
          ' P' + safe(player.position)
        : '';

      return '<div class="timeline-item snapshot" data-kind="snapshot" data-index="' + idx + '">' +
        '<div class="tl-header">' +
          '<span class="tl-kind-badge snapshot">snapshot</span>' +
          (lapStr ? '<span class="tl-main">' + escapeHtml(lapStr) + '</span>' : '') +
          '<span class="tl-ts">' + escapeHtml(fmtTime(item.timestamp)) + '</span>' +
        '</div>' +
        '<div class="tl-sub">telemetry frame · seq=' + escapeHtml(safe(item.sequence)) +
          (recPrimary ? ' → ' + escapeHtml(recPrimary) : '') +
          (recSecondary ? ' | alt=' + escapeHtml(recSecondary) : '') +
          (recConfidence != null ? ' | conf=' + escapeHtml(String(recConfidence)) : '') +
        '</div>' +
      '</div>';
    }

    if (item.kind === 'ops_event') {
      var evType = item.event && item.event.type ? item.event.type : 'unknown';
      return '<div class="timeline-item ops_event" data-kind="ops_event" data-index="' + idx + '">' +
        '<div class="tl-header">' +
          '<span class="tl-kind-badge ops_event">ops_event</span>' +
          '<span class="tl-main">⚙ ' + escapeHtml(evType) + '</span>' +
          '<span class="tl-ts">' + escapeHtml(fmtTime(item.timestamp)) + '</span>' +
        '</div>' +
        '<div class="tl-sub">' + escapeHtml(opsEventMessage(item.event)) + '</div>' +
      '</div>';
    }

    // note
    var noteText = item.note && item.note.text ? item.note.text : '';
    var noteAuthor = item.note && item.note.authorLabel ? item.note.authorLabel : '';
    return '<div class="timeline-item note" data-kind="note" data-index="' + idx + '">' +
      '<div class="tl-header">' +
        '<span class="tl-kind-badge note">note</span>' +
        (noteAuthor ? '<span class="tl-sub">[' + escapeHtml(noteAuthor) + ']</span>' : '<span class="tl-sub">[Observer]</span>') +
        '<span class="tl-ts">' + escapeHtml(fmtTime(item.timestamp)) + '</span>' +
      '</div>' +
      '<div class="tl-main" style="margin-top:2px;">📝 ' + escapeHtml(noteText.slice(0, 120)) + '</div>' +
    '</div>';
  }).join('');
}

function renderArchiveRows(rows) {
  if (!rows || rows.length === 0) {
    $archivesBody.innerHTML = '<tr><td colspan="6" class="muted">아카이브가 없습니다.</td></tr>';
    return;
  }

  var FINALIZE_LABELS = { server_shutdown: 'shutdown', session_stale: 'stale' };

  $archivesBody.innerHTML = rows.map(function (row) {
    var finalizeLabel = FINALIZE_LABELS[row.finalizeReason] || safe(row.finalizeReason);
    var finalizeClass = 'finalize-chip ' + (row.finalizeReason || '');

    return '<tr>' +
      '<td style="font-family:monospace;font-size:11px;">' + escapeHtml(row.sessionId) + '</td>' +
      '<td>' + escapeHtml(fmtDuration(row.durationMs)) + '</td>' +
      '<td>' +
        '<div>snap: ' + escapeHtml(safe(row.snapshotCount)) + '</div>' +
        '<div class="muted">ops: ' + escapeHtml(safe(row.opsEventCount)) + ', note: ' + escapeHtml(safe(row.noteCount)) + '</div>' +
      '</td>' +
      '<td>' + escapeHtml(safe(row.lastRecommendation)) + '</td>' +
      '<td><span class="' + escapeHtml(finalizeClass) + '">' + escapeHtml(finalizeLabel) + '</span></td>' +
      '<td><button class="open-archive" data-session-id="' + escapeHtml(row.sessionId) + '">열기</button></td>' +
    '</tr>';
  }).join('');
}

async function fetchArchiveList() {
  var res = await fetch(archivesApiUrl);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'archives_fetch_failed');
  }

  archiveRows = data.archives || [];
  $summary.textContent = 'count=' + archiveRows.length + ', updated=' + new Date().toLocaleTimeString() + ', preset=' + preset;

  var q = document.getElementById('archive-search').value.trim().toLowerCase();
  var finalizeFilter = $archiveFinalize ? $archiveFinalize.value : 'all';
  var filtered = archiveRows.filter(function (r) {
    if (q && !r.sessionId.toLowerCase().includes(q)) return false;
    if (finalizeFilter !== 'all' && r.finalizeReason !== finalizeFilter) return false;
    return true;
  });
  renderArchiveRows(filtered);

  var params = new URLSearchParams(window.location.search);
  var requestedSession = params.get('session');
  if (!selectedSessionId && requestedSession) {
    selectedSessionId = requestedSession;
    await openArchive(selectedSessionId);
    return;
  }

  if (!selectedSessionId && filtered.length > 0) {
    selectedSessionId = filtered[0].sessionId;
    await openArchive(selectedSessionId);
  }
}

async function openArchive(sessionId) {
  selectedSessionId = sessionId;

  var summaryRes = await fetch('/api/viewer/archive/' + encodeURIComponent(sessionId) + '/summary');
  var summaryData = await summaryRes.json();
  if (!summaryRes.ok) {
    throw new Error(summaryData.error || 'archive_summary_failed');
  }
  renderArchiveSummary(summaryData.summary);

  var timelineRes = await fetch('/api/viewer/archive/' + encodeURIComponent(sessionId) + '/timeline?limit=1200');
  var timelineData = await timelineRes.json();
  if (!timelineRes.ok) {
    throw new Error(timelineData.error || 'archive_timeline_failed');
  }

  renderTimeline(timelineData.timeline || []);
  renderSnapshotFocus(null);
}

async function refreshAll() {
  try {
    await fetchArchiveList();
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    $summary.textContent = '로드 실패: ' + msg;
    $archiveSummary.innerHTML = '<div class="muted">' + escapeHtml(msg) + '</div>';
  }
}

document.getElementById('reload').addEventListener('click', refreshAll);

// Archive search filter
document.getElementById('archive-search').addEventListener('input', function() {
  var q = this.value.trim().toLowerCase();
  var finalizeFilter = $archiveFinalize ? $archiveFinalize.value : 'all';
  var filtered = archiveRows.filter(function (r) {
    if (q && !r.sessionId.toLowerCase().includes(q)) return false;
    if (finalizeFilter !== 'all' && r.finalizeReason !== finalizeFilter) return false;
    return true;
  });
  renderArchiveRows(filtered);
});

if ($archiveFinalize) {
  $archiveFinalize.addEventListener('change', function () {
    refreshAll();
  });
}

if ($timelineKind) {
  $timelineKind.addEventListener('change', function () {
    renderTimeline(selectedTimeline || []);
  });
}

$archivesBody.addEventListener('click', function (e) {
  if (e.target && e.target.classList && e.target.classList.contains('open-archive')) {
    var sessionId = e.target.getAttribute('data-session-id');
    if (!sessionId) return;
    openArchive(sessionId).catch(function (err) {
      var msg = err && err.message ? err.message : String(err);
      $archiveSummary.innerHTML = '<div class="muted">' + escapeHtml(msg) + '</div>';
    });
  }
});

$timelineList.addEventListener('click', function (e) {
  var node = e.target;
  while (node && node !== $timelineList && (!node.classList || !node.classList.contains('timeline-item'))) {
    node = node.parentNode;
  }

  if (!node || node === $timelineList) return;

  var idx = Number(node.getAttribute('data-index'));
  if (!Number.isFinite(idx)) return;

  var timeline;
  try {
    timeline = JSON.parse($timelineList.dataset.timeline || '[]');
  } catch (err) {
    timeline = [];
  }

  var item = timeline[idx];
  if (!item || item.kind !== 'snapshot') {
    return;
  }

  renderSnapshotFocus(item.snapshot || null);
});

refreshAll();
