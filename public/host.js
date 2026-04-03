function getSessionIdFromPath() {
  var m = window.location.pathname.match(/\/host\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

var sessionId = getSessionIdFromPath();
var accessApiUrl = '/api/viewer/session-access/' + encodeURIComponent(sessionId);
var notesApiUrl = '/api/viewer/notes/' + encodeURIComponent(sessionId);
var timelineApiUrl = '/api/viewer/timeline/' + encodeURIComponent(sessionId) + '?limit=120';
var strategyApiUrl = '/api/viewer/strategy/' + encodeURIComponent(sessionId);
var healthApiUrl = '/api/viewer/health/' + encodeURIComponent(sessionId);
var relayInfoApiUrl = '/api/viewer/relay-info';
var preset = window.UiCommon ? window.UiCommon.applyPreset('host') : 'host';

var $sessionId = document.getElementById('session-id');
var $joinCode = document.getElementById('join-code');
var $joinUrl = document.getElementById('join-url');
var $shareEnabled = document.getElementById('share-enabled');
var $visibility = document.getElementById('visibility');
var $sharePill = document.getElementById('share-pill');
var $visibilityPill = document.getElementById('visibility-pill');
var $message = document.getElementById('message');
var $overlayLink = document.getElementById('overlay-link');
var $healthChip = document.getElementById('health-chip');
var $healthBar = document.getElementById('health-bar');
var $relayEndpoint = document.getElementById('relay-endpoint');
var $relayStatus = document.getElementById('relay-status');
var $relayMeta = document.getElementById('relay-meta');
var $noteText = document.getElementById('note-text');
var $noteAuthor = document.getElementById('note-author');
var $noteCategory = document.getElementById('note-category');
var $noteLap = document.getElementById('note-lap');
var $notesMessage = document.getElementById('notes-message');
var $notesList = document.getElementById('notes-list');
var $timelineList = document.getElementById('timeline-list');
var $strategyCard = document.getElementById('strategy-card');
var latestNoteContext = null;
var latestTimelineContext = null;
var messageTimer = null;
var lastReboundEventId = null;

function setMessage(text, type) {
  if (messageTimer) {
    clearTimeout(messageTimer);
    messageTimer = null;
  }
  if (!text) {
    $message.innerHTML = '';
    return;
  }
  $message.innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
}

function setTransientInfoMessage(text, ttlMs) {
  setMessage(text, 'info');
  messageTimer = setTimeout(function () {
    $message.innerHTML = '';
    messageTimer = null;
  }, ttlMs || 6000);
}

function setNotesMessage(text, type) {
  if (!text) {
    $notesMessage.innerHTML = '';
    return;
  }
  $notesMessage.innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
}

function safe(v) {
  return v === null || v === undefined ? '-' : String(v);
}

function num(v) {
  return Number.isFinite(v) ? Number(v) : null;
}

function pct(v) {
  var n = num(v);
  if (n === null) return '-';
  var clamped = Math.max(0, Math.min(100, n));
  return String(Math.round(clamped));
}

function pitWindowEta(signals) {
  var hint = signals.pitWindowHint || 'unknown';
  var lapsRemaining = num(signals.lapsRemaining);

  if (hint === 'open_now') return 'NOW';
  if (hint === 'open_soon') return '1-2 laps';
  if (hint === 'monitor') return '3-5 laps';
  if (hint === 'too_early') {
    if (lapsRemaining !== null) {
      return lapsRemaining > 12 ? '8+ laps' : '5-8 laps';
    }
    return '5+ laps';
  }
  return '-';
}

function pitwallGauge(title, subtitle, valueLabel, score) {
  var width = num(score);
  var normalizedWidth = width === null ? 0 : Math.max(0, Math.min(100, Math.round(width)));
  return '<div class="pitwall-card">' +
    '<div class="pitwall-title" title="' + escapeHtml(subtitle || '') + '">' + escapeHtml(title) + '</div>' +
    '<div class="pitwall-sub">' + escapeHtml(subtitle || '-') + '</div>' +
    '<div class="pitwall-value">' + escapeHtml(valueLabel) + '</div>' +
    '<div class="pitwall-gauge"><div class="pitwall-gauge-fill" style="width:' + escapeHtml(normalizedWidth) + '%"></div></div>' +
  '</div>';
}

function formatOpsEventText(event) {
  if (!event) return '-';
  if (event.type === 'session_rebound') {
    var prev = event.payload && event.payload.previousSessionId ? String(event.payload.previousSessionId) : '-';
    var next = event.payload && event.payload.canonicalSessionId ? String(event.payload.canonicalSessionId) : safe(event.sessionId);
    var uid = event.payload && event.payload.telemetrySessionUid ? String(event.payload.telemetrySessionUid) : '-';
    return '같은 경기 sessionUID(' + uid + ') 감지로 canonical 병합: ' + prev + ' -> ' + next;
  }
  if (event.type === 'session_stale') return '세션 heartbeat 지연으로 stale 전환';
  if (event.type === 'session_recovered') return '세션 연결이 복구되어 active 상태로 전환';
  if (event.type === 'session_started') return '새 host 연결로 세션이 시작됨';
  if (event.type === 'share_enabled_changed') return '공유 설정(shareEnabled) 변경';
  if (event.type === 'visibility_changed') return '가시성(visibility) 변경';
  return safe(event.type);
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function buildJoinUrl(joinCode) {
  return window.location.origin + '/join/' + encodeURIComponent(joinCode);
}

function buildOverlayUrl(id) {
  return window.location.origin + '/overlay/' + encodeURIComponent(id) + '?preset=broadcast';
}

function applyAccess(access) {
  if (!access) return;

  $sessionId.textContent = safe(access.sessionId || sessionId);
  $joinCode.textContent = safe(access.joinCode);

  var shareOn = access.shareEnabled === true;
  $shareEnabled.value = String(shareOn);
  $visibility.value = access.visibility || 'private';

  $sharePill.textContent = shareOn ? 'ON' : 'OFF';
  $sharePill.className = 'pill ' + (shareOn ? 'ok' : 'warn');

  $visibilityPill.textContent = access.visibility || '-';
  $visibilityPill.className = 'pill ' + (access.visibility === 'code' ? 'ok' : 'warn');

  var joinUrl = buildJoinUrl(access.joinCode);
  $joinUrl.textContent = joinUrl;
  $joinUrl.href = joinUrl;

  if ($overlayLink) {
    var overlayUrl = buildOverlayUrl(access.sessionId || sessionId);
    $overlayLink.href = overlayUrl;
  }
}

function maybeShowReboundBanner(rebound) {
  if (!rebound) return;
  if (lastReboundEventId === rebound.mergedAt) return;
  lastReboundEventId = rebound.mergedAt;

  setTransientInfoMessage(
    '같은 경기 sessionUID가 감지되어 canonical session으로 병합되었습니다. ' +
    safe(rebound.previousSessionId) + ' -> ' + safe(sessionId),
    7000
  );
}

function renderHealth(health) {
  if (!$healthChip || !$healthBar) return;

  var level = health && health.healthLevel ? health.healthLevel : 'connecting';
  $healthChip.innerHTML = window.UiCommon
    ? window.UiCommon.healthChipHtml(level)
    : safe(level);

  $healthBar.innerHTML = window.UiCommon
    ? window.UiCommon.freshnessBarHtml({
        heartbeatAgeMs: health && health.heartbeatAgeMs,
        snapshotFreshnessMs: health && health.snapshotFreshnessMs,
        relayFreshnessMs: health && health.relayFreshnessMs,
      })
    : '';
}

async function fetchAccess() {
  try {
    var res = await fetch(accessApiUrl);
    var data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'not_found');
    }
    applyAccess(data.access || data);
    maybeShowReboundBanner(data.rebound);
  } catch (err) {
    setMessage('세션 access 정보를 가져오지 못했습니다: ' + (err && err.message ? err.message : err), 'err');
  }
}

function renderRelayInfo(data) {
  if (!$relayEndpoint || !$relayStatus || !$relayMeta) return;

  if (!data) {
    $relayEndpoint.textContent = '-';
    $relayStatus.className = 'status-chip health-connecting';
    $relayStatus.textContent = 'UNKNOWN';
    $relayMeta.textContent = '-';
    return;
  }

  $relayEndpoint.textContent = safe(data.relayWsUrl || ('ws://127.0.0.1:' + safe(data.relayWsPort)));
  var active = Number(data.activeSessions || 0);
  $relayStatus.className = 'status-chip ' + (active > 0 ? 'health-healthy' : 'health-delayed');
  $relayStatus.textContent = active > 0 ? 'CONNECTED' : 'IDLE';
  $relayMeta.textContent =
    'active=' + safe(data.activeSessions) +
    ', stale=' + safe(data.staleSessions) +
    ', total=' + safe(data.totalSessions) +
    ', heartbeatTimeout=' + safe(data.heartbeatTimeoutMs) + 'ms';
}

async function fetchRelayInfo() {
  try {
    var res = await fetch(relayInfoApiUrl);
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'relay_info_failed');
    renderRelayInfo(data);
  } catch (err) {
    renderRelayInfo(null);
  }
}

function renderNotes(notes) {
  if (!notes || notes.length === 0) {
    latestNoteContext = null;
    $notesList.innerHTML = '<div class="muted">아직 노트가 없습니다.</div>';
    return;
  }

  var items = notes.slice().sort(function (a, b) {
    return b.timestamp - a.timestamp;
  });
  latestNoteContext = items[0] || null;

  $notesList.innerHTML = items.map(function (note) {
    return '<div class="note-item" data-note-id="' + escapeHtml(note.noteId) + '">' +
      '<div class="note-meta">' +
        '<span>' + escapeHtml(note.authorLabel || 'Engineer') + '</span>' +
        '<span>' + escapeHtml(note.category || 'general') + '</span>' +
        (note.lap !== undefined ? '<span>lap ' + escapeHtml(note.lap) + '</span>' : '') +
        '<span>' + fmtTime(note.timestamp) + '</span>' +
      '</div>' +
      '<div class="note-text">' + escapeHtml(note.text || '') + '</div>' +
      '<div style="margin-top: 6px;">' +
        '<button class="delete-note" data-note-id="' + escapeHtml(note.noteId) + '">삭제</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderTimeline(items) {
  if (!items || items.length === 0) {
    latestTimelineContext = null;
    $timelineList.innerHTML = '<div class="muted">타임라인 항목이 없습니다.</div>';
    return;
  }

  latestTimelineContext = items[0] || null;

  $timelineList.innerHTML = items.map(function (item) {
    if (item.kind === 'note' && item.note) {
      return '<div class="timeline-item note">' +
        '<div class="note-meta"><strong>note</strong><span>' + fmtTime(item.timestamp) + '</span></div>' +
        '<div class="note-text">[' + escapeHtml(item.note.authorLabel || 'Engineer') + '] ' + escapeHtml(item.note.text || '') + '</div>' +
      '</div>';
    }

    if (item.kind === 'ops_event' && item.event) {
      return '<div class="timeline-item ops_event">' +
        '<div class="note-meta"><strong>ops</strong><span>' + fmtTime(item.timestamp) + '</span></div>' +
        '<div class="note-text">' + escapeHtml(formatOpsEventText(item.event)) + '</div>' +
      '</div>';
    }

    return '';
  }).join('');
}

function renderStrategy(data) {
  if (!data) {
    $strategyCard.innerHTML = '<div class="muted">전략 정보를 아직 불러오지 못했습니다.</div>';
    return;
  }

  if (data.strategyUnavailable) {
    $strategyCard.innerHTML = '<div class="note-item">' +
      '<div class="note-meta"><span>unavailable</span><span>' + fmtTime(data.generatedAt) + '</span></div>' +
      '<div class="note-text">reason: ' + escapeHtml(data.reason || 'unknown') + '</div>' +
      '<div class="muted" style="margin-top:6px;">' +
        escapeHtml((data.reasons || []).join(' | ') || 'strategy generation is paused') +
      '</div>' +
    '</div>';
    return;
  }

  var sev = String(data.severity || 'info').toLowerCase();
  var reasons = Array.isArray(data.reasons) ? data.reasons : [];
  var signals = data.signals || {};
  var primary = data.primaryRecommendation || data.recommendation || 'STAY OUT';
  var secondary = data.secondaryRecommendation || '-';
  var confidence = data.confidenceScore;
  var stability = data.stabilityScore;
  var changed = data.recommendationChanged === true;
  var trendReason = data.trendReason || '-';
  var syncingCanonical = data.syncingCanonicalSession === true;
  var lapsRemaining = num(signals.lapsRemaining);
  var pitEta = pitWindowEta(signals);

  var tyreStress = num(signals.tyreUrgencyScore);
  var fuelStress = num(signals.fuelRiskScore);
  var degradationStress = num(signals.degradationTrend);
  var trafficRisk = num(signals.trafficRiskScore);
  var cleanAir = num(signals.cleanAirProbability);

  var callStrength = num(confidence) !== null && num(stability) !== null
    ? (num(confidence) * 0.6 + num(stability) * 0.4)
    : num(confidence);

  var stressIndex = tyreStress !== null || fuelStress !== null || degradationStress !== null
    ? ((tyreStress || 0) * 0.45 + (fuelStress || 0) * 0.35 + (degradationStress || 0) * 0.2)
    : null;

  var trafficExposure = trafficRisk !== null || cleanAir !== null
    ? ((trafficRisk || 50) * 0.7 + (100 - (cleanAir || 50)) * 0.3)
    : null;

  var executionReadiness = (num(signals.undercutScore) !== null || num(signals.overcutScore) !== null || num(signals.pitLossHeuristic) !== null)
    ? ((num(signals.undercutScore) || 50) * 0.45 + (num(signals.overcutScore) || 50) * 0.25 + (100 - (num(signals.pitLossHeuristic) || 50)) * 0.3)
    : null;

  var noteContext = latestNoteContext
    ? ('recent note: [' + safe(latestNoteContext.category || 'general') + '] ' + safe(latestNoteContext.text || '-'))
    : 'recent note: -';
  var timelineContext = latestTimelineContext
    ? ('recent timeline: ' + safe(latestTimelineContext.kind || '-') + ' @ ' + fmtTime(latestTimelineContext.timestamp))
    : 'recent timeline: -';

  $strategyCard.innerHTML = '<div class="note-item">' +
    '<div class="note-meta"><span>severity: ' + escapeHtml(sev) + '</span><span>' + fmtTime(data.generatedAt) + '</span></div>' +
    '<div class="strategy-rec sev-' + escapeHtml(sev) + '">Primary: ' + escapeHtml(primary) + '</div>' +
    '<div class="muted">Alternative: ' + escapeHtml(secondary) + '</div>' +
    '<div class="muted">confidence: ' + escapeHtml(safe(confidence)) + ' | stability: ' + escapeHtml(safe(stability)) + ' | changed: ' + escapeHtml(String(changed)) + '</div>' +
    '<div class="muted">trend: ' + escapeHtml(trendReason) + '</div>' +
    (syncingCanonical
      ? '<div class="muted" style="margin-top:6px;color:#8ad0ff;">syncing canonical session... recommendation stabilization active</div>'
      : '') +
    '<div class="pitwall-grid">' +
      pitwallGauge('Call Strength', 'confidence + stability + recommendation severity aggregate', safe(Math.round(num(callStrength) || 0)) + '/100', callStrength) +
      pitwallGauge('Pit Window ETA', 'tyre urgency, pit loss, trend 기반 추정 진입 타이밍', pitEta + (lapsRemaining !== null ? (' · L' + lapsRemaining + ' rem') : ''), num(signals.pitLossHeuristic) !== null ? (100 - num(signals.pitLossHeuristic)) : null) +
      pitwallGauge('Traffic Exposure', 'projected rejoin traffic risk와 clean-air probability 조합', safe(Math.round(num(trafficExposure) || 0)) + '/100', trafficExposure) +
      pitwallGauge('Tyre/Fuel Stress', 'tyre urgency + fuel risk + degradation 압력 종합 지표', safe(Math.round(num(stressIndex) || 0)) + '/100', stressIndex) +
      pitwallGauge('Execution Readiness', 'undercut/overcut 기회와 pit loss 조건을 종합한 실행 가능성', safe(Math.round(num(executionReadiness) || 0)) + '/100', executionReadiness) +
      pitwallGauge('Clean Air Probability', 'pit out 이후 클린에어 확보 예상 확률', safe(Math.round(num(cleanAir) || 0)) + '%', cleanAir) +
    '</div>' +
    '<div class="note-text">' +
      reasons.slice(0, 3).map(function (r) { return '• ' + escapeHtml(r); }).join('<br/>') +
    '</div>' +
    '<div class="metric-grid">' +
      '<div class="metric-chip">Undercut: ' + safe(signals.undercutScore) + '</div>' +
      '<div class="metric-chip">Overcut: ' + safe(signals.overcutScore) + '</div>' +
      '<div class="metric-chip">Traffic: ' + safe(signals.trafficRiskScore) + '</div>' +
      '<div class="metric-chip">Degradation: ' + safe(signals.degradationTrend) + '</div>' +
      '<div class="metric-chip">Pit Loss: ' + safe(signals.pitLossHeuristic) + '</div>' +
      '<div class="metric-chip">Compound Bias: ' + safe(signals.compoundStintBias) + '</div>' +
      '<div class="metric-chip">Rejoin Band: ' + safe(signals.expectedRejoinBand) + '</div>' +
      '<div class="metric-chip">Clean Air %: ' + safe(signals.cleanAirProbability) + '</div>' +
    '</div>' +
    '<div class="muted" style="margin-top:6px;">' +
      'signals: tyre=' + safe(signals.tyreUrgencyScore) +
      ', fuel=' + safe(signals.fuelRiskScore) +
      ', pit=' + safe(signals.pitWindowHint) +
      ', rejoin=' + safe(signals.rejoinRiskHint) +
    '</div>' +
    '<div class="muted" style="margin-top:6px;">' + escapeHtml(noteContext) + '</div>' +
    '<div class="muted">' + escapeHtml(timelineContext) + '</div>' +
  '</div>';
}

async function fetchNotes() {
  var res = await fetch(notesApiUrl);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'notes_fetch_failed');
  }
  renderNotes(data.notes || []);
}

async function addNote() {
  setNotesMessage('', '');

  var text = ($noteText.value || '').trim();
  if (!text) {
    setNotesMessage('노트 텍스트를 입력하세요.', 'err');
    return;
  }

  var lap = ($noteLap.value || '').trim();
  var body = {
    text: text,
    authorLabel: $noteAuthor.value,
    category: $noteCategory.value,
  };

  if (lap !== '') {
    body.lap = Number(lap);
  }

  var res = await fetch(notesApiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'note_add_failed');
  }

  $noteText.value = '';
  $noteLap.value = '';
  setNotesMessage('노트가 추가되었습니다.', 'ok');
  await Promise.all([fetchNotes(), fetchTimeline(), fetchStrategy()]);
}

async function deleteNote(noteId) {
  var res = await fetch(notesApiUrl + '/' + encodeURIComponent(noteId), {
    method: 'DELETE',
  });
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'note_delete_failed');
  }
  await Promise.all([fetchNotes(), fetchTimeline(), fetchStrategy()]);
}

async function fetchTimeline() {
  var res = await fetch(timelineApiUrl);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'timeline_fetch_failed');
  }
  renderTimeline(data.timeline || []);
}

async function fetchStrategy() {
  var res = await fetch(strategyApiUrl);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.reason || data.error || 'strategy_fetch_failed');
  }
  maybeShowReboundBanner(data.rebound);
  renderStrategy(data);
}

async function fetchHealth() {
  var res = await fetch(healthApiUrl);
  var data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'health_fetch_failed');
  }
  renderHealth(data);
}

async function saveAccess() {
  setMessage('', '');
  try {
    var body = {
      shareEnabled: $shareEnabled.value === 'true',
      visibility: $visibility.value,
    };
    var res = await fetch(accessApiUrl, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'update_failed');
    }

    applyAccess(data.access || data);
    setMessage('공유 설정이 업데이트되었습니다.', 'ok');
  } catch (err) {
    setMessage('공유 설정 업데이트 실패: ' + (err && err.message ? err.message : err), 'err');
  }
}

async function copyText(text) {
  if (!text || text === '-') return;
  await navigator.clipboard.writeText(text);
  setMessage('클립보드에 복사되었습니다.', 'ok');
}

document.getElementById('reload').addEventListener('click', fetchAccess);
document.getElementById('save').addEventListener('click', saveAccess);
document.getElementById('reload-notes').addEventListener('click', function () {
  Promise.all([fetchNotes(), fetchTimeline(), fetchStrategy()]).catch(function (err) {
    setNotesMessage('노트/타임라인 갱신 실패: ' + (err && err.message ? err.message : err), 'err');
  });
});
document.getElementById('add-note').addEventListener('click', function () {
  addNote().catch(function (err) {
    setNotesMessage('노트 추가 실패: ' + (err && err.message ? err.message : err), 'err');
  });
});
document.getElementById('copy-code').addEventListener('click', function () {
  copyText($joinCode.textContent).catch(function () {
    setMessage('코드 복사에 실패했습니다.', 'err');
  });
});
document.getElementById('copy-url').addEventListener('click', function () {
  copyText($joinUrl.textContent).catch(function () {
    setMessage('링크 복사에 실패했습니다.', 'err');
  });
});

$notesList.addEventListener('click', function (e) {
  if (e.target && e.target.classList && e.target.classList.contains('delete-note')) {
    var noteId = e.target.getAttribute('data-note-id');
    if (!noteId) return;
    deleteNote(noteId).catch(function (err) {
      setNotesMessage('노트 삭제 실패: ' + (err && err.message ? err.message : err), 'err');
    });
  }
});

$sessionId.textContent = sessionId || '-';
setInterval(function () {
  Promise.all([fetchNotes(), fetchTimeline(), fetchStrategy(), fetchHealth(), fetchRelayInfo()]).catch(function (err) {
    setNotesMessage('주기 갱신 실패: ' + (err && err.message ? err.message : err), 'err');
  });
}, 4000);

Promise.all([fetchAccess(), fetchNotes(), fetchTimeline(), fetchStrategy(), fetchHealth(), fetchRelayInfo()]).catch(function (err) {
  setNotesMessage('초기 로드 실패: ' + (err && err.message ? err.message : err), 'err');
});
