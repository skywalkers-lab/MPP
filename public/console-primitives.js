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
  };
})();
