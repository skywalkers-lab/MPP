function getSessionIdFromPath() {
  var m = window.location.pathname.match(/\/host\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

var sessionId = getSessionIdFromPath();
var accessApiUrl = '/api/viewer/session-access/' + encodeURIComponent(sessionId);

var $sessionId = document.getElementById('session-id');
var $joinCode = document.getElementById('join-code');
var $joinUrl = document.getElementById('join-url');
var $shareEnabled = document.getElementById('share-enabled');
var $visibility = document.getElementById('visibility');
var $sharePill = document.getElementById('share-pill');
var $visibilityPill = document.getElementById('visibility-pill');
var $message = document.getElementById('message');

function setMessage(text, type) {
  if (!text) {
    $message.innerHTML = '';
    return;
  }
  $message.innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
}

function safe(v) {
  return v === null || v === undefined ? '-' : String(v);
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

$sessionId.textContent = sessionId || '-';
fetchAccess();
