(function () {
  'use strict';

  var P = window.ConsolePrimitives;

  function renderLiveShell(root) {
    var strategyStrip = '<div style="display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px">' +
      P.statBlock('Call Strength', '82', 'confidence+stability') +
      P.statBlock('Pit Window ETA', 'L+2', 'trend weighted') +
      P.statBlock('Traffic Exposure', '34', 'field compression') +
      P.statBlock('Tyre/Fuel Stress', '58', 'compound+fuel risk') +
      P.statBlock('Exec Readiness', '76', 'ops readiness blend') +
      P.statBlock('Clean Air Prob', '61%', 'pit rejoin model') +
    '</div>';

    var left = P.panel('Selected Driver State',
      '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">' +
      P.statBlock('Fuel Margin', '+0.9 laps') +
      P.statBlock('Stint Phase', 'L24 / 32') +
      P.statBlock('Tyre', 'SOFT | 8L') +
      P.statBlock('Tyre Temp', '98 C') +
      P.statBlock('Gear', '8') +
      P.statBlock('RPM / Speed', '11840 / 328') +
      '</div>');

    var center = P.panel('Tactical Board',
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">' +
      P.graphContainer('Track Context / Driver Position') +
      '<div style="display:grid;gap:8px">' +
      P.tacticalCard('Clean Air Window', 'target rejoin between P4 and P5') +
      P.tacticalCard('Undercut Risk', 'medium in next 2 laps') +
      '</div></div>');

    var right = P.panel('Strategy Projection',
      '<div style="display:grid;gap:8px">' +
      P.strategyCard('Degradation Projection', 'SOFT cliff L30', 'hard alt +4 laps') +
      P.strategyCard('Pit Window Open', 'LAP 30', 'window width 3 laps') +
      P.strategyCard('Rejoin Estimate', 'P4', 'delta +0.42s vs P2') +
      '</div>');

    var table = P.panel('Race Order + Event Rail',
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">' +
      '<div>' +
      P.dataTableRow(['P1 VER', 'gap LEADER', 'interval -', 'threat low', 'stint 24', 'soft', 'pit 0']) +
      P.dataTableRow(['P2 LEC', 'gap +3.4', 'interval +3.4', 'threat med', 'stint 22', 'soft', 'pit 0']) +
      P.dataTableRow(['P3 HAM', 'gap +12.8', 'interval +9.4', 'threat low', 'stint 20', 'hard', 'pit 0']) +
      '</div><div>' +
      P.eventRow('14:21:10', 'TEAM RADIO: tyres falling off') +
      P.eventRow('14:21:30', 'RACE CONTROL: yellow cleared') +
      P.eventRow('14:21:55', 'STRATEGY: target lap revised 32') +
      '</div></div>');

    var actionStrip = P.panel('Action Strip',
      '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">' +
      P.actionButton('BOX THIS LAP', 'danger') +
      P.actionButton('PUSH NOW', 'primary') +
      P.actionButton('HARVEST MODE', '') +
      P.actionButton('HOLD POS', 'warn') +
      '</div>');

    root.innerHTML =
      P.topNavBar({ title: 'MPP Strategic Console', meta: 'live strategic console skeleton' }) +
      '<div class="console-shell">' +
      P.leftRailNav([
        { key: 'live', label: 'live' },
        { key: 'strategy', label: 'strategy' },
        { key: 'track', label: 'track' },
        { key: 'events', label: 'events' }
      ], 'live') +
      '<main class="console-main">' +
      P.panel('Top Strategy Strip', strategyStrip) +
      '<div style="display:grid;grid-template-columns:320px 1fr 300px;gap:10px">' + left + center + right + '</div>' +
      table +
      actionStrip +
      '</main>' +
      '</div>';
  }

  function renderReplayShell(root) {
    var left = P.panel('Classification',
      P.dataTableRow(['P1 VER', '+0.0']) +
      P.dataTableRow(['P2 LEC', '+3.4']) +
      P.dataTableRow(['P3 HAM', '+12.8'])
    );

    var centerTop = P.panel('Sync Telemetry', P.graphContainer('Speed / ERS / Delta')); 
    var centerBottom = P.panel('Sector Map / Driver Sync', P.tacticalCard('Snapshot Focus', 'timeline-selected replay frame context'));

    var right = P.panel('Event Log',
      P.eventRow('01:22:15', 'OVERTAKE: VER on LEC T1') +
      P.eventRow('01:16:04', 'PIT STOP: LEC pit stationary') +
      P.eventRow('01:08:42', 'BEST SECTOR: VER S1 PB')
    );

    var scrubber = P.panel('Replay Timeline',
      P.timelineScrubber('replay-scrubber', 42, 0, 120) +
      '<div style="display:flex;justify-content:space-between;margin-top:8px">' +
      P.actionButton('Play', '') +
      P.actionButton('Step -', '') +
      P.actionButton('Step +', '') +
      '<div class="stat-value" style="font-size:18px">01:28:44.215</div>' +
      '</div>'
    );

    root.innerHTML =
      P.topNavBar({ title: 'MPP Replay Console', meta: 'replay console skeleton' }) +
      '<div class="console-shell">' +
      P.leftRailNav([
        { key: 'replay', label: 'replay' },
        { key: 'timeline', label: 'timeline' },
        { key: 'events', label: 'events' },
        { key: 'notes', label: 'notes' }
      ], 'replay') +
      '<main class="console-main">' +
      P.panel('Session Metadata',
        '<div style="display:flex;gap:8px;align-items:center">' +
        P.pill('session gp_monza_53') +
        P.healthChip('health-healthy', 'healthy') +
        P.badge('relay sync active') +
        '</div>') +
      '<div style="display:grid;grid-template-columns:260px 1fr 320px;gap:10px">' +
      left +
      '<div style="display:grid;gap:10px">' + centerTop + centerBottom + '</div>' +
      right +
      '</div>' +
      scrubber +
      '</main>' +
      '</div>';
  }

  function boot() {
    var root = document.getElementById('console-root');
    if (!root || !P) {
      return;
    }

    var type = document.body.getAttribute('data-console-type');
    if (type === 'replay') {
      renderReplayShell(root);
      return;
    }

    renderLiveShell(root);
  }

  boot();
})();
