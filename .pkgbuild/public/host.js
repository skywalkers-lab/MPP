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
var sessionApiUrl = '/api/viewer/sessions/' + encodeURIComponent(sessionId);
var relayInfoApiUrl = '/api/viewer/relay-info';
var preset = window.UiCommon ? window.UiCommon.applyPreset('host') : 'host';

var relayInfoCache = null;
var lastReboundEventId = null;
var latestNoteContext = null;
var latestTimelineContext = null;
var messageTimer = null;

var $sessionId = document.getElementById('session-id');
var $joinCode = document.getElementById('join-code');
var $joinUrl = document.getElementById('join-url');
var $roomTitleView = document.getElementById('room-title-view');
var $roomTitle = document.getElementById('room-title');
var $roomPassword = document.getElementById('room-password');
var $permissionCode = document.getElementById('permission-code');
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
var $analysisGrid = document.getElementById('analysis-grid');

var $cmdPrimary = document.getElementById('cmd-primary');
var $cmdSecondary = document.getElementById('cmd-secondary');
var $cmdConfidence = document.getElementById('cmd-confidence');
var $cmdStability = document.getElementById('cmd-stability');
var $cmdPitEta = document.getElementById('cmd-pit-eta');
var $cmdTraffic = document.getElementById('cmd-traffic');
var $cmdStress = document.getElementById('cmd-stress');
var $cmdExec = document.getElementById('cmd-exec');
var $cmdCleanAir = document.getElementById('cmd-clean-air');
var $cmdHealth = document.getElementById('cmd-health');
var $syncBanner = document.getElementById('sync-banner');

var $driverLap = document.getElementById('driver-lap');
var $driverLapTotal = document.getElementById('driver-lap-total');
var $driverPos = document.getElementById('driver-pos');
var $driverCompound = document.getElementById('driver-compound');
var $driverTyreAge = document.getElementById('driver-tyre-age');
var $driverFuelLaps = document.getElementById('driver-fuel-laps');
var $driverFuelKg = document.getElementById('driver-fuel-kg');
var $driverErs = document.getElementById('driver-ers');
var $driverLast = document.getElementById('driver-last');
var $driverBest = document.getElementById('driver-best');

function safe(v) {
  return v === null || v === undefined ? '-' : String(v);
}

function num(v) {
  return Number.isFinite(v) ? Number(v) : null;
}

function fmtTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function fmtPct(v) {
  var n = num(v);
  if (n === null) return '-';
  return String(Math.round(Math.max(0, Math.min(100, n)))) + '%';
}

function fmtLapTime(v) {
  var n = num(v);
  if (n === null || n <= 0) return '-';
  if (window.UiCommon && typeof window.UiCommon.fmtMs === 'function') {
    return window.UiCommon.fmtMs(n);
  }
  return String(Math.round(n)) + 'ms';
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function scoreBandClass(value) {
  var n = num(value);
  if (n === null) return '';
  if (n >= 70) return 'score-urgent';
  if (n >= 40) return 'score-caution';
  return 'score-low';
}

function setMetricBand(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('score-low', 'score-caution', 'score-urgent');
  var band = scoreBandClass(value);
  if (band) el.classList.add(band);
}

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

function pitWindowEta(signals) {
  var hint = signals.pitWindowHint || 'unknown';
  var lapsRemaining = num(signals.lapsRemaining);

  if (hint === 'open_now') return 'NOW';
  if (hint === 'open_soon') return '1-2 laps';
  if (hint === 'monitor') return '3-5 laps';
  if (hint === 'too_early') return lapsRemaining !== null && lapsRemaining > 12 ? '8+ laps' : '5-8 laps';
  return '-';
}

function relayViewerBase() {
  return relayInfoCache && relayInfoCache.viewerBaseUrl
    ? String(relayInfoCache.viewerBaseUrl).replace(/\/$/, '')
    : window.location.origin;
}

function buildJoinUrl(joinCode, absolute) {
  if (!joinCode) return '-';
  var root = absolute ? relayViewerBase() : window.location.origin;
  return root + '/join/' + encodeURIComponent(joinCode);
}

function buildOverlayUrl(id) {
  return relayViewerBase() + '/overlay/' + encodeURIComponent(id) + '?preset=broadcast';
}

function applyAccess(access, joinUrlFromApi) {
  if (!access) return;

  $sessionId.textContent = 'session ' + safe(access.sessionId || sessionId);
  $joinCode.textContent = 'room ' + safe(access.joinCode);
  if ($roomTitleView) $roomTitleView.textContent = safe(access.roomTitle || '-');
  if ($roomTitle) $roomTitle.value = access.roomTitle || '';
  if ($roomPassword) $roomPassword.value = access.roomPassword || '';
  if ($permissionCode) $permissionCode.value = access.permissionCode || '';

  var shareOn = access.shareEnabled === true;
  $shareEnabled.value = String(shareOn);
  $visibility.value = access.visibility || 'private';

  $sharePill.textContent = shareOn ? 'share on' : 'share off';
  $sharePill.className = 'pill ' + (shareOn ? 'ok' : 'warn');

  $visibilityPill.textContent = access.visibility || '-';
  $visibilityPill.className = 'pill ' + (access.visibility === 'code' ? 'ok' : 'warn');

  var joinUrl = joinUrlFromApi || buildJoinUrl(access.joinCode, true);
  $joinUrl.textContent = joinUrl;
  $joinUrl.href = joinUrl;

  if ($overlayLink) {
    $overlayLink.href = buildOverlayUrl(access.sessionId || sessionId);
  }
}

function maybeShowReboundBanner(rebound) {
  if (!rebound) return;
  if (lastReboundEventId === rebound.mergedAt) return;
  lastReboundEventId = rebound.mergedAt;

  setTransientInfoMessage(
    'canonical 병합 감지: ' + safe(rebound.previousSessionId) + ' -> ' + safe(sessionId),
    7000
  );
}

function renderHealth(health) {
  var level = health && health.healthLevel ? health.healthLevel : 'connecting';

  if ($healthChip) {
    $healthChip.innerHTML = window.UiCommon
      ? window.UiCommon.healthChipHtml(level)
      : safe(level);
  }

  if ($cmdHealth) {
    $cmdHealth.className = 'status-chip health-' + level;
    $cmdHealth.textContent = window.UiCommon ? window.UiCommon.healthLabel(level) : safe(level).toUpperCase();
  }

  if ($healthBar) {
    $healthBar.innerHTML = window.UiCommon
      ? window.UiCommon.freshnessBarHtml({
          heartbeatAgeMs: health && health.heartbeatAgeMs,
          snapshotFreshnessMs: health && health.snapshotFreshnessMs,
          relayFreshnessMs: health && health.relayFreshnessMs,
        })
      : '';
  }
}

function renderRelayInfo(data) {
  if (!$relayEndpoint || !$relayStatus || !$relayMeta) return;

  if (!data) {
    relayInfoCache = null;
    $relayEndpoint.textContent = '-';
    $relayStatus.className = 'status-chip health-connecting';
    $relayStatus.textContent = 'UNKNOWN';
    $relayMeta.textContent = '-';
    return;
  }

  relayInfoCache = data;
  var label = safe(data.relayLabel || 'relay');
  var ns = safe(data.relayNamespace || data.viewerBaseUrl || '-');
  $relayEndpoint.textContent = label + ' @ ' + ns;

  var active = Number(data.activeSessions || 0);
  $relayStatus.className = 'status-chip ' + (active > 0 ? 'health-healthy' : 'health-delayed');
  $relayStatus.textContent = active > 0 ? 'CONNECTED' : 'IDLE';

  var cors = data.corsEnabled ? 'cors:on' : 'cors:off';
  var debug = data.debugHttpEnabled ? 'debug:on' : 'debug:off';
  $relayMeta.textContent =
    'ws=' + safe(data.relayWsUrl) +
    ' | viewer=' + safe(data.viewerBaseUrl) +
    ' | ' + cors + ' | ' + debug;
}

function renderDriverState(sessionData) {
  if (!sessionData || !sessionData.snapshot) {
    $driverLap.textContent = '-';
    $driverLapTotal.textContent = '-';
    $driverPos.textContent = '-';
    $driverCompound.textContent = '-';
    $driverTyreAge.textContent = 'age -';
    $driverFuelLaps.textContent = '-';
    $driverFuelKg.textContent = 'fuel -';
    $driverErs.textContent = '-';
    $driverLast.textContent = 'last -';
    $driverBest.textContent = 'best -';
    return;
  }

  var snapshot = sessionData.snapshot;
  var idx = snapshot.playerCarIndex;
  var player = snapshot.cars && idx !== null && idx !== undefined ? snapshot.cars[idx] : null;
  var meta = snapshot.sessionMeta || {};

  $driverLap.textContent = safe(player && player.currentLapNum !== undefined ? player.currentLapNum : meta.currentLap);
  $driverLapTotal.textContent = meta.totalLaps ? '/ ' + meta.totalLaps : '-';
  $driverPos.textContent = safe(player && player.position);
  $driverCompound.textContent = safe(player && player.tyreCompound);
  $driverTyreAge.textContent = player && player.tyreAgeLaps !== undefined ? 'age ' + player.tyreAgeLaps : 'age -';
  $driverFuelLaps.textContent = player && player.fuelLapsRemaining !== undefined ? safe(Number(player.fuelLapsRemaining).toFixed(1)) : '-';
  $driverFuelKg.textContent = player && player.fuelRemaining !== undefined ? 'fuel ' + Number(player.fuelRemaining).toFixed(1) : 'fuel -';
  $driverErs.textContent = player && player.ersLevel !== undefined ? fmtPct(Number(player.ersLevel) * 100) : '-';
  $driverLast.textContent = 'last ' + fmtLapTime(player && player.lastLapTimeInMs);
  $driverBest.textContent = 'best ' + fmtLapTime(player && player.bestLapTimeInMs);
}

function renderNotes(notes) {
  if (!notes || notes.length === 0) {
    latestNoteContext = null;
    $notesList.innerHTML = '<div class="note-item"><div class="note-text">엔지니어 노트가 아직 없습니다.</div></div>';
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
        '<button class="delete-note" data-note-id="' + escapeHtml(note.noteId) + '">delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function formatOpsEventText(event) {
  if (!event) return '-';
  if (event.type === 'session_rebound') {
    var prev = event.payload && event.payload.previousSessionId ? String(event.payload.previousSessionId) : '-';
    var next = event.payload && event.payload.canonicalSessionId ? String(event.payload.canonicalSessionId) : safe(event.sessionId);
    var uid = event.payload && event.payload.telemetrySessionUid ? String(event.payload.telemetrySessionUid) : '-';
    return 'session_rebound: uid=' + uid + ' ' + prev + ' -> ' + next;
  }
  if (event.type === 'session_stale') return 'session_stale: heartbeat 지연';
  if (event.type === 'session_recovered') return 'session_recovered: 연결 복구';
  if (event.type === 'share_enabled_changed') return 'share_enabled_changed';
  if (event.type === 'visibility_changed') return 'visibility_changed';
  return safe(event.type);
}

function renderTimeline(items) {
  if (!items || items.length === 0) {
    latestTimelineContext = null;
    $timelineList.innerHTML = '<div class="timeline-item"><div class="note-text">타임라인 항목이 없습니다.</div></div>';
    return;
  }

  latestTimelineContext = items[0] || null;

  $timelineList.innerHTML = items.map(function (item) {
    if (item.kind === 'note' && item.note) {
      return '<div class="timeline-item">' +
        '<div class="note-meta"><strong>note</strong><span>' + fmtTime(item.timestamp) + '</span></div>' +
        '<div class="note-text">[' + escapeHtml(item.note.authorLabel || 'Engineer') + '] ' + escapeHtml(item.note.text || '') + '</div>' +
      '</div>';
    }

    if (item.kind === 'ops_event' && item.event) {
      return '<div class="timeline-item">' +
        '<div class="note-meta"><strong>ops</strong><span>' + fmtTime(item.timestamp) + '</span></div>' +
        '<div class="note-text">' + escapeHtml(formatOpsEventText(item.event)) + '</div>' +
      '</div>';
    }

    return '';
  }).join('');
}

function renderStrategy(data) {
  if (!data) {
    $strategyCard.innerHTML = '<div class="note-item"><div class="note-text">전략 데이터를 아직 받지 못했습니다.</div></div>';
    return;
  }

  if (data.strategyUnavailable) {
    $cmdPrimary.textContent = 'Awaiting telemetry...';
    $cmdSecondary.textContent = 'secondary: -';
    $strategyCard.innerHTML = '<div class="note-item">' +
      '<div class="note-meta"><span>unavailable</span><span>' + fmtTime(data.generatedAt) + '</span></div>' +
      '<div class="note-text">reason: ' + escapeHtml(data.reason || 'unknown') + '</div>' +
      '</div>';
    if ($syncBanner) {
      $syncBanner.style.display = 'none';
    }
    return;
  }

  var signals = data.signals || {};
  var primary = data.primaryRecommendation || data.recommendation || '-';
  var secondary = data.secondaryRecommendation || '-';
  var confidence = num(data.confidenceScore);
  var stability = num(data.stabilityScore);
  var trafficRisk = num(signals.trafficRiskScore);
  var cleanAir = num(signals.cleanAirProbability);
  var tyreStress = num(signals.tyreUrgencyScore);
  var fuelStress = num(signals.fuelRiskScore);
  var degradationStress = num(signals.degradationTrend);
  var undercut = num(signals.undercutScore);
  var overcut = num(signals.overcutScore);
  var pitLoss = num(signals.pitLossHeuristic);

  var trafficExposure = trafficRisk !== null || cleanAir !== null
    ? ((trafficRisk || 50) * 0.7 + (100 - (cleanAir || 50)) * 0.3)
    : null;

  var stressIndex = tyreStress !== null || fuelStress !== null || degradationStress !== null
    ? ((tyreStress || 0) * 0.45 + (fuelStress || 0) * 0.35 + (degradationStress || 0) * 0.2)
    : null;

  var executionReadiness = undercut !== null || overcut !== null || pitLoss !== null
    ? ((undercut || 50) * 0.45 + (overcut || 50) * 0.25 + (100 - (pitLoss || 50)) * 0.3)
    : null;

  var pitEta = pitWindowEta(signals);

  $cmdPrimary.textContent = primary;
  $cmdSecondary.textContent = 'secondary: ' + secondary;
  $cmdConfidence.textContent = confidence === null ? '-' : Math.round(confidence) + '/100';
  $cmdStability.textContent = stability === null ? '-' : Math.round(stability) + '/100';
  $cmdPitEta.textContent = pitEta;
  $cmdTraffic.textContent = trafficExposure === null ? '-' : Math.round(trafficExposure) + '/100';
  $cmdStress.textContent = stressIndex === null ? '-' : Math.round(stressIndex) + '/100';
  $cmdExec.textContent = executionReadiness === null ? '-' : Math.round(executionReadiness) + '/100';
  $cmdCleanAir.textContent = cleanAir === null ? '-' : Math.round(cleanAir) + '%';

  setMetricBand('metric-confidence', confidence);
  setMetricBand('metric-stability', stability);
  setMetricBand('metric-traffic', trafficExposure);
  setMetricBand('metric-stress', stressIndex);
  setMetricBand('metric-exec', executionReadiness);
  setMetricBand('metric-clean-air', cleanAir === null ? null : 100 - cleanAir);

  if ($syncBanner) {
    $syncBanner.style.display = data.syncingCanonicalSession ? 'inline-block' : 'none';
  }

  var reasons = Array.isArray(data.reasons) ? data.reasons : [];
  var noteContext = latestNoteContext
    ? 'recent note: [' + safe(latestNoteContext.category || 'general') + '] ' + safe(latestNoteContext.text || '-')
    : 'recent note: -';
  var timelineContext = latestTimelineContext
    ? 'recent timeline: ' + safe(latestTimelineContext.kind || '-') + ' @ ' + fmtTime(latestTimelineContext.timestamp)
    : 'recent timeline: -';

  $strategyCard.innerHTML = '<div class="note-item">' +
    '<div class="note-meta"><span>severity=' + escapeHtml(safe(data.severity || '-')) + '</span><span>' + fmtTime(data.generatedAt) + '</span></div>' +
    '<div class="note-text">primary=' + escapeHtml(primary) + ' | alt=' + escapeHtml(secondary) + '</div>' +
    '<div class="note-text">changed=' + escapeHtml(String(data.recommendationChanged === true)) + ' | trend=' + escapeHtml(safe(data.trendReason || '-')) + '</div>' +
    '<div class="note-text">window=' + escapeHtml(safe(signals.pitWindowHint || '-')) + ' | rejoin=' + escapeHtml(safe(signals.rejoinRiskHint || '-')) + ' | band=' + escapeHtml(safe(signals.expectedRejoinBand || '-')) + '</div>' +
    '<div class="note-text">' + reasons.slice(0, 3).map(function (r) { return '• ' + escapeHtml(r); }).join('<br/>') + '</div>' +
    '<div class="note-text" style="margin-top:4px;color:#93a6bf;">' + escapeHtml(noteContext) + '</div>' +
    '<div class="note-text" style="color:#93a6bf;">' + escapeHtml(timelineContext) + '</div>' +
  '</div>';

  if ($analysisGrid) {
    var chips = [
      { k: 'Undercut', v: signals.undercutScore },
      { k: 'Overcut', v: signals.overcutScore },
      { k: 'Degradation', v: signals.degradationTrend },
      { k: 'Traffic Risk', v: signals.trafficRiskScore },
      { k: 'Pit Loss', v: signals.pitLossHeuristic },
      { k: 'Compound Bias', v: signals.compoundStintBias },
      { k: 'Rejoin Band', v: signals.expectedRejoinBand },
      { k: 'Clean Air Prob', v: signals.cleanAirProbability },
    ];

    $analysisGrid.innerHTML = chips.map(function (item) {
      return '<div class="metric-chip">' +
        '<strong>' + escapeHtml(item.k) + '</strong> · ' + escapeHtml(safe(item.v)) +
      '</div>';
    }).join('');
  }
}

async function fetchAccess() {
  try {
    var res = await fetch(accessApiUrl);
    var data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'not_found');
    }
    if (data.relay) {
      renderRelayInfo(data.relay);
    }
    applyAccess(data.access || data, data.joinUrl);
    maybeShowReboundBanner(data.rebound);
  } catch (err) {
    setMessage('세션 access 정보를 가져오지 못했습니다: ' + (err && err.message ? err.message : err), 'err');
  }
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

async function fetchSession() {
  var res = await fetch(sessionApiUrl);
  var data = await res.json();
  if (!res.ok && data.viewerStatus !== 'waiting') {
    throw new Error(data.error || data.viewerStatus || 'session_fetch_failed');
  }
  renderDriverState(data);
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
      roomTitle: $roomTitle ? ($roomTitle.value || '').trim() : undefined,
      roomPassword: $roomPassword ? ($roomPassword.value || '').trim() : undefined,
      permissionCode: $permissionCode ? ($permissionCode.value || '').trim() : undefined,
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

    if (data.relay) {
      renderRelayInfo(data.relay);
    }
    applyAccess(data.access || data, data.joinUrl);
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
  Promise.all([fetchNotes(), fetchTimeline(), fetchStrategy(), fetchSession()]).catch(function (err) {
    setNotesMessage('갱신 실패: ' + (err && err.message ? err.message : err), 'err');
  });
});
document.getElementById('add-note').addEventListener('click', function () {
  addNote().catch(function (err) {
    setNotesMessage('노트 추가 실패: ' + (err && err.message ? err.message : err), 'err');
  });
});
document.getElementById('copy-code').addEventListener('click', function () {
  copyText(($joinCode.textContent || '').replace(/^room\s+/, '')).catch(function () {
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
  Promise.all([
    fetchNotes(),
    fetchTimeline(),
    fetchStrategy(),
    fetchHealth(),
    fetchRelayInfo(),
    fetchSession(),
  ]).catch(function (err) {
    setNotesMessage('주기 갱신 실패: ' + (err && err.message ? err.message : err), 'err');
  });
}, 4000);

Promise.all([
  fetchAccess(),
  fetchNotes(),
  fetchTimeline(),
  fetchStrategy(),
  fetchHealth(),
  fetchRelayInfo(),
  fetchSession(),
]).catch(function (err) {
  setNotesMessage('초기 로드 실패: ' + (err && err.message ? err.message : err), 'err');
});
