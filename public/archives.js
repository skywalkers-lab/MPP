var archivesApiUrl = '/api/viewer/archives?limit=120';

var $archivesBody = document.getElementById('archives-body');
var $summary = document.getElementById('summary');
var $archiveSummary = document.getElementById('archive-summary');
var $timelineList = document.getElementById('timeline-list');
var $snapshotFocus = document.getElementById('snapshot-focus');

var archiveRows = [];
var selectedSessionId = null;

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
    $snapshotFocus.innerHTML = '<div class="muted">timeline에서 snapshot 항목을 선택하세요.</div>';
    return;
  }

  var state = snapshot.state || {};
  var playerIndex = state.playerCarIndex;
  var player = playerIndex !== null && playerIndex !== undefined ? state.cars && state.cars[playerIndex] : null;

  $snapshotFocus.innerHTML = '<div class="chip"><strong>Timestamp</strong>' + escapeHtml(fmtTime(snapshot.timestamp)) + '</div>' +
    '<div class="chip"><strong>Sequence</strong>' + escapeHtml(safe(snapshot.sequence)) + '</div>' +
    '<div class="chip"><strong>Lap</strong>' + escapeHtml(safe(player && player.currentLapNum)) + '</div>' +
    '<div class="chip"><strong>Position</strong>' + escapeHtml(safe(player && player.position)) + '</div>' +
    '<div class="chip"><strong>Tyre Age</strong>' + escapeHtml(safe(player && player.tyreAgeLaps)) + '</div>' +
    '<div class="chip"><strong>Fuel Laps</strong>' + escapeHtml(safe(player && player.fuelLapsRemaining)) + '</div>' +
    '<div class="chip"><strong>Track Lap</strong>' + escapeHtml(safe(state.sessionMeta && state.sessionMeta.currentLap)) + '</div>' +
    '<div class="chip"><strong>Recommendation</strong>' + escapeHtml(safe(snapshot.recommendation && snapshot.recommendation.recommendation)) + '</div>';
}

function renderTimeline(timeline) {
  if (!timeline || timeline.length === 0) {
    $timelineList.innerHTML = '<div class="muted">타임라인 항목이 없습니다.</div>';
    return;
  }

  $timelineList.innerHTML = timeline.map(function (item, idx) {
    if (item.kind === 'snapshot') {
      var rec = item.snapshot && item.snapshot.recommendation ? item.snapshot.recommendation.recommendation : null;
      return '<div class="timeline-item snapshot" data-kind="snapshot" data-index="' + idx + '">' +
        '<div class="pill">snapshot</div>' +
        '<div style="margin-top:6px;">seq=' + escapeHtml(safe(item.sequence)) + ', ts=' + escapeHtml(fmtTime(item.timestamp)) + '</div>' +
        '<div class="muted">recommendation=' + escapeHtml(safe(rec)) + '</div>' +
      '</div>';
    }

    if (item.kind === 'ops_event') {
      return '<div class="timeline-item ops_event" data-kind="ops_event" data-index="' + idx + '">' +
        '<div class="pill">ops_event</div>' +
        '<div style="margin-top:6px;">' + escapeHtml(safe(item.event && item.event.type)) + '</div>' +
        '<div class="muted">' + escapeHtml(fmtTime(item.timestamp)) + '</div>' +
      '</div>';
    }

    return '<div class="timeline-item note" data-kind="note" data-index="' + idx + '">' +
      '<div class="pill">note</div>' +
      '<div style="margin-top:6px;">[' + escapeHtml(safe(item.note && item.note.authorLabel)) + '] ' + escapeHtml(safe(item.note && item.note.text)) + '</div>' +
      '<div class="muted">' + escapeHtml(fmtTime(item.timestamp)) + '</div>' +
    '</div>';
  }).join('');

  $timelineList.dataset.timeline = JSON.stringify(timeline);
}

function renderArchiveRows(rows) {
  if (!rows || rows.length === 0) {
    $archivesBody.innerHTML = '<tr><td colspan="6" class="muted">아카이브가 없습니다.</td></tr>';
    return;
  }

  $archivesBody.innerHTML = rows.map(function (row) {
    return '<tr>' +
      '<td>' + escapeHtml(row.sessionId) + '</td>' +
      '<td>' + escapeHtml(fmtTime(row.endedAt)) + '</td>' +
      '<td>' + escapeHtml(fmtDuration(row.durationMs)) + '</td>' +
      '<td>snap=' + escapeHtml(safe(row.snapshotCount)) + ', ops=' + escapeHtml(safe(row.opsEventCount)) + ', note=' + escapeHtml(safe(row.noteCount)) + '</td>' +
      '<td>' + escapeHtml(safe(row.lastRecommendation)) + '</td>' +
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
  $summary.textContent = 'count=' + archiveRows.length + ', updated=' + new Date().toLocaleTimeString();
  renderArchiveRows(archiveRows);

  if (!selectedSessionId && archiveRows.length > 0) {
    selectedSessionId = archiveRows[0].sessionId;
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
