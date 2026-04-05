(function () {
  'use strict';

  var P = window.ConsolePrimitives;

  function esc(v) {
    return String(v === null || v === undefined ? '-' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safe(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback || '-';
    return String(v);
  }

  function num(v) {
    return Number.isFinite(v) ? Number(v) : null;
  }

  function pct(v) {
    var n = num(v);
    if (n === null) return '-';
    return String(Math.round(Math.max(0, Math.min(100, n)))) + '%';
  }

  function toneBySign(v) {
    var n = num(v);
    if (n === null) return null;
    if (n > 0) return 'pos';
    if (n < 0) return 'neg';
    return 'warn';
  }

  function toSessionRows(snapshot) {
    if (!snapshot || !snapshot.cars || !snapshot.drivers) return [];
    var rows = [];
    Object.keys(snapshot.cars).forEach(function (key) {
      var car = snapshot.cars[key];
      if (!car) return;
      var idx = Number(key);
      var driver = snapshot.drivers[idx] || null;
      rows.push({
        carIndex: idx,
        position: car.position,
        driverName: driver && driver.driverName ? driver.driverName : 'CAR ' + idx,
        teamName: driver && driver.teamName ? driver.teamName : '-',
        currentLapNum: car.currentLapNum,
        gapToLeader: car.gapToLeader,
        gapToFront: car.gapToFront,
        tyreCompound: car.tyreCompound,
        tyreAgeLaps: car.tyreAgeLaps,
        tyreTemp: car.tyreTemp,
        tyreWear: car.tyreWear,
        fuelLapsRemaining: car.fuelLapsRemaining,
        pitStatus: car.pitStatus,
      });
    });
    rows.sort(function (a, b) {
      var pa = Number.isFinite(a.position) ? a.position : 999;
      var pb = Number.isFinite(b.position) ? b.position : 999;
      return pa - pb;
    });
    return rows;
  }

  function parseQuery() {
    var params = new URLSearchParams(window.location.search);
    return {
      sessionId: params.get('sessionId') || '',
      joinCode: params.get('joinCode') || '',
      password: params.get('password') || '',
      permissionCode: params.get('permissionCode') || '',
    };
  }

  var REPLAY_MAX_MS = 2 * 60 * 60 * 1000;

  function formatReplayClock(ms) {
    var value = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
    var hours = Math.floor(value / 3600000);
    var minutes = Math.floor((value % 3600000) / 60000);
    var seconds = Math.floor((value % 60000) / 1000);
    var millis = value % 1000;
    return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + '.' + String(millis).padStart(3, '0');
  }

  function parseReplayTimecode(raw) {
    var value = String(raw || '').trim();
    if (!value) return null;
    var parts = value.split(':').map(function (token) {
      return Number(token);
    });
    if (parts.some(function (n) { return !Number.isFinite(n); })) {
      return null;
    }
    if (parts.length === 3) {
      return Math.max(0, (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
    }
    if (parts.length === 2) {
      return Math.max(0, (parts[0] * 60 + parts[1]) * 1000);
    }
    return null;
  }

  function clampReplayClock(ms) {
    if (!Number.isFinite(ms)) return 0;
    return Math.min(REPLAY_MAX_MS, Math.max(0, Math.round(ms)));
  }

  function setFlash(state, message, tone) {
    state.flash = {
      message: String(message || ''),
      tone: tone || 'info',
      expiresAt: Date.now() + 3200,
    };
  }

  function getFlash(state) {
    if (!state.flash) return null;
    if (Date.now() > state.flash.expiresAt) {
      state.flash = null;
      return null;
    }
    return state.flash;
  }

  function withSessionQuery(path, state) {
    var params = new URLSearchParams();
    if (state.sessionId) params.set('sessionId', state.sessionId);
    if (state.joinCode) params.set('joinCode', state.joinCode);
    var query = params.toString();
    return query ? (path + '?' + query) : path;
  }

  function getTabRoute(tabKey, state) {
    if (tabKey === 'live') return withSessionQuery('/console/live', state);
    if (tabKey === 'replay') return withSessionQuery('/console/replay', state);
    if (tabKey === 'archive') return withSessionQuery('/archives', state);
    if (tabKey === 'hub') return withSessionQuery('/ops', state);
    if (tabKey === 'strategy') {
      if (state.sessionId) {
        return '/host/' + encodeURIComponent(state.sessionId) + '?preset=host';
      }
      return '/ops?preset=ops';
    }
    if (tabKey === 'garage') {
      if (state.sessionId) {
        return '/viewer/' + encodeURIComponent(state.sessionId) + '?preset=live';
      }
      return '/rooms';
    }
    return '';
  }

  function commandLabelFromKey(cmd) {
    return String(cmd || '').replace(/_/g, ' ').toUpperCase().trim();
  }

  function buildJoinApi(joinCode, query) {
    var params = new URLSearchParams();
    if (query.password) params.set('password', query.password);
    if (query.permissionCode) params.set('permissionCode', query.permissionCode);
    var q = params.toString();
    return '/api/viewer/join/' + encodeURIComponent(joinCode) + (q ? ('?' + q) : '');
  }

  async function apiJson(url, options) {
    var res = await fetch(url, options);
    var data = await res.json();
    if (!res.ok) {
      var err = new Error(data.error || data.reason || data.viewerStatus || 'api_failed');
      err.payload = data;
      throw err;
    }
    return data;
  }

  function getPlayer(snapshot) {
    if (!snapshot) return null;
    var idx = snapshot.playerCarIndex;
    if (idx === null || idx === undefined) return null;
    return snapshot.cars && snapshot.cars[idx] ? snapshot.cars[idx] : null;
  }

  function deriveFuelMargin(signals) {
    if (!signals) return null;
    var fuelLaps = num(signals.fuelLapsRemaining);
    var lapsRemaining = num(signals.lapsRemaining);
    if (fuelLaps === null || lapsRemaining === null) return null;
    return fuelLaps - lapsRemaining;
  }

  function deriveStintPhase(car, signals) {
    var age = num(car && car.tyreAgeLaps);
    var progress = num(signals && signals.stintProgress);
    if (age === null) return 'L-/-';
    if (progress === null || progress <= 0) return 'L' + Math.round(age) + '/?';
    var est = Math.max(Math.round(age / Math.max(0.05, progress)), Math.round(age));
    return 'L' + Math.round(age) + '/' + est;
  }

  function deriveWingLoss(damage) {
    if (!damage) return '-';
    var fl = num(damage.frontWingLeft);
    var fr = num(damage.frontWingRight);
    if (fl === null || fr === null) return '-';
    var secPerLap = ((fl + fr) / 200) * 0.15;
    return secPerLap.toFixed(3) + 's/LAP';
  }

  function deriveEngineWear(damage) {
    var engine = num(damage && damage.engine);
    if (engine === null) return 'UNKNOWN';
    if (engine < 20) return 'NOMINAL';
    if (engine < 50) return 'ELEVATED';
    return 'CRITICAL';
  }

  function deriveMarginRisk(score) {
    var n = num(score);
    if (n === null) return { label: 'MED', tone: 'med' };
    if (n < 33) return { label: 'LOW', tone: 'low' };
    if (n < 66) return { label: 'MED', tone: 'med' };
    return { label: 'HIGH', tone: 'high' };
  }

  function deriveThreat(row, playerPos, signals) {
    var pos = num(row && row.position);
    var player = num(playerPos);
    var undercut = num(signals && signals.undercutScore);
    var overcut = num(signals && signals.overcutScore);
    if (pos === null || player === null) return { label: 'IGNORE', tone: 'ignore' };
    if (Math.abs(pos - player) <= 1 && undercut !== null && undercut >= 55) return { label: 'ATTACK', tone: 'attack' };
    if (Math.abs(pos - player) <= 2 && overcut !== null && overcut >= 55) return { label: 'DEFEND', tone: 'defend' };
    if (Math.abs(pos - player) <= 4) return { label: 'BOUND', tone: 'bound' };
    return { label: 'IGNORE', tone: 'ignore' };
  }

  function teamFromRow(row) {
    var name = String(row.driverName || '').toUpperCase();
    if (name.indexOf('VER') >= 0 || name.indexOf('PERE') >= 0) return 'RED BULL';
    if (name.indexOf('LEC') >= 0 || name.indexOf('SAI') >= 0) return 'FERRARI';
    if (name.indexOf('NOR') >= 0 || name.indexOf('PIA') >= 0) return 'MCLAREN';
    if (name.indexOf('HAM') >= 0 || name.indexOf('RUS') >= 0) return 'MERCEDES';
    return row.teamName || 'TEAM';
  }

  function buildHeader(state, mode, activeTab) {
    var session = state.session || {};
    var snapshot = session.snapshot || null;
    var meta = snapshot && snapshot.sessionMeta ? snapshot.sessionMeta : null;
    var lap = safe(meta && meta.currentLap, '-');
    var total = safe(meta && meta.totalLaps, '-');
    var title = mode === 'replay' ? 'KINETIC_INSTRUMENT_V1' : 'MPP STRATEGIC CONSOLE';
    var tabs = mode === 'replay'
      ? [
          { key: 'live', label: 'LIVE' },
          { key: 'replay', label: 'REPLAY' },
          { key: 'archive', label: 'ARCHIVE' },
          { key: 'hub', label: 'DATA_HUB' },
        ]
      : [
          { key: 'live', label: 'LIVE TELEMETRY' },
          { key: 'strategy', label: 'STRATEGY' },
          { key: 'garage', label: 'VIRTUAL GARAGE' },
          { key: 'replay', label: 'REPLAY' },
        ];

    return '<header class="top-nav">' +
      '<div class="brand-title">' + esc(title) + '</div>' +
      P.navTabs(tabs, activeTab || (mode === 'replay' ? 'replay' : 'live')) +
      '<div class="top-meta">SESSION ' + esc(safe(state.access && state.access.roomTitle, 'GP: MONZA')) + ' | LAPS ' + esc(lap) + '/' + esc(total) + '</div>' +
      '<div class="top-icons-row">' +
        '<span class="top-icon">S</span>' +
        '<span class="top-icon">?</span>' +
        '<span class="top-avatar"></span>' +
      '</div>' +
    '</header>';
  }

  function buildIconRail(mode, state) {
    var activeRail = mode === 'replay'
      ? (state.activeReplayRail || 'map')
      : (state.activeLiveRail || 'ver');

    if (mode === 'replay') {
      return P.iconRail([
        { key: 'telem', icon: 'X', label: 'TELEM', active: activeRail === 'telem' },
        { key: 'map', icon: 'M', label: 'MAP', active: activeRail === 'map' },
        { key: 'sync', icon: 'D', label: 'SYNC', active: activeRail === 'sync' },
        { key: 'tires', icon: 'T', label: 'TIRES', active: activeRail === 'tires' },
        { key: 'strat', icon: 'S', label: 'STRAT', active: activeRail === 'strat' },
      ], [
        { key: 'log', icon: 'L', label: 'LOG', active: activeRail === 'log' },
      ]);
    }

    return P.iconRail([
      { key: 'grid', icon: 'G', label: 'GRID', active: activeRail === 'grid' },
      { key: 'ver', icon: 'V', label: 'VER', active: activeRail === 'ver' },
      { key: 'per', icon: 'P', label: 'PER', active: activeRail === 'per' },
      { key: 'lec', icon: 'L', label: 'LEC', active: activeRail === 'lec' },
      { key: 'sai', icon: 'S', label: 'SAI', active: activeRail === 'sai' },
      { key: 'ham', icon: 'H', label: 'HAM', active: activeRail === 'ham' },
      { key: 'rus', icon: 'R', label: 'RUS', active: activeRail === 'rus' },
    ], [
      { key: 'add', icon: '+', label: '', active: activeRail === 'add' },
      { key: 'map', icon: 'M', label: '', active: activeRail === 'map' },
      { key: 'cam', icon: 'C', label: '', active: activeRail === 'cam' },
    ]);
  }

  function buildStatusLine(state, mode) {
    var flash = getFlash(state);
    var health = state.health && state.health.health ? String(state.health.health).toUpperCase() : 'UNKNOWN';
    var errorText = state.error ? ('ERROR: ' + state.error) : 'stream nominal';
    if (mode === 'replay') {
      var playback = state.playback || {};
      var speed = Number(playback.speed);
      var speedLabel = Number.isFinite(speed) ? speed.toFixed(1) + 'X' : '1.0X';
      return '<section class="console-status-line">' +
        '<span class="status-chip">REPLAY ' + (playback.isPlaying ? 'PLAYING' : 'PAUSED') + '</span>' +
        '<span class="status-chip">SPEED ' + esc(speedLabel) + '</span>' +
        '<span class="status-chip">TC ' + esc(formatReplayClock(playback.clockMs || 0)) + '</span>' +
        (flash ? '<span class="status-flash status-flash-' + esc(flash.tone) + '">' + esc(flash.message) + '</span>' : '<span class="status-text">preview controls active</span>') +
      '</section>';
    }

    var last = state.lastCommand
      ? ('LAST CMD: ' + state.lastCommand.label + ' @ ' + state.lastCommand.at)
      : 'LAST CMD: -';
    var line = state.error ? errorText : last;

    return '<section class="console-status-line">' +
      '<span class="status-chip">HEALTH ' + esc(health) + '</span>' +
      '<span class="status-chip">SESSION ' + esc(safe(state.sessionId, 'pending')) + '</span>' +
      '<span class="status-chip">JOIN ' + esc(safe(state.joinCode, '-')) + '</span>' +
      (flash ? '<span class="status-flash status-flash-' + esc(flash.tone) + '">' + esc(flash.message) + '</span>' : '<span class="status-text">' + esc(line) + '</span>') +
    '</section>';
  }

  function buildDriverPanel(state) {
    var session = state.session || {};
    var snapshot = session.snapshot || null;
    var player = getPlayer(snapshot);
    var rows = toSessionRows(snapshot);
    var playerRow = rows.find(function (r) { return player && r.carIndex === snapshot.playerCarIndex; }) || rows[0] || {};
    var signals = state.strategy && state.strategy.signals ? state.strategy.signals : {};
    var access = state.access || {};
    var fuelMargin = deriveFuelMargin(signals);
    var fuelText = fuelMargin === null ? '-' : (fuelMargin >= 0 ? '+' : '') + fuelMargin.toFixed(2) + ' LAPS';

    return P.panel('VER - CAR 01',
      P.driverSelector(safe(access.driverLabel, playerRow.driverName || 'VER'), teamFromRow(playerRow)) +
      P.vitalRow('FUEL MARGIN', fuelText, toneBySign(fuelMargin)) +
      P.vitalRow('STINT PHASE', deriveStintPhase(player, signals), null) +
      P.vitalRow('WING AERO LOSS', deriveWingLoss(player && player.damage), 'warn') +
      P.vitalRow('ENGINE WEAR TREND', deriveEngineWear(player && player.damage), 'warn') +
      P.tyreQuad(player && player.tyreTemp, player && player.tyreWear, player && player.tyreCompound) +
      '<div class="vital-row"><span class="vital-label">GEAR</span><span class="vital-value">--</span></div>' +
      '<div class="vital-row"><span class="vital-label">KM/H</span><span class="vital-value">--</span></div>'
    );
  }

  function buildTrackPanel(state) {
    var session = state.session || {};
    var snapshot = session.snapshot || null;
    var rows = toSessionRows(snapshot);
    var meta = snapshot && snapshot.sessionMeta ? snapshot.sessionMeta : null;
    var signals = state.strategy && state.strategy.signals ? state.strategy.signals : {};
    var playerPos = getPlayer(snapshot) && getPlayer(snapshot).position;

    if (rows.length === 0) {
      return P.panel('Live Track Simulation', '<div class="console-empty">telemetry waiting...</div>');
    }

    return P.panel('Live Track Simulation',
      '<div class="track-sim-wrap">' +
        '<div class="track-sim-header-line"><span>SECTOR 1-3</span><span>LAPS ' + esc(safe(meta && meta.currentLap, '-')) + '/' + esc(safe(meta && meta.totalLaps, '-')) + '</span><span>VSC READY</span></div>' +
        '<div class="track-sim-map">' +
          P.circuitSvg(rows, playerPos) +
          '<div class="track-overlay-cards">' +
            P.trackOverlayCard('CLEAN AIR WINDOW', [
              { key: 'Prob', value: pct((num(signals.cleanAirProbability) || 0) * 100) },
              { key: 'Band', value: safe(signals.expectedRejoinBand, '-') },
            ]) +
            P.trackOverlayCard('UNDERCUT RISK', [
              { key: 'Score', value: safe(num(signals.undercutScore) !== null ? Math.round(signals.undercutScore) + '/100' : '-', '-') },
              { key: 'Traffic', value: safe(num(signals.trafficRiskScore) !== null ? Math.round(signals.trafficRiskScore) + '/100' : '-', '-') },
            ]) +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function buildDegradationPanel(state) {
    var strategy = state.strategy || {};
    var signals = strategy.signals || {};
    var tyreAge = num(signals.tyreAgeLaps);
    var urgency = num(signals.tyreUrgencyScore);
    var pitLap = num(signals.pitWindowHint);
    var total = num(signals.totalLaps);
    var delta = num(strategy.confidenceScore);
    var deltaSec = delta === null ? '--' : (-(delta / 240)).toFixed(3) + 's';

    return P.panel('Degradation Projection',
      P.degradationCurve(tyreAge, urgency, pitLap, total) +
      '<div class="pit-metrics-strip">' +
        P.pitMetric('PIT WINDOW OPEN', 'LAP ' + safe(signals.pitWindowHint, '-')) +
        P.pitMetric('REJOIN POS (EST)', safe(signals.expectedRejoinBand, '-')) +
      '</div>' +
      P.strategyDelta(deltaSec, delta !== null && delta < 45 ? 'losing' : 'gaining')
    );
  }

  function buildSessionTable(state) {
    var session = state.session || {};
    var snapshot = session.snapshot || null;
    var rows = toSessionRows(snapshot);
    var signals = state.strategy && state.strategy.signals ? state.strategy.signals : {};
    var player = getPlayer(snapshot);
    var playerPos = player && player.position;
    var risk = deriveMarginRisk(signals.trafficRiskScore);

    var body = rows.length === 0
      ? '<tr class="race-table-row"><td colspan="9">classification unavailable</td></tr>'
      : rows.slice(0, 20).map(function (row) {
          var threat = deriveThreat(row, playerPos, signals);
          return P.raceRow({
            pos: safe(row.position, '-'),
            driver: row.driverName,
            gap: safe(row.gapToLeader, '-'),
            interval: safe(row.gapToFront, '-'),
            risk: risk.label,
            riskTone: risk.tone,
            threat: threat.label,
            threatTone: threat.tone,
            stint: deriveStintPhase({ tyreAgeLaps: row.tyreAgeLaps }, signals),
            tyre: safe(row.tyreCompound, '-') + ' / ' + safe(row.tyreAgeLaps, '-') + 'L',
            pit: safe(row.pitStatus, '-'),
          }, row.position === playerPos);
        }).join('');

    return '<section class="console-panel">' +
      '<div class="panel-head">Race Classification</div>' +
      '<div class="panel-body" style="padding:0">' +
        '<table class="race-table">' +
          '<thead><tr><th>POS</th><th>DRIVER</th><th>GAP</th><th>INTERVAL</th><th>MARGIN RISK</th><th>THREAT</th><th>STINT</th><th>TYRE</th><th>PIT</th></tr></thead>' +
          '<tbody>' + body + '</tbody>' +
        '</table>' +
      '</div>' +
    '</section>';
  }

  function classifyTimeline(state) {
    var items = state.timeline && state.timeline.timeline ? state.timeline.timeline.slice(-24).reverse() : [];
    var radio = [];
    var raceControl = [];
    var strategy = [];

    items.forEach(function (item) {
      var time = new Date(item.timestamp || Date.now()).toLocaleTimeString();
      if (item.kind === 'note' && item.note) {
        var category = String(item.note.category || '').toLowerCase();
        if (category === 'strategy') {
          strategy.push({ time: time, text: safe(item.note.text, '-') });
        } else {
          radio.push({ time: time, text: safe(item.note.text, '-') });
        }
        return;
      }
      if (item.kind === 'ops_event' && item.event) {
        var type = String(item.event.type || '').toLowerCase();
        if (type.indexOf('flag') >= 0 || type.indexOf('incident') >= 0 || type.indexOf('vsc') >= 0 || type.indexOf('sc') >= 0) {
          raceControl.push({ time: time, text: safe(item.event.type, '-') });
        } else {
          strategy.push({ time: time, text: safe(item.event.type, '-') });
        }
      }
    });

    return {
      radio: radio.slice(0, 8),
      raceControl: raceControl.slice(0, 8),
      strategy: strategy.slice(0, 8),
    };
  }

  function buildLogStrip(state) {
    var classified = classifyTimeline(state);
    return '<div class="log-strip">' +
      P.logStripCol('TEAM RADIO [CH1]', classified.radio) +
      P.logStripCol('RACE CONTROL', classified.raceControl) +
      P.logStripCol('STRATEGY ENGINE', classified.strategy) +
    '</div>';
  }

  function buildCommandDeck() {
    return '<section class="command-area">' +
      '<div class="cmd-buttons-grid">' +
        P.cmdButton('BOX THIS LAP', 'danger') +
        P.cmdButton('PUSH NOW', 'primary') +
        P.cmdButton('HARVEST MODE', 'warn') +
        P.cmdButton('HOLD POS', 'secondary') +
        P.cmdButton('EXECUTE SCENARIO B', 'secondary', 'cmd-btn-xl') +
      '</div>' +
    '</section>';
  }

  function renderLiveShell(root, state) {
    root.innerHTML =
      buildHeader(state, 'live', 'live') +
      '<div class="console-shell">' +
        buildIconRail('live', state) +
        '<main class="console-main">' +
          buildStatusLine(state, 'live') +
          '<div class="live-body-grid">' +
            '<div class="live-col-left">' + buildDriverPanel(state) + '</div>' +
            '<div class="live-col-center">' + buildTrackPanel(state) + '</div>' +
            '<div class="live-col-right">' + buildDegradationPanel(state) + '</div>' +
          '</div>' +
          '<div class="live-classification-section">' + buildSessionTable(state) + '</div>' +
          '<div class="console-bottom-area">' +
            buildLogStrip(state) +
            buildCommandDeck() +
          '</div>' +
        '</main>' +
      '</div>';
  }

  function buildReplayTelemetry() {
    return P.telemetrySvg([
      { color: '#61d6df', points: ['0,92', '60,78', '120,88', '180,70', '240,94', '300,66', '360,58', '420,72', '480,84', '540,96', '640,100'] },
      { color: '#f3bf52', points: ['0,98', '60,84', '120,95', '180,74', '240,96', '300,70', '360,62', '420,76', '480,90', '540,99', '640,106'] },
    ]);
  }

  function renderReplayShell(root, state) {
    var playback = state.playback || {};
    var speedValue = Number(playback.speed);
    var speedLabel = Number.isFinite(speedValue) ? speedValue.toFixed(1) + 'X' : '1.8X';

    var left = P.panel('Classification',
      P.classificationItem('01', 'VER', 'RED BULL', 'LEADER', '53', true) +
      P.classificationItem('02', 'LEC', 'FERRARI', '+1.242', '53', true) +
      P.classificationItem('03', 'NOR', 'MCLAREN', '+3.891', '53', false) +
      P.classificationItem('04', 'HAM', 'MERCEDES', '+8.115', '53', false)
    );

    var centerTop = P.panel('SYNC_TELEMETRY',
      '<div class="track-sim-header-line"><span>VER</span><span>LEC</span><span>WINDOW: 16S</span></div>' +
      buildReplayTelemetry()
    );

    var centerBottom = P.panel('SECTOR_MAP',
      '<div class="track-sim-map">' +
        P.circuitSvg([{ position: 1 }, { position: 2 }], 1) +
      '</div>'
    );

    var right = P.panel('EVENT_LOG',
      P.replayEventCard('OVERTAKE', 'VER ON LEC (TURN 1)', 'L48', '1:22:15') +
      P.replayEventCard('PIT_STOP', 'LEC (2.2S STATIONARY)', 'L44', '1:16:04') +
      P.replayEventCard('BEST_SECTOR', 'VER S1 (PERSONAL BEST)', 'L40', '1:08:42') +
      P.replayEventCard('FLAG_INCIDENT', 'SAI_STR_LOCKUP_T4', 'L38', '1:04:12')
    );

    root.innerHTML =
      buildHeader(state, 'replay', 'replay') +
      '<div class="console-shell">' +
        buildIconRail('replay', state) +
        '<main class="console-main">' +
          buildStatusLine(state, 'replay') +
          '<div class="replay-layout">' +
            left +
            '<div class="live-col-center">' + centerTop + centerBottom + '</div>' +
            right +
          '</div>' +
          P.playbackBar({
            time: formatReplayClock(playback.clockMs || 0),
            isPlaying: !!playback.isPlaying,
            speed: speedLabel,
            latency: playback.latency || '0.02s',
            buffer: playback.buffer || '96%',
          }) +
        '</main>' +
      '</div>';
  }

  async function postConsoleCommand(state, cmdKey) {
    if (!state.sessionId) {
      throw new Error('session_unavailable');
    }

    var lap = null;
    if (state.session && state.session.snapshot && state.session.snapshot.sessionMeta) {
      lap = Number(state.session.snapshot.sessionMeta.currentLap);
    }

    var payload = {
      category: 'strategy',
      authorLabel: 'Engineer',
      severity: 'medium',
      text: '[CONSOLE_CMD] ' + commandLabelFromKey(cmdKey),
    };
    if (Number.isFinite(lap) && lap > 0) {
      payload.lap = Math.floor(lap);
    }

    await apiJson('/api/viewer/notes/' + encodeURIComponent(state.sessionId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  function renderByMode(root, state) {
    if (state.mode === 'replay') {
      renderReplayShell(root, state);
      return;
    }
    renderLiveShell(root, state);
  }

  function wireConsoleInteractions(root, state) {
    root.addEventListener('click', async function (event) {
      var rawTarget = event.target;
      if (!(rawTarget instanceof Element)) return;

      var target = rawTarget.closest('[data-tab-key],[data-cmd],[data-action],[data-speed],[data-rail-key]');
      if (!target || !root.contains(target)) return;

      if (target.tagName === 'A') {
        event.preventDefault();
      }

      var tabKey = target.getAttribute('data-tab-key');
      if (tabKey) {
        var route = getTabRoute(tabKey, state);
        if (route) {
          window.location.assign(route);
        }
        return;
      }

      var railKey = target.getAttribute('data-rail-key');
      if (railKey) {
        if (state.mode === 'replay') {
          state.activeReplayRail = railKey;
        } else {
          state.activeLiveRail = railKey;
        }
        setFlash(state, 'PANEL: ' + String(railKey).toUpperCase(), 'info');
        renderByMode(root, state);
        return;
      }

      var cmd = target.getAttribute('data-cmd');
      if (cmd) {
        var cmdLabel = commandLabelFromKey(cmd);
        try {
          setFlash(state, 'COMMAND SENDING: ' + cmdLabel, 'info');
          renderByMode(root, state);
          await postConsoleCommand(state, cmd);
          state.lastCommand = {
            label: cmdLabel,
            at: new Date().toLocaleTimeString(),
          };
          setFlash(state, 'COMMAND LOGGED: ' + cmdLabel, 'ok');
        } catch (err) {
          setFlash(state, 'COMMAND FAILED: ' + (err && err.message ? err.message : 'unknown_error'), 'error');
        }
        renderByMode(root, state);
        return;
      }

      var speed = target.getAttribute('data-speed');
      if (speed) {
        var speedNum = Number(speed);
        if (Number.isFinite(speedNum) && speedNum > 0) {
          state.playback.speed = speedNum;
          setFlash(state, 'SPEED SET: ' + speedNum.toFixed(1) + 'X', 'ok');
          renderReplayShell(root, state);
        }
        return;
      }

      var action = target.getAttribute('data-action');
      if (!action) return;

      if (action === 'toggle-driver') {
        var driver = target.getAttribute('data-driver') || 'DRIVER';
        var enabled = target instanceof HTMLInputElement ? target.checked : true;
        setFlash(state, (enabled ? 'TRACKING ON: ' : 'TRACKING OFF: ') + driver, 'info');
        renderByMode(root, state);
        return;
      }

      if (state.mode !== 'replay') {
        return;
      }

      if (action === 'play-pause') {
        state.playback.isPlaying = !state.playback.isPlaying;
        setFlash(state, state.playback.isPlaying ? 'PLAYBACK RUNNING' : 'PLAYBACK PAUSED', 'ok');
      } else if (action === 'skip-start') {
        state.playback.clockMs = 0;
        state.playback.isPlaying = false;
        setFlash(state, 'MOVED TO START', 'info');
      } else if (action === 'step-back') {
        state.playback.clockMs = clampReplayClock((state.playback.clockMs || 0) - 5000);
        setFlash(state, 'STEP BACK 5S', 'info');
      } else if (action === 'step-forward') {
        state.playback.clockMs = clampReplayClock((state.playback.clockMs || 0) + 5000);
        setFlash(state, 'STEP FORWARD 5S', 'info');
      } else if (action === 'skip-end') {
        state.playback.clockMs = REPLAY_MAX_MS;
        state.playback.isPlaying = false;
        setFlash(state, 'MOVED TO END', 'info');
      } else if (action === 'sync-live') {
        state.playback.clockMs = 0;
        state.playback.isPlaying = false;
        setFlash(state, 'SYNCED TO LIVE EDGE', 'ok');
      } else if (action === 'jump_to_timecode') {
        var jumped = parseReplayTimecode(target.getAttribute('data-time'));
        if (Number.isFinite(jumped)) {
          state.playback.clockMs = clampReplayClock(jumped);
          state.playback.isPlaying = false;
          setFlash(state, 'JUMPED TO ' + formatReplayClock(jumped), 'ok');
        }
      }

      renderReplayShell(root, state);
    });
  }

  function boot() {
    var root = document.getElementById('console-root');
    if (!root || !P) {
      return;
    }

    var type = document.body.getAttribute('data-console-type');
    var query = parseQuery();
    var state = {
      mode: type === 'replay' ? 'replay' : 'live',
      sessionId: query.sessionId || '',
      joinCode: query.joinCode || '',
      query: query,
      relay: null,
      access: null,
      joinPayload: null,
      session: null,
      strategy: null,
      health: null,
      timeline: null,
      error: null,
      flash: null,
      lastCommand: null,
      playback: {
        clockMs: 0,
        isPlaying: false,
        speed: 1.8,
        latency: '0.02s',
        buffer: '96%',
      },
      activeLiveRail: 'ver',
      activeReplayRail: 'map',
    };

    wireConsoleInteractions(root, state);

    if (state.mode === 'replay') {
      renderReplayShell(root, state);
      window.setInterval(function () {
        if (!state.playback.isPlaying) {
          return;
        }
        var speed = Number(state.playback.speed);
        var delta = Number.isFinite(speed) ? Math.max(0.5, speed) * 1000 : 1000;
        state.playback.clockMs = clampReplayClock((state.playback.clockMs || 0) + delta);
        if (state.playback.clockMs >= REPLAY_MAX_MS) {
          state.playback.clockMs = REPLAY_MAX_MS;
          state.playback.isPlaying = false;
          setFlash(state, 'REPLAY END REACHED', 'info');
        }
        renderReplayShell(root, state);
      }, 1000);
      return;
    }

    async function resolveTargetSession() {
      if (state.sessionId) {
        return;
      }

      if (state.joinCode) {
        var joinPayload = await apiJson(buildJoinApi(state.joinCode, state.query));
        state.joinPayload = joinPayload;
        state.sessionId = joinPayload.sessionId || '';
        state.access = joinPayload.access || null;
        return;
      }

      var rooms = await apiJson('/api/viewer/rooms/active');
      if (rooms && rooms.rooms && rooms.rooms.length > 0) {
        state.sessionId = rooms.rooms[0].sessionId;
        state.joinCode = rooms.rooms[0].joinCode;
      }
    }

    async function tick() {
      try {
        await resolveTargetSession();
        if (!state.sessionId) {
          state.error = 'no_active_room';
          renderLiveShell(root, state);
          return;
        }

        var jobs = [
          apiJson('/api/viewer/relay-info'),
          apiJson('/api/viewer/session-access/' + encodeURIComponent(state.sessionId)),
          apiJson('/api/viewer/sessions/' + encodeURIComponent(state.sessionId)),
          apiJson('/api/viewer/strategy/' + encodeURIComponent(state.sessionId)),
          apiJson('/api/viewer/health/' + encodeURIComponent(state.sessionId)),
          apiJson('/api/viewer/timeline/' + encodeURIComponent(state.sessionId) + '?limit=60'),
        ];

        var result = await Promise.allSettled(jobs);
        state.relay = result[0].status === 'fulfilled' ? result[0].value : state.relay;
        if (result[1].status === 'fulfilled') {
          state.access = result[1].value.access || result[1].value;
          state.joinCode = state.access && state.access.joinCode ? state.access.joinCode : state.joinCode;
        }
        state.session = result[2].status === 'fulfilled' ? result[2].value : state.session;
        state.strategy = result[3].status === 'fulfilled' ? result[3].value : state.strategy;
        state.health = result[4].status === 'fulfilled' ? result[4].value : state.health;
        state.timeline = result[5].status === 'fulfilled' ? result[5].value : state.timeline;
        state.error = null;
      } catch (err) {
        state.error = err && err.message ? err.message : String(err);
      }

      renderByMode(root, state);
    }

    tick();
    setInterval(tick, 2000);
  }

  boot();
})();
