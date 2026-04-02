(function () {
  'use strict';

  // Extract sessionId from URL: /overlay/:sessionId
  var pathParts = window.location.pathname.split('/').filter(Boolean);
  // pathParts[0] === 'overlay', pathParts[1] === sessionId
  var sessionId = pathParts.length >= 2 ? pathParts[1] : null;

  if (!sessionId) {
    document.getElementById('overlay-root').innerHTML =
      '<div class="error-msg">URL에 세션 ID가 필요합니다: /overlay/{sessionId}</div>';
    return;
  }

  var sessionApiUrl = '/api/viewer/sessions/' + encodeURIComponent(sessionId);
  var strategyApiUrl = '/api/viewer/strategy/' + encodeURIComponent(sessionId);
  var healthApiUrl = '/api/viewer/health/' + encodeURIComponent(sessionId);

  var $headerSession = document.getElementById('header-session');
  var $healthChip = document.getElementById('health-chip');
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

  document.title = 'Overlay — ' + sessionId;

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

  async function refresh() {
    try {
      var results = await Promise.all([
        fetch(sessionApiUrl).then(function (r) { return r.json(); }),
        fetch(strategyApiUrl).then(function (r) { return r.json(); }),
        fetch(healthApiUrl).then(function (r) { return r.json(); }),
      ]);

      var sessionData = results[0];
      var strategyData = results[1];
      var healthData = results[2];

      setHealth(healthData.healthLevel || 'connecting');

      $headerSession.textContent = sessionId;
      $footerSession.textContent = 'session: ' + sessionId;
      $footerUpdated.textContent = 'updated: ' + fmtTimestamp(Date.now());

      applySnapshot(sessionData.snapshot || null);
      applyStrategy(strategyData, sessionData.relayStatus);
    } catch (err) {
      setHealth('connecting');
    }
  }

  refresh();
  setInterval(refresh, 2000);
})();
