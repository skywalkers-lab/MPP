(function () {
  'use strict';

  var $roomList = document.getElementById('room-list');
  var $relayChip = document.getElementById('relay-chip');
  var $roomCount = document.getElementById('room-count');
  var $selectedRoom = document.getElementById('selected-room');
  var $joinForm = document.getElementById('join-form');
  var $passwordInput = document.getElementById('password-input');
  var $permissionCodeInput = document.getElementById('permission-code-input');
  var $refreshBtn = document.getElementById('refresh-btn');

  var selectedRoom = null;
  var roomsCache = [];

  function safe(v) {
    return v === null || v === undefined || v === '' ? '-' : String(v);
  }

  function escapeHtml(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function healthChip(level) {
    if (window.UiCommon && typeof window.UiCommon.healthChipHtml === 'function') {
      return window.UiCommon.healthChipHtml(level);
    }
    return '<span class="status-chip health-' + safe(level).toLowerCase() + '">' + safe(level) + '</span>';
  }

  function renderSelection() {
    if (!selectedRoom) {
      $selectedRoom.textContent = '왼쪽에서 Room을 선택하세요.';
      return;
    }

    var lock = selectedRoom.passwordEnabled ? '<span class="lock">lock</span>' : '<span class="lock">open</span>';
    $selectedRoom.innerHTML =
      '<strong>' + escapeHtml(selectedRoom.roomTitle) + '</strong><br/>' +
      'driver=' + escapeHtml(safe(selectedRoom.driverLabel)) +
      ' | car=' + escapeHtml(safe(selectedRoom.carLabel)) +
      ' | ' + lock +
      ' | join=' + escapeHtml(safe(selectedRoom.joinCode));
  }

  function renderRooms(rooms) {
    if (!rooms || rooms.length === 0) {
      $roomList.innerHTML = '<div class="message">현재 표시할 Room이 없습니다.</div>';
      return;
    }

    $roomList.innerHTML = rooms.map(function (room) {
      var isActive = selectedRoom && selectedRoom.joinCode === room.joinCode;
      var lock = room.passwordEnabled ? '<span class="lock">lock</span>' : '<span class="lock">open</span>';
      return '<button type="button" class="room-item' + (isActive ? ' active' : '') + '" data-join-code="' + escapeHtml(room.joinCode || '') + '">' +
        '<div class="room-title">' + escapeHtml(room.roomTitle || 'Untitled Room') + '</div>' +
        '<div class="room-meta">' +
          '<span>driver ' + escapeHtml(safe(room.driverLabel)) + '</span>' +
          '<span>car ' + escapeHtml(safe(room.carLabel)) + '</span>' +
          '<span>' + lock + '</span>' +
        '</div>' +
        '<div class="room-meta">' +
          healthChip(room.healthLevel) +
          '<span class="chip">relay ' + escapeHtml(safe(room.relayStatus)) + '</span>' +
          '<span class="chip">share ' + escapeHtml(String(room.shareEnabled)) + '</span>' +
        '</div>' +
      '</button>';
    }).join('');
  }

  function syncRelayChip(relay) {
    if (!relay) {
      $relayChip.textContent = 'relay: -';
      return;
    }
    $relayChip.textContent = 'relay: ' + safe(relay.relayLabel) + ' @ ' + safe(relay.viewerBaseUrl || relay.relayNamespace);
  }

  async function fetchRooms() {
    var res = await fetch('/api/viewer/rooms/active');
    var data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'rooms_fetch_failed');
    }

    roomsCache = data.rooms || [];
    if (!selectedRoom && roomsCache.length > 0) {
      selectedRoom = roomsCache[0];
    } else if (selectedRoom) {
      selectedRoom = roomsCache.find(function (r) { return r.joinCode === selectedRoom.joinCode; }) || null;
    }

    $roomCount.textContent = 'rooms: ' + roomsCache.length;
    syncRelayChip(data.relay);
    renderRooms(roomsCache);
    renderSelection();
  }

  $roomList.addEventListener('click', function (event) {
    var target = event.target;
    if (!(target instanceof HTMLElement)) return;

    var button = target.closest('.room-item');
    if (!button) return;

    var joinCode = button.getAttribute('data-join-code');
    selectedRoom = roomsCache.find(function (r) { return r.joinCode === joinCode; }) || null;
    renderRooms(roomsCache);
    renderSelection();
  });

  $joinForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!selectedRoom || !selectedRoom.joinCode) {
      $selectedRoom.textContent = '먼저 Room을 선택하세요.';
      return;
    }

    var params = new URLSearchParams();
    var password = ($passwordInput.value || '').trim();
    var permissionCode = ($permissionCodeInput.value || '').trim();

    if (password) params.set('password', password);
    if (permissionCode) params.set('permissionCode', permissionCode);

    var target = '/join/' + encodeURIComponent(selectedRoom.joinCode);
    if (params.toString()) {
      target += '?' + params.toString();
    }
    window.location.href = target;
  });

  $refreshBtn.addEventListener('click', function () {
    fetchRooms().catch(function (err) {
      $selectedRoom.textContent = 'Room 목록 로드 실패: ' + (err && err.message ? err.message : err);
    });
  });

  fetchRooms().catch(function (err) {
    $selectedRoom.textContent = 'Room 목록 로드 실패: ' + (err && err.message ? err.message : err);
  });

  setInterval(function () {
    fetchRooms().catch(function () {});
  }, 3000);
})();
