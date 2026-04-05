(function () {
  'use strict';

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function topNavBar(config) {
    return '<header class="top-nav">' +
      '<div class="brand-title">' + esc(config && config.title || 'MPP Strategic Console') + '</div>' +
      '<div class="top-meta">' + esc(config && config.meta || '') + '</div>' +
    '</header>';
  }

  function leftRailNav(items, activeKey) {
    var content = (items || []).map(function (item) {
      var active = item.key === activeKey ? ' active' : '';
      return '<button class="rail-item' + active + '">' + esc(item.label) + '</button>';
    }).join('');
    return '<aside class="left-rail-nav">' + content + '</aside>';
  }

  function panel(title, bodyHtml) {
    return '<section class="console-panel">' +
      '<div class="panel-head">' + esc(title || '') + '</div>' +
      '<div class="panel-body">' + (bodyHtml || '') + '</div>' +
    '</section>';
  }

  function statBlock(label, value, sublabel) {
    return '<div class="stat-block">' +
      '<div class="stat-label">' + esc(label || '') + '</div>' +
      '<div class="stat-value">' + esc(value || '-') + '</div>' +
      (sublabel ? '<div class="stat-label">' + esc(sublabel) + '</div>' : '') +
    '</div>';
  }

  function badge(text, tone) {
    return '<span class="badge' + (tone ? ' ' + esc(tone) : '') + '">' + esc(text || '') + '</span>';
  }

  function pill(text, tone) {
    return '<span class="pill' + (tone ? ' ' + esc(tone) : '') + '">' + esc(text || '') + '</span>';
  }

  function healthChip(level, text) {
    var normalized = level || 'health-connecting';
    return '<span class="health-chip ' + esc(normalized) + '">' + esc(text || 'connecting') + '</span>';
  }

  function eventRow(time, text) {
    return '<div class="event-row">' +
      '<div class="event-time">' + esc(time || '--:--:--') + '</div>' +
      '<div>' + esc(text || '') + '</div>' +
    '</div>';
  }

  function tacticalCard(title, content) {
    return '<article class="tactical-card">' +
      '<div class="stat-label">' + esc(title || '') + '</div>' +
      '<div>' + esc(content || '') + '</div>' +
    '</article>';
  }

  function dataTableRow(cells) {
    var content = (cells || []).map(function (cell) {
      return '<div>' + esc(cell) + '</div>';
    }).join('');
    return '<div class="data-table-row"><div class="event-time">ROW</div><div>' + content + '</div></div>';
  }

  function actionButton(text, tone, attrs) {
    return '<button class="action-button' + (tone ? ' ' + esc(tone) : '') + '" ' + (attrs || '') + '>' + esc(text || '') + '</button>';
  }

  function timelineScrubber(id, value, min, max) {
    return '<div class="timeline-scrubber">' +
      '<input id="' + esc(id || 'timeline-scrubber') + '" class="scrubber-track" type="range" min="' +
      esc(min == null ? 0 : min) + '" max="' + esc(max == null ? 100 : max) + '" value="' + esc(value == null ? 0 : value) + '" />' +
    '</div>';
  }

  function graphContainer(title) {
    return '<div class="graph-container">' +
      '<div class="stat-label">' + esc(title || 'graph') + '</div>' +
      '<div class="stat-label">sync telemetry surface</div>' +
    '</div>';
  }

  function strategyCard(title, lineA, lineB) {
    return '<div class="strategy-card">' +
      '<div class="stat-label">' + esc(title || '') + '</div>' +
      '<div class="stat-value" style="font-size:20px">' + esc(lineA || '-') + '</div>' +
      '<div class="stat-label">' + esc(lineB || '') + '</div>' +
    '</div>';
  }

  function navTabs(tabs, activeKey) {
    var content = (tabs || []).map(function (tab) {
      var key = tab && tab.key ? tab.key : '';
      var label = tab && tab.label ? tab.label : key;
      var active = key === activeKey ? ' active' : '';
      return '<button class="console-nav-tab' + active + '" type="button" data-tab-key="' + esc(key) + '">' + esc(label) + '</button>';
    }).join('');
    return '<div class="console-nav-tabs">' + content + '</div>';
  }

  function iconRail(topItems, bottomItems) {
    function itemHtml(item, extraClass) {
      var icon = item && item.icon ? item.icon : '•';
      var label = item && item.label ? item.label : '';
      var active = item && item.active ? ' active' : '';
      var key = item && item.key ? item.key : (label || icon || 'item');
      return '<button class="icon-rail-item ' + (extraClass || '') + active + '" type="button" data-rail-key="' + esc(String(key).toLowerCase()) + '">' +
        '<span class="icon-rail-glyph">' + esc(icon) + '</span>' +
        '<span class="icon-rail-label">' + esc(label) + '</span>' +
      '</button>';
    }

    return '<aside class="icon-rail">' +
      '<div class="icon-rail-avatar">MP</div>' +
      (topItems || []).map(function (item) { return itemHtml(item); }).join('') +
      '<div class="icon-rail-sep"></div>' +
      (bottomItems || []).map(function (item) { return itemHtml(item, 'bottom'); }).join('') +
    '</aside>';
  }

  function driverSelector(label, teamLabel) {
    return '<div class="driver-selector-bar">' +
      '<div class="driver-selector-label">' + esc(label || '-') + '</div>' +
      '<div class="driver-selector-team">' + esc(teamLabel || '-') + '</div>' +
    '</div>';
  }

  function vitalRow(label, value, tone) {
    var toneClass = tone ? ' vital-tone-' + esc(tone) : '';
    return '<div class="vital-row">' +
      '<span class="vital-label">' + esc(label || '') + '</span>' +
      '<span class="vital-value' + toneClass + '">' + esc(value || '-') + '</span>' +
    '</div>';
  }

  function compoundTag(compound) {
    var value = String(compound || '-').toUpperCase();
    var key = value.charAt(0);
    var cls = 'compound-tag compound-tag-' + (key || 'X');
    return '<span class="' + esc(cls) + '">' + esc(value) + '</span>';
  }

  function tyreQuad(temps, wears, compound) {
    var labels = ['FL', 'FR', 'RL', 'RR'];
    var cells = labels.map(function (label, i) {
      var temp = Array.isArray(temps) && Number.isFinite(temps[i]) ? Math.round(temps[i]) + 'C' : '--';
      var wear = Array.isArray(wears) && Number.isFinite(wears[i]) ? Math.round(wears[i]) + '%' : '--';
      return '<div class="tyre-cell">' +
        '<div class="tyre-cell-head"><span class="tyre-cell-label">' + esc(label) + '</span>' + (i === 0 ? compoundTag(compound) : '') + '</div>' +
        '<div class="tyre-cell-temp">' + esc(temp) + '</div>' +
        '<div class="tyre-cell-carcass">wear ' + esc(wear) + '</div>' +
      '</div>';
    }).join('');

    return '<div class="tyre-quad">' + cells + '</div>';
  }

  function circuitSvg(rows, playerPos) {
    var maxPos = Math.max(1, rows && rows.length ? rows.length : 20);
    var markers = (rows || []).slice(0, 10).map(function (row) {
      var position = Number.isFinite(row.position) ? row.position : 20;
      var angle = ((position - 1) / maxPos) * Math.PI * 2 - Math.PI / 2;
      var x = 150 + Math.cos(angle) * 96;
      var y = 150 + Math.sin(angle) * 74;
      var isPlayer = position === playerPos;
      return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (isPlayer ? '4.2' : '3') + '" class="' + (isPlayer ? 'circuit-dot player' : 'circuit-dot') + '" />';
    }).join('');

    return '<svg class="circuit-svg" viewBox="0 0 300 300" role="img" aria-label="circuit map">' +
      '<ellipse cx="150" cy="150" rx="110" ry="84" class="circuit-track-outline" />' +
      '<ellipse cx="150" cy="150" rx="96" ry="72" class="circuit-track-inner" />' +
      '<line x1="150" y1="30" x2="150" y2="270" class="circuit-sector-line" />' +
      '<line x1="40" y1="150" x2="260" y2="150" class="circuit-sector-line" />' +
      '<circle cx="150" cy="150" r="3" class="circuit-center" />' +
      markers +
    '</svg>';
  }

  function trackOverlayCard(title, rows) {
    var content = (rows || []).map(function (row) {
      return '<div class="overlay-card-row"><span>' + esc(row.key || '-') + '</span><span>' + esc(row.value || '-') + '</span></div>';
    }).join('');
    return '<article class="track-overlay-card">' +
      '<div class="overlay-card-title">' + esc(title || '-') + '</div>' +
      content +
    '</article>';
  }

  function degradationCurve(tyreAge, urgency, pitWindowLap, totalLaps) {
    var age = Number.isFinite(tyreAge) ? tyreAge : 0;
    var urg = Number.isFinite(urgency) ? urgency : 35;
    var pit = Number.isFinite(pitWindowLap) ? pitWindowLap : 30;
    var total = Number.isFinite(totalLaps) ? totalLaps : 58;
    var pointsA = [];
    var pointsB = [];
    for (var i = 0; i <= 8; i += 1) {
      var x = 20 + i * 32;
      var ya = 32 + i * (5 + urg / 90) + age * 0.35;
      var yb = 48 + i * 3.4;
      pointsA.push(x + ',' + Math.min(130, ya).toFixed(1));
      pointsB.push(x + ',' + Math.min(130, yb).toFixed(1));
    }
    var pitX = 20 + Math.max(0, Math.min(8, pit / Math.max(1, total) * 8)) * 32;

    return '<svg class="degrade-chart-svg" viewBox="0 0 300 140" role="img" aria-label="degradation chart">' +
      '<rect x="0" y="0" width="300" height="140" class="degrade-bg" />' +
      '<polyline points="' + esc(pointsB.join(' ')) + '" class="degrade-alt" />' +
      '<polyline points="' + esc(pointsA.join(' ')) + '" class="degrade-current" />' +
      '<line x1="' + pitX.toFixed(1) + '" y1="8" x2="' + pitX.toFixed(1) + '" y2="132" class="degrade-pit-line" />' +
    '</svg>';
  }

  function pitMetric(label, value) {
    return '<div class="pit-metric-item">' +
      '<span class="pit-metric-label">' + esc(label || '-') + '</span>' +
      '<span class="pit-metric-value">' + esc(value || '-') + '</span>' +
    '</div>';
  }

  function strategyDelta(deltaStr, direction) {
    var dir = direction === 'losing' ? 'delta-badge-losing' : 'delta-badge-gaining';
    var word = direction === 'losing' ? 'LOSING' : 'GAINING';
    return '<div class="strategy-delta-row">' +
      '<div>' +
        '<div class="pit-metric-label">STRATEGY DELTA VS REFERENCE</div>' +
        '<div class="delta-value">' + esc(deltaStr || '--') + '</div>' +
      '</div>' +
      '<span class="' + dir + '">' + word + '</span>' +
    '</div>';
  }

  function raceRow(data, isPlayer) {
    var cls = 'race-table-row' + (isPlayer ? ' player-row' : '');
    return '<tr class="' + cls + '">' +
      '<td>' + esc(data.pos || '-') + '</td>' +
      '<td>' + esc(data.driver || '-') + '</td>' +
      '<td>' + esc(data.gap || '-') + '</td>' +
      '<td>' + esc(data.interval || '-') + '</td>' +
      '<td><span class="risk-' + esc(data.riskTone || 'med') + '">' + esc(data.risk || '-') + '</span></td>' +
      '<td><span class="threat-' + esc(data.threatTone || 'ignore') + '">' + esc(data.threat || '-') + '</span></td>' +
      '<td>' + esc(data.stint || '-') + '</td>' +
      '<td>' + esc(data.tyre || '-') + '</td>' +
      '<td>' + esc(data.pit || '-') + '</td>' +
    '</tr>';
  }

  function logStripCol(head, items) {
    var rows = (items || []).map(function (item) {
      return '<div class="log-strip-row"><span>' + esc(item.time || '--:--:--') + '</span><span>' + esc(item.text || '-') + '</span></div>';
    }).join('');
    return '<section class="log-strip-col">' +
      '<div class="log-strip-head">' + esc(head || '-') + '</div>' +
      '<div class="log-strip-body">' + (rows || '<div class="console-empty">empty</div>') + '</div>' +
    '</section>';
  }

  function cmdButton(label, tone, extraClass) {
    var cmd = String(label || '').trim().toLowerCase().replace(/\s+/g, '_');
    return '<button class="cmd-btn cmd-btn-' + esc(tone || 'secondary') + (extraClass ? (' ' + esc(extraClass)) : '') + '" type="button" data-cmd="' + esc(cmd) + '">' + esc(label || '-') + '</button>';
  }

  function classificationItem(pos, driver, team, gap, laps, selected) {
    return '<div class="replay-item' + (selected ? ' selected' : '') + '">' +
      '<span class="replay-item-pos">' + esc(pos || '-') + '</span>' +
      '<span class="replay-item-driver">' + esc(driver || '-') + '</span>' +
      '<span class="replay-item-team">' + esc(team || '-') + '</span>' +
      '<span class="replay-item-gap">' + esc(gap || '-') + '</span>' +
      '<span class="replay-item-laps">L' + esc(laps || '-') + '</span>' +
      '<input class="replay-item-check" type="checkbox" data-action="toggle-driver" data-driver="' + esc(driver || '') + '" ' + (selected ? 'checked' : '') + ' />' +
    '</div>';
  }

  function replayEventCard(type, title, lapStr, timeStr) {
    return '<article class="replay-event-card">' +
      '<div class="event-card-type">' + esc(type || '-') + '</div>' +
      '<div class="event-card-title">' + esc(title || '-') + '</div>' +
      '<div class="event-card-meta">' + esc(lapStr || '-') + ' | ' + esc(timeStr || '-') + '</div>' +
      '<a class="jump-link" href="#" data-action="jump_to_timecode" data-time="' + esc(timeStr || '') + '">JUMP_TO_TIMECODE</a>' +
    '</article>';
  }

  function telemetrySvg(lines) {
    var list = (lines || []).map(function (line) {
      return '<polyline points="' + esc((line.points || []).join(' ')) + '" stroke="' + esc(line.color || '#61d6df') + '" class="telemetry-line" />';
    }).join('');
    return '<svg class="replay-telemetry-svg" viewBox="0 0 640 160" role="img" aria-label="telemetry chart">' +
      '<rect x="0" y="0" width="640" height="160" class="telemetry-bg" />' +
      list +
    '</svg>';
  }

  function playbackBar(config) {
    var speed = config && config.speed ? String(config.speed) : '1.8X';
    var speedNum = Number.parseFloat(speed);
    function speedClass(target) {
      if (!Number.isFinite(speedNum)) return '';
      return Math.abs(speedNum - target) < 0.001 ? ' speed-btn-active' : '';
    }
    return '<section class="playback-bar">' +
      '<div class="playback-controls">' +
        '<button class="transport-btn" type="button" data-action="skip-start">&#x23EE;</button>' +
        '<button class="transport-btn" type="button" data-action="step-back">&#x23EA;</button>' +
        '<button class="transport-btn" type="button" data-action="play-pause">' + ((config && config.isPlaying) ? '&#x23F8;' : '&#x25B6;') + '</button>' +
        '<button class="transport-btn" type="button" data-action="step-forward">&#x23E9;</button>' +
        '<button class="transport-btn" type="button" data-action="skip-end">&#x23ED;</button>' +
      '</div>' +
      '<div class="playback-speed">' +
        '<button class="speed-btn' + speedClass(0.5) + '" type="button" data-speed="0.5">0.5X</button>' +
        '<button class="speed-btn' + speedClass(1.8) + '" type="button" data-speed="1.8">1.8X</button>' +
        '<button class="speed-btn' + speedClass(2.0) + '" type="button" data-speed="2.0">2.0X</button>' +
      '</div>' +
      '<div class="playback-clock">' + esc(config && config.time || '01:28:44.215') + '</div>' +
      '<button class="sync-live-btn" type="button" data-action="sync-live">SYNC_TO_LIVE</button>' +
      '<div class="playback-meta">DATA_LATENCY: ' + esc(config && config.latency || '0.02s') + ' | BUFFER: ' + esc(config && config.buffer || '98%') + '</div>' +
    '</section>';
  }

  window.ConsolePrimitives = {
    topNavBar: topNavBar,
    leftRailNav: leftRailNav,
    panel: panel,
    statBlock: statBlock,
    badge: badge,
    pill: pill,
    eventRow: eventRow,
    tacticalCard: tacticalCard,
    dataTableRow: dataTableRow,
    actionButton: actionButton,
    timelineScrubber: timelineScrubber,
    graphContainer: graphContainer,
    healthChip: healthChip,
    strategyCard: strategyCard,
    navTabs: navTabs,
    iconRail: iconRail,
    driverSelector: driverSelector,
    vitalRow: vitalRow,
    tyreQuad: tyreQuad,
    compoundTag: compoundTag,
    circuitSvg: circuitSvg,
    trackOverlayCard: trackOverlayCard,
    degradationCurve: degradationCurve,
    pitMetric: pitMetric,
    strategyDelta: strategyDelta,
    raceRow: raceRow,
    logStripCol: logStripCol,
    cmdButton: cmdButton,
    classificationItem: classificationItem,
    replayEventCard: replayEventCard,
    telemetrySvg: telemetrySvg,
    playbackBar: playbackBar,
  };
})();
