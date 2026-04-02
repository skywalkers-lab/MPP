function getSessionIdFromPath() {
  var m = window.location.pathname.match(/\/host\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

var sessionId = getSessionIdFromPath();
var accessApiUrl = '/api/viewer/session-access/' + encodeURIComponent(sessionId);
var notesApiUrl = '/api/viewer/notes/' + encodeURIComponent(sessionId);
var timelineApiUrl = '/api/viewer/timeline/' + encodeURIComponent(sessionId) + '?limit=120';
var strategyApiUrl = '/api/viewer/strategy/' + encodeURIComponent(sessionId);

var $sessionId = document.getElementById('session-id');
var $joinCode = document.getElementById('join-code');
var $joinUrl = document.getElementById('join-url');
var $shareEnabled = document.getElementById('share-enabled');
var $visibility = document.getElementById('visibility');
var $sharePill = document.getElementById('share-pill');
var $visibilityPill = document.getElementById('visibility-pill');
var $message = document.getElementById('message');
var $noteText = document.getElementById('note-text');
var $noteAuthor = document.getElementById('note-author');
var $noteCategory = document.getElementById('note-category');
var $noteLap = document.getElementById('note-lap');
var $notesMessage = document.getElementById('notes-message');
var $notesList = document.getElementById('notes-list');
var $timelineList = document.getElementById('timeline-list');
var $strategyCard = document.getElementById('strategy-card');

function setMessage(text, type) {
  if (!text) {
    $message.innerHTML = '';
    return;
  }
  $message.innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
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
}

async function fetchAccess() {
  setMessage('', '');
  try {
    var res = await fetch(accessApiUrl);
    var data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'not_found');
    }
    applyAccess(data.access || data);
  } catch (err) {
    setMessage('세션 access 정보를 가져오지 못했습니다: ' + (err && err.message ? err.message : err), 'err');
  }
}

function renderNotes(notes) {
  if (!notes || notes.length === 0) {
    $notesList.innerHTML = '<div class="muted">아직 노트가 없습니다.</div>';
    return;
  }

  var items = notes.slice().sort(function (a, b) {
    return b.timestamp - a.timestamp;
  });

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
    $timelineList.innerHTML = '<div class="muted">타임라인 항목이 없습니다.</div>';
    return;
  }

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
        '<div class="note-text">' + escapeHtml(item.event.type) + '</div>' +
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

  $strategyCard.innerHTML = '<div class="note-item">' +
    '<div class="note-meta"><span>severity: ' + escapeHtml(sev) + '</span><span>' + fmtTime(data.generatedAt) + '</span></div>' +
    '<div class="strategy-rec sev-' + escapeHtml(sev) + '">Primary: ' + escapeHtml(primary) + '</div>' +
    '<div class="muted">Alternative: ' + escapeHtml(secondary) + '</div>' +
    '<div class="note-text">' +
      reasons.slice(0, 3).map(function (r) { return '• ' + escapeHtml(r); }).join('<br/>') +
    '</div>' +
    '<div class="metric-grid">' +
      '<div class="metric-chip">Undercut: ' + safe(signals.undercutScore) + '</div>' +
      '<div class="metric-chip">Overcut: ' + safe(signals.overcutScore) + '</div>' +
      '<div class="metric-chip">Traffic: ' + safe(signals.trafficRiskScore) + '</div>' +
      '<div class="metric-chip">Degradation: ' + safe(signals.degradationTrend) + '</div>' +
      '<div class="metric-chip">Rejoin Band: ' + safe(signals.expectedRejoinBand) + '</div>' +
      '<div class="metric-chip">Clean Air %: ' + safe(signals.cleanAirProbability) + '</div>' +
    '</div>' +
    '<div class="muted" style="margin-top:6px;">' +
      'signals: tyre=' + safe(signals.tyreUrgencyScore) +
      ', fuel=' + safe(signals.fuelRiskScore) +
      ', pit=' + safe(signals.pitWindowHint) +
      ', rejoin=' + safe(signals.rejoinRiskHint) +
    '</div>' +
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
  renderStrategy(data);
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
  Promise.all([fetchNotes(), fetchTimeline(), fetchStrategy()]).catch(function (err) {
    setNotesMessage('주기 갱신 실패: ' + (err && err.message ? err.message : err), 'err');
  });
}, 4000);

Promise.all([fetchAccess(), fetchNotes(), fetchTimeline(), fetchStrategy()]).catch(function (err) {
  setNotesMessage('초기 로드 실패: ' + (err && err.message ? err.message : err), 'err');
});
