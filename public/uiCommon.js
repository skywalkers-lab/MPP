(function () {
  'use strict';

  function safe(v) {
    return v === null || v === undefined ? '-' : String(v);
  }

  function fmtMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '-';
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
  }

  function healthLabel(level) {
    if (level === 'healthy') return 'HEALTHY';
    if (level === 'delayed') return 'DELAYED';
    if (level === 'stale_risk') return 'STALE RISK';
    if (level === 'connecting') return 'CONNECTING';
    return 'STALE';
  }

  function healthChipHtml(level) {
    var normalized = level || 'stale';
    return '<span class="status-chip health-' + normalized + '">' + healthLabel(normalized) + '</span>';
  }

  function freshnessBarHtml(metrics) {
    var hb = fmtMs(metrics && metrics.heartbeatAgeMs);
    var snap = fmtMs(metrics && metrics.snapshotFreshnessMs);
    var relay = fmtMs(metrics && metrics.relayFreshnessMs);
    return '<div class="health-bar">' +
      '<span class="health-metric">heartbeat ' + hb + '</span>' +
      '<span class="health-metric">snapshot ' + snap + '</span>' +
      '<span class="health-metric">relay ' + relay + '</span>' +
    '</div>';
  }

  function getPreset(defaultPreset) {
    var params = new URLSearchParams(window.location.search);
    var preset = params.get('preset') || defaultPreset || 'ops';
    var allowed = ['broadcast', 'ops', 'host', 'replay', 'live', 'console-live', 'console-replay'];
    if (allowed.indexOf(preset) < 0) preset = defaultPreset || 'ops';
    return preset;
  }

  function applyPreset(defaultPreset) {
    var preset = getPreset(defaultPreset);
    document.body.setAttribute('data-preset', preset);
    var node = document.querySelector('[data-role-preset]');
    if (node) {
      node.textContent = 'preset: ' + preset;
    }
    return preset;
  }

  window.UiCommon = {
    safe: safe,
    fmtMs: fmtMs,
    healthLabel: healthLabel,
    healthChipHtml: healthChipHtml,
    freshnessBarHtml: freshnessBarHtml,
    getPreset: getPreset,
    applyPreset: applyPreset,
  };
})();
