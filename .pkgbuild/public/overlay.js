(function () {
  'use strict';

  // Extract sessionId from URL: /overlay/:sessionId
  var pathParts = window.location.pathname.split('/').filter(Boolean);
  var joinCode = null;
  var sessionId = null;

  // pathParts[0] === 'overlay'|'hud', pathParts[1] === sessionId
  // or pathParts[0] === 'overlay'|'hud', pathParts[1] === 'join', pathParts[2] === joinCode
  if (pathParts.length >= 3 && pathParts[1] === 'join') {
    joinCode = pathParts[2];
  } else if (pathParts.length >= 2) {
    sessionId = pathParts[1];
  }

  if (!sessionId && !joinCode) {
    document.getElementById('overlay-root').innerHTML =
      '<div class="error-msg">URL에 세션 ID가 필요합니다: /overlay/{sessionId}</div>';
    return;
  }

  var sessionApiUrl = '';
  var strategyApiUrl = '';
  var healthApiUrl = '';
  var relayInfoApiUrl = '/api/viewer/relay-info';
  var joinApiUrl = joinCode ? '/api/viewer/join/' + encodeURIComponent(joinCode) : '';
  var relayInfoCache = null;

  var $headerSession = document.getElementById('header-session');
  var $healthChip = document.getElementById('health-chip');
  var $healthBar = document.getElementById('health-bar');
  var $statLap = document.getElementById('stat-lap');
  var $statLapTotal = document.getElementById('stat-lap-total');
  var $statPos = document.getElementById('stat-pos');
  var $statTyre = document.getElementById('stat-tyre');
  var $statTyreAge = document.getElementById('stat-tyre-age');
  var $statFuel = document.getElementById('stat-fuel');
  var $statFuelLaps = document.getElementById('stat-fuel-laps');
  var $statErs = document.getElementById('stat-ers');
  var $recPrimary = document.getElementById('rec-primary');
  var $recAlt = document.getElementById('rec-alt');
  var $recSeverity = document.getElementById('rec-severity');
  var $footerSession = document.getElementById('footer-session');
  var $footerUpdated = document.getElementById('footer-updated');
  var $footerRelay = document.getElementById('footer-relay');
  var $footerSync = document.getElementById('footer-sync');
  var $presetIndicator = document.getElementById('preset-indicator');
  var $surfaceIndicator = document.getElementById('surface-indicator');

  var preset = window.UiCommon ? window.UiCommon.applyPreset('broadcast') : 'broadcast';
  var surface = window.UiCommon ? window.UiCommon.applySurface('browser') : 'browser';
  if ($presetIndicator) {
    $presetIndicator.textContent = 'preset:' + preset;
    var params = new URLSearchParams(window.location.search);
    params.set('preset', 'replay');
    $presetIndicator.href = '/archives?' + params.toString();
  }
  if ($surfaceIndicator) {
    $surfaceIndicator.textContent = 'surface:' + surface;
    $surfaceIndicator.href = '/ops';
  }

  document.title = 'Overlay — ' + (sessionId || joinCode || 'unknown');

  var TYRE_MAP = {
    soft:   { label: 'SOFT',   cls: 'compound tyre-soft' },
    medium: { label: 'MEDIUM', cls: 'compound tyre-medium' },
    hard:   { label: 'HARD',   cls: 'compound tyre-hard' },
    inter:  { label: 'INTER',  cls: 'compound tyre-inter' },
    wet:    { label: 'WET',    cls: 'compound tyre-wet' },
  };

  var HEALTH_LABELS = {
    healthy:    'HEALTHY',
    delayed:    'DELAYED',
    stale_risk: 'STALE RISK',
    stale:      'STALE',
    connecting: 'CONNECTING',
  };

  function safe(v) {
    return v === null || v === undefined ? '-' : String(v);
  }

  function fmtTimestamp(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleTimeString();
  }

  function fmtFuel(v) {
    if (v === null || v === undefined) return '-';
    var n = Number(v);
    return Number.isFinite(n) ? n.toFixed(1) : '-';
  }

  function fmtErs(v) {
    if (v === null || v === undefined) return '-';
    var n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 100) + '%' : '-';
  }

  function setHealth(level) {
    var safeLevel = HEALTH_LABELS[level] ? level : 'connecting';
    $healthChip.className = 'health-chip ' + safeLevel;
    $healthChip.textContent = HEALTH_LABELS[safeLevel] || 'UNKNOWN';
  }

  function applyHealthBar(health) {
    if (!$healthBar) return;
    if (!window.UiCommon) {
      $healthBar.textContent = '';
      return;
    }

    $healthBar.innerHTML = window.UiCommon.freshnessBarHtml({
      heartbeatAgeMs: health && health.heartbeatAgeMs,
      snapshotFreshnessMs: health && health.snapshotFreshnessMs,
      relayFreshnessMs: health && health.relayFreshnessMs,
    });
  }

  async function resolveSessionId() {
    if (sessionId) return sessionId;
    if (!joinApiUrl) return null;

    var joinRes = await fetch(joinApiUrl);
    var joinData = await joinRes.json();
    if (!joinRes.ok) {
      var message = (joinData && joinData.accessError && joinData.accessError.message)
        ? joinData.accessError.message
        : 'overlay session resolve failed';
      throw new Error(message);
    }

    if (!joinData.sessionId) {
      throw new Error('join resolve missing sessionId');
    }

    sessionId = joinData.sessionId;
    if (joinData.relay) {
      relayInfoCache = joinData.relay;
    }
    return sessionId;
  }

  async function fetchRelayInfo() {
    try {
      var relayRes = await fetch(relayInfoApiUrl);
      var relayData = await relayRes.json();
      if (relayRes.ok) {
        relayInfoCache = relayData;
      }
    } catch (_err) {
      // Keep rendering even if relay info endpoint is not reachable.
    }
  }

  function applySnapshot(snap) {
    var playerIdx = snap ? snap.playerCarIndex : null;
    var player = (snap && playerIdx != null && snap.cars) ? snap.cars[playerIdx] : null;
    var meta = snap ? snap.sessionMeta : null;

    if (player) {
      var lap = player.currentLapNum || (meta && meta.currentLap);
      $statLap.textContent = safe(lap);
      $statLapTotal.textContent = (meta && meta.totalLaps) ? '/ ' + meta.totalLaps : '';
      $statPos.textContent = safe(player.position);

      var tyreRaw = player.tyreCompound ? String(player.tyreCompound).toLowerCase() : null;
      var tyre = tyreRaw && TYRE_MAP[tyreRaw] ? TYRE_MAP[tyreRaw] : null;
      $statTyre.className = 'stat-value ' + (tyre ? tyre.cls : 'compound');
      $statTyre.textContent = tyre ? tyre.label : safe(player.tyreCompound);
      $statTyreAge.textContent = player.tyreAgeLaps != null ? player.tyreAgeLaps + ' laps' : '';

      $statFuel.textContent = fmtFuel(player.fuelRemaining);
      $statFuelLaps.textContent = player.fuelLapsRemaining != null
        ? fmtFuel(player.fuelLapsRemaining) + ' laps'
        : '';
      if (preset === 'driver_hud') {
        $statFuel.textContent = player.fuelLapsRemaining != null ? fmtFuel(player.fuelLapsRemaining) : '-';
        $statFuelLaps.textContent = '';
      }

      $statErs.textContent = fmtErs(player.ersLevel);
    } else {
      $statLap.textContent = '-';
      $statLapTotal.textContent = '';
      $statPos.textContent = '-';
      $statTyre.className = 'stat-value compound';
      $statTyre.textContent = '-';
      $statTyreAge.textContent = '';
      $statFuel.textContent = '-';
      $statFuelLaps.textContent = '';
      $statErs.textContent = '-';
    }
  }

  function applyStrategy(strategy, relayStatus) {
    if (!strategy.strategyUnavailable) {
      $recPrimary.textContent = strategy.recommendation || '-';

      var alt = strategy.secondaryRecommendation;
      if (alt) {
        $recAlt.textContent = '→ ' + alt;
        $recAlt.style.display = '';
      } else {
        $recAlt.style.display = 'none';
      }

      var sev = strategy.severity || null;
      if (sev) {
        $recSeverity.textContent = sev;
        $recSeverity.className = 'rec-severity ' + String(sev).toLowerCase();
        $recSeverity.style.display = '';
      } else {
        $recSeverity.style.display = 'none';
      }
    } else {
      $recPrimary.textContent =
        relayStatus === 'stale' || relayStatus === 'closed'
          ? 'SESSION ENDED'
          : 'Awaiting telemetry...';
      $recAlt.style.display = 'none';
      $recSeverity.style.display = 'none';
    }
  }

  function applyPresetViewRules() {
    if (preset !== 'driver_hud') {
      return;
    }
    var headerSession = document.getElementById('header-session');
    if (headerSession) {
      headerSession.style.maxWidth = '160px';
    }
  }

  async function refresh() {
    try {
      var resolvedSessionId = await resolveSessionId();
      if (!resolvedSessionId) {
        throw new Error('session not resolved');
      }

      sessionApiUrl = '/api/viewer/sessions/' + encodeURIComponent(resolvedSessionId);
      strategyApiUrl = '/api/viewer/strategy/' + encodeURIComponent(resolvedSessionId);
      healthApiUrl = '/api/viewer/health/' + encodeURIComponent(resolvedSessionId);

      var results = await Promise.all([
        fetch(sessionApiUrl).then(function (r) { return r.json(); }),
        fetch(strategyApiUrl).then(function (r) { return r.json(); }),
        fetch(healthApiUrl).then(function (r) { return r.json(); }),
        fetchRelayInfo(),
      ]);

      var sessionData = results[0];
      var strategyData = results[1];
      var healthData = results[2];

      setHealth(healthData.healthLevel || 'connecting');
      applyHealthBar(healthData || null);

      $headerSession.textContent = resolvedSessionId;
      $footerSession.textContent = joinCode
        ? ('join: ' + joinCode + ' / session: ' + resolvedSessionId)
        : ('session: ' + resolvedSessionId);
      $footerUpdated.textContent = 'updated: ' + fmtTimestamp(Date.now());
      $footerRelay.textContent = relayInfoCache
        ? ('relay: ' + safe(relayInfoCache.relayLabel || 'relay') + ' @ ' + safe(relayInfoCache.relayNamespace || relayInfoCache.viewerBaseUrl || '-'))
        : 'relay: -';
      $footerSync.textContent = strategyData && strategyData.syncingCanonicalSession
        ? 'sync: canonical merge stabilizing'
        : 'sync: stable';

      applySnapshot(sessionData.snapshot || null);
      applyStrategy(strategyData, sessionData.relayStatus);
    } catch (err) {
      setHealth('connecting');
      if ($recPrimary) {
        $recPrimary.textContent = err && err.message ? String(err.message) : 'Awaiting session...';
      }
    }
  }

  refresh();
  applyPresetViewRules();
  var refreshMs = preset === 'driver_hud' ? 1000 : (preset === 'engineer_compact' ? 1500 : 2000);
  setInterval(refresh, refreshMs);
})();
