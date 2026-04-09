(function () {
  'use strict';

  var P = window.ConsolePrimitives;
  var Branding = window.MPPBranding || null;

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
    if (name.indexOf('LEC') >= 0 || name.indexOf('SAI') >= 0 || name.indexOf('HAM') >= 0) return 'FERRARI';
    if (name.indexOf('NOR') >= 0 || name.indexOf('PIA') >= 0) return 'MCLAREN';
    if (name.indexOf('RUS') >= 0 || name.indexOf('ANT') >= 0) return 'MERCEDES';
    if (name.indexOf('ALO') >= 0 || name.indexOf('STR') >= 0) return 'ASTON MARTIN';
    if (name.indexOf('GAS') >= 0 || name.indexOf('DOO') >= 0) return 'ALPINE';
    if (name.indexOf('ALB') >= 0 || name.indexOf('COL') >= 0) return 'WILLIAMS';
    if (name.indexOf('OCO') >= 0 || name.indexOf('BEA') >= 0) return 'HAAS';
    if (name.indexOf('HUL') >= 0 || name.indexOf('BOR') >= 0) return 'SAUBER';
    if (name.indexOf('TSU') >= 0 || name.indexOf('LAW') >= 0 || name.indexOf('HAD') >= 0) return 'RACING BULLS';
    return row.teamName || 'TEAM';
  }

  function buildHeader(state, mode, activeTab) {
    var session = state.session || {};
    var snapshot = session.snapshot || null;
    var meta = snapshot && snapshot.sessionMeta ? snapshot.sessionMeta : null;
    var player = getPlayer(snapshot);
    var rows = toSessionRows(snapshot);
    var playerRow = rows.find(function (row) {
      return snapshot && player && row.carIndex === snapshot.playerCarIndex;
    }) || rows[0] || {};
    var lap = safe(meta && meta.currentLap, '-');
    var total = safe(meta && meta.totalLaps, '-');
    var weatherLabel = meta && meta.weather ? String(meta.weather).replace(/_/g, ' ').toUpperCase() : 'UNKNOWN';
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

    var weatherBadge = Branding && meta && meta.weather
      ? Branding.weatherBadgeHtml(meta.weather, { compact: true, iconOnly: true })
      : '<span class="top-icon">WX</span>';
    var tyreBadge = Branding && player && player.tyreCompound
      ? Branding.tyreBadgeHtml(player.tyreCompound, { compact: true, iconOnly: true })
      : '<span class="top-icon">T</span>';
    var teamBadge = Branding
      ? Branding.teamBadgeHtml(teamFromRow(playerRow), { compact: true, iconOnly: true, scale: 0.08 })
      : '<span class="top-avatar"></span>';

    return '<header class="top-nav">' +
      '<div class="brand-title">' + esc(title) + '</div>' +
      P.navTabs(tabs, activeTab || (mode === 'replay' ? 'replay' : 'live')) +
      '<div class="top-meta">SESSION ' + esc(safe(state.access && state.access.roomTitle, 'GP: MONZA')) + ' | LAPS ' + esc(lap) + '/' + esc(total) + ' | WX ' + esc(weatherLabel) + '</div>' +
      '<div class="top-icons-row">' + weatherBadge + tyreBadge + teamBadge + '</div>' +
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
          var team = teamFromRow(row);
          var driverHtml = Branding
            ? '<span class="mpp-driver-cell">' +
                Branding.teamBadgeHtml(team, { compact: true, iconOnly: true, scale: 0.075 }) +
                '<span class="mpp-driver-name">' + esc(row.driverName) + '</span>' +
              '</span>'
            : null;
          var tyreHtml = Branding
            ? Branding.tyreBadgeHtml(row.tyreCompound, { compact: true }) +
              '<span style="margin-left:6px;color:var(--console-muted)">' + esc(safe(row.tyreAgeLaps, '-')) + 'L</span>'
            : null;
          return P.raceRow({
            pos: safe(row.position, '-'),
            driver: row.driverName,
            driverHtml: driverHtml,
            gap: safe(row.gapToLeader, '-'),
            interval: safe(row.gapToFront, '-'),
            risk: risk.label,
            riskTone: risk.tone,
            threat: threat.label,
            threatTone: threat.tone,
            stint: deriveStintPhase({ tyreAgeLaps: row.tyreAgeLaps }, signals),
            tyre: safe(row.tyreCompound, '-') + ' / ' + safe(row.tyreAgeLaps, '-') + 'L',
            tyreHtml: tyreHtml,
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

  var TEAM_COLORS = {
    'RED BULL': '#3671c6',
    'FERRARI': '#e8002d',
    'MCLAREN': '#ff8000',
    'MERCEDES': '#00d2be',
    'ASTON MARTIN': '#00665e',
    'ALPINE': '#0093cc',
    'WILLIAMS': '#64c4ff',
    'HAAS': '#b6babd',
    'SAUBER': '#52e252',
    'RACING BULLS': '#6692ff',
  };

  var REPLAY_CLASSIFICATION = [
    { pos: '01', driver: 'VER', team: 'RED BULL', interval: 'LEADER', lap: '53', selected: true },
    { pos: '02', driver: 'LEC', team: 'FERRARI', interval: '+1.242', lap: '53', selected: true },
    { pos: '03', driver: 'NOR', team: 'MCLAREN', interval: '+3.891', lap: '53', selected: false },
    { pos: '04', driver: 'HAM', team: 'MERCEDES', interval: '+8.115', lap: '53', selected: false },
    { pos: '05', driver: 'RUS', team: 'MERCEDES', interval: '+12.504', lap: '53', selected: false },
    { pos: '06', driver: 'SAI', team: 'FERRARI', interval: '+15.882', lap: '53', selected: false },
    { pos: '07', driver: 'PIA', team: 'MCLAREN', interval: '+19.441', lap: '52', selected: false },
    { pos: '08', driver: 'ALO', team: 'ASTON MARTIN', interval: '+24.777', lap: '52', selected: false },
  ];

  var REPLAY_EVENTS = [
    { type: 'OVERTAKE', title: 'VER ON LEC (TURN 1)', lap: 'L48', time: '1:22:15' },
    { type: 'PIT_STOP', title: 'LEC — 2.2S STATIONARY', lap: 'L44', time: '1:16:04' },
    { type: 'BEST_SECTOR', title: 'VER S1 — PERSONAL BEST', lap: 'L40', time: '1:08:42' },
    { type: 'FLAG_INCIDENT', title: 'SAI: LOCK-UP T4', lap: 'L38', time: '1:04:12' },
    { type: 'PIT_STOP', title: 'VER — 2.4S STATIONARY', lap: 'L36', time: '1:00:08' },
  ];

  function buildKineticTelemetrySvg() {
    var lines = [
      { color: '#61d6df', label: 'VER', points: ['0,92','60,68','120,52','180,90','240,44','300,26','360,44','420,68','480,76','540,88','580,92','640,100'] },
      { color: '#f3bf52', label: 'LEC', points: ['0,98','60,74','120,58','180,94','240,50','300,32','360,50','420,74','480,82','540,95','580,98','640,106'] },
    ];
    var polylines = lines.map(function (line) {
      return '<polyline points="' + esc(line.points.join(' ')) + '" stroke="' + esc(line.color) + '" fill="none" stroke-width="2" class="telemetry-line" />';
    }).join('');
    var labels = lines.map(function (line, i) {
      return '<text x="' + esc(10 + i * 40) + '" y="14" fill="' + esc(line.color) + '" font-size="9" font-family="monospace" font-weight="700">' + esc(line.label) + '</text>';
    }).join('');
    return '<svg class="ki-telemetry-svg" viewBox="0 0 640 160" role="img" aria-label="telemetry chart" style="height:130px">' +
      '<rect x="0" y="0" width="640" height="160" class="telemetry-bg" />' +
      '<line x1="0" y1="80" x2="640" y2="80" stroke="rgba(141,157,178,0.12)" stroke-width="1" />' +
      '<line x1="0" y1="40" x2="640" y2="40" stroke="rgba(141,157,178,0.08)" stroke-width="1" />' +
      '<line x1="0" y1="120" x2="640" y2="120" stroke="rgba(141,157,178,0.08)" stroke-width="1" />' +
      polylines +
      labels +
      '<text x="570" y="14" fill="rgba(141,157,178,0.7)" font-size="8" font-family="monospace">CH: 2</text>' +
    '</svg>';
  }

  function buildKineticCircuitSvg(playback) {
    var progress = playback && Number.isFinite(playback.clockMs) ? Math.min(1, (playback.clockMs || 0) / REPLAY_MAX_MS) : 0;
    var angle1 = (progress * Math.PI * 2) - Math.PI / 2;
    var angle2 = ((progress + 0.05) * Math.PI * 2) - Math.PI / 2;
    var x1 = 100 + Math.cos(angle1) * 64;
    var y1 = 100 + Math.sin(angle1) * 49;
    var x2 = 100 + Math.cos(angle2) * 64;
    var y2 = 100 + Math.sin(angle2) * 49;

    return '<svg class="ki-svg-circuit" viewBox="0 0 200 200" role="img" aria-label="circuit map">' +
      '<ellipse cx="100" cy="100" rx="74" ry="56" fill="rgba(14,22,33,0.55)" stroke="rgba(97,214,223,0.2)" stroke-width="1.5" />' +
      '<ellipse cx="100" cy="100" rx="64" ry="48" fill="rgba(6,11,18,0.9)" stroke="rgba(49,71,96,0.4)" stroke-width="1" />' +
      '<line x1="100" y1="22" x2="100" y2="178" stroke="rgba(243,191,82,0.18)" stroke-width="1" stroke-dasharray="3 3" />' +
      '<line x1="26" y1="100" x2="174" y2="100" stroke="rgba(243,191,82,0.18)" stroke-width="1" stroke-dasharray="3 3" />' +
      '<polygon points="' + x1.toFixed(1) + ',' + (y1 - 5).toFixed(1) + ' ' + (x1 + 4).toFixed(1) + ',' + (y1 + 4).toFixed(1) + ' ' + (x1 - 4).toFixed(1) + ',' + (y1 + 4).toFixed(1) + '" fill="#61d6df" class="ki-marker-diamond" />' +
      '<polygon points="' + x2.toFixed(1) + ',' + (y2 - 4).toFixed(1) + ' ' + (x2 + 3).toFixed(1) + ',' + (y2 + 3).toFixed(1) + ' ' + (x2 - 3).toFixed(1) + ',' + (y2 + 3).toFixed(1) + '" fill="#f3bf52" class="ki-marker-diamond" />' +
      '<circle cx="100" cy="100" r="2" fill="rgba(97,214,223,0.5)" />' +
    '</svg>';
  }

  function buildKiGauge(label, value, unit, pct, color) {
    var w = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
    return '<div class="ki-gauge-item">' +
      '<div class="ki-gauge-label">' + esc(label) + '</div>' +
      '<div class="ki-gauge-value" style="color:' + esc(color || 'var(--console-text)') + '">' + esc(value) + '<span style="font-size:11px;margin-left:2px;color:var(--console-muted)">' + esc(unit || '') + '</span></div>' +
      '<div class="ki-gauge-bar-wrap"><div class="ki-gauge-bar" style="width:' + w.toFixed(1) + '%;background:' + esc(color || 'var(--console-cyan)') + '"></div></div>' +
    '</div>';
  }

  function buildKiClassification(state) {
    var session = state.session || {};
    var snapshot = session.snapshot || null;
    var rows = toSessionRows(snapshot);
    var trackedDrivers = state.trackedDrivers || { VER: true, LEC: true };
    var items = rows.length > 0
      ? rows.slice(0, 8).map(function (row, i) {
          var pos = safe(row.position, String(i + 1));
          var driver = row.driverName || ('CAR ' + row.carIndex);
          var team = teamFromRow(row).toUpperCase();
          var teamColor = TEAM_COLORS[team] || '#8d9db2';
          var gap = i === 0 ? 'LEADER' : ('+' + safe(row.gapToLeader, '--'));
          var lap = safe(row.currentLapNum, safe(row.currentLapNum, '?'));
          var selected = !!(trackedDrivers && trackedDrivers[driver]);
          return buildKiClassItem(pos, driver, team, teamColor, gap, lap, selected);
        }).join('')
      : REPLAY_CLASSIFICATION.map(function (item) {
          var teamColor = TEAM_COLORS[item.team] || '#8d9db2';
          return buildKiClassItem(item.pos, item.driver, item.team, teamColor, item.interval, item.lap, item.selected);
        }).join('');
    return items;
  }

  function buildKiClassItem(pos, driver, team, teamColor, interval, lap, selected) {
    var teamBadge = Branding
      ? '<span class="ki-team-inline">' + Branding.teamBadgeHtml(team, { compact: true, iconOnly: true, scale: 0.075 }) + '</span>'
      : '';
    return '<div class="ki-classification-item' + (selected ? ' selected' : '') + '">' +
      '<span class="ki-cls-pos">' + esc(pos) + '</span>' +
      '<div class="ki-cls-bar" style="background:' + esc(teamColor) + '"></div>' +
      '<div>' +
        '<div class="ki-cls-driver">' + teamBadge + esc(driver) + '</div>' +
        '<div style="font:600 8px var(--console-font-mono);color:var(--console-muted);text-transform:uppercase">' + esc(team) + '</div>' +
      '</div>' +
      '<span class="ki-cls-interval">' + esc(interval) + '</span>' +
      '<span class="ki-cls-laps">L' + esc(lap) + '</span>' +
      '<input class="ki-cls-check" type="checkbox" data-action="toggle-driver" data-driver="' + esc(driver) + '" ' + (selected ? 'checked' : '') + ' />' +
    '</div>';
  }

  function buildKiEventLog() {
    return REPLAY_EVENTS.map(function (ev) {
      return '<div class="ki-event-card">' +
        '<div class="ki-event-type">' + esc(ev.type) + '</div>' +
        '<div class="ki-event-title">' + esc(ev.title) + '</div>' +
        '<div class="ki-event-meta">' + esc(ev.lap) + ' | ' + esc(ev.time) + '</div>' +
        '<a class="ki-jump-link" href="#" data-action="jump_to_timecode" data-time="' + esc(ev.time) + '">JUMP_TO_TIMECODE ↗</a>' +
      '</div>';
    }).join('');
  }

  function buildKiTimelineMarkers(events) {
    return events.map(function (ev) {
      var timeMs = parseReplayTimecode(ev.time);
      if (!Number.isFinite(timeMs)) return '';
      var pct = Math.min(100, (timeMs / REPLAY_MAX_MS) * 100);
      return '<div class="ki-event-marker" style="left:' + pct.toFixed(2) + '%"></div>';
    }).join('');
  }

  function renderReplayShell(root, state) {
    var playback = state.playback || {};
    var speedValue = Number(playback.speed);
    var speedLabel = Number.isFinite(speedValue) ? speedValue.toFixed(1) + 'X' : '1.0X';
    var clockMs = playback.clockMs || 0;
    var progressPct = Math.min(100, (clockMs / REPLAY_MAX_MS) * 100);
    var session = state.session || {};
    var snapshot = session.snapshot || {};
    var meta = snapshot.sessionMeta || {};
    var player = getPlayer(snapshot);
    var track = safe(meta.track || (state.access && state.access.roomTitle), 'CIRCUIT');
    var trackLength = '5.793 km';
    var trackTemp = safe(meta.trackTemp, '38') + '°C';
    var sessionTitle = safe(state.access && state.access.roomTitle, 'GP: MONZA');
    var lap = safe(meta.currentLap, '-');
    var totalLaps = safe(meta.totalLaps, '-');
    var weatherBadge = Branding && meta.weather ? Branding.weatherBadgeHtml(meta.weather, { compact: true }) : '';

    var navItems = [
      { key: 'telem', icon: '📈', label: 'TELEMETRY' },
      { key: 'map', icon: '🗺', label: 'SECTOR_MAP' },
      { key: 'sync', icon: '⇌', label: 'DRIVER_SYNC' },
      { key: 'tires', icon: '○', iconHtml: Branding ? Branding.tyreIconHtml(player && player.tyreCompound || 'soft') : '', label: 'TIRES' },
      { key: 'strat', icon: '▶', label: 'STRATEGY' },
    ];
    var activeNav = state.activeReplayRail || 'map';

    var iconRailHtml = '<aside class="ki-icon-rail">' +
      '<div class="icon-rail-avatar">MP</div>' +
      navItems.map(function (item) {
        var active = item.key === activeNav ? ' active' : '';
        var glyphHtml = item.iconHtml ? String(item.iconHtml) : esc(item.icon);
        return '<button class="ki-nav-item' + active + '" type="button" data-rail-key="' + esc(item.key) + '">' +
          '<span class="ki-nav-glyph">' + glyphHtml + '</span>' +
          '<span class="ki-nav-label">' + esc(item.label) + '</span>' +
        '</button>';
      }).join('') +
      '<div class="ki-nav-sep"></div>' +
      '<button class="ki-nav-item logout" type="button" data-action="go-lobby">' +
        '<span class="ki-nav-glyph">⏎</span>' +
        '<span class="ki-nav-label">LOGOUT</span>' +
      '</button>' +
    '</aside>';

    var leftPanelHtml =
      '<aside class="ki-left-panel">' +
        '<div class="ki-left-head">CLASSIFICATION</div>' +
        buildKiClassification(state) +
      '</aside>';

    var telemetryHeadHtml =
      '<div class="ki-telemetry-head">' +
        '<span class="ki-telemetry-label">SYNC_TELEMETRY — SPEED TRAJECTORY</span>' +
        '<span class="ki-telemetry-meta">VER · LEC &nbsp;|&nbsp; CH: 2 &nbsp;|&nbsp; WINDOW: 16S</span>' +
      '</div>' +
      buildKineticTelemetrySvg();

    var trackAreaHtml =
      '<div class="ki-track-area">' +
        buildKineticCircuitSvg(playback) +
        '<div class="ki-circuit-meta">' + esc(track.toUpperCase()) + ' · ' + esc(trackLength) + ' · ' + esc(trackTemp) + '</div>' +
        (weatherBadge ? '<div class="ki-weather-inline">' + weatherBadge + '</div>' : '') +
        '<div class="ki-sector-badges">' +
          '<span class="ki-sector-badge">S1_DELTA −0.043s</span>' +
          '<span class="ki-sector-badge">S2_DELTA +0.118s</span>' +
        '</div>' +
      '</div>';

    var gaugesHtml =
      '<div class="ki-gauges">' +
        buildKiGauge('THR_PCT', '87', '%', 87, '#7fd7a2') +
        buildKiGauge('BRK_PRS', '124', 'bar', 62, '#f27979') +
        buildKiGauge('RPM_ENG', '11.8', 'K', 88, '#f3bf52') +
        buildKiGauge('SRS_DRS', 'OPEN', '', 100, '#61d6df') +
      '</div>';

    var centerHtml =
      '<div class="ki-center">' +
        '<div class="ki-center-top">' + telemetryHeadHtml + '</div>' +
        '<div class="ki-center-main">' +
          trackAreaHtml +
          gaugesHtml +
        '</div>' +
      '</div>';

    var rightPanelHtml =
      '<aside class="ki-right-panel">' +
        '<div class="ki-left-head">EVENT_LOG</div>' +
        buildKiEventLog() +
      '</aside>';

    var timelineMarkers = buildKiTimelineMarkers(REPLAY_EVENTS);

    var footerHtml =
      '<footer class="ki-footer">' +
        '<div class="ki-timeline-row">' +
          '<span style="font:600 9px var(--console-font-mono);color:var(--console-muted);white-space:nowrap">00:00:00</span>' +
          '<div class="ki-timeline-track">' +
            '<div class="ki-timeline-fill" style="width:' + progressPct.toFixed(2) + '%"></div>' +
            timelineMarkers +
            '<input class="ki-scrubber-input" type="range" min="0" max="' + REPLAY_MAX_MS + '" value="' + Math.round(clockMs) + '" data-action="scrub-timeline" />' +
          '</div>' +
          '<span style="font:600 9px var(--console-font-mono);color:var(--console-muted);white-space:nowrap">02:00:00</span>' +
        '</div>' +
        '<div class="ki-playback-row">' +
          '<button class="ki-transport-btn" type="button" data-action="skip-start">&#x23EE;</button>' +
          '<button class="ki-transport-btn" type="button" data-action="step-back">&#x23EA;</button>' +
          '<button class="ki-transport-btn" type="button" data-action="play-pause" style="min-width:44px;font-size:16px">' + (playback.isPlaying ? '&#x23F8;' : '&#x25B6;') + '</button>' +
          '<button class="ki-transport-btn" type="button" data-action="step-forward">&#x23E9;</button>' +
          '<button class="ki-transport-btn" type="button" data-action="skip-end">&#x23ED;</button>' +
          [0.5, 1.0, 2.0].map(function (s) {
            var active = Math.abs(speedValue - s) < 0.01 ? ' active' : '';
            return '<button class="ki-speed-btn' + active + '" type="button" data-speed="' + s + '">' + s.toFixed(1) + 'X</button>';
          }).join('') +
          '<span class="ki-timecode">' + esc(formatReplayClock(clockMs)) + '</span>' +
          '<button class="ki-sync-btn" type="button" data-action="sync-live">SYNC_TO_LIVE</button>' +
          '<span class="ki-latency-meta">DATA_LATENCY: ' + esc(playback.latency || '0.02s') + ' | BUFFER: ' + esc(playback.buffer || '96%') + '</span>' +
        '</div>' +
      '</footer>';

    var headerHtml =
      '<header class="ki-header">' +
        '<div class="ki-brand">KINETIC_INSTRUMENT_V1</div>' +
        P.navTabs([
          { key: 'live', label: 'LIVE' },
          { key: 'replay', label: 'REPLAY' },
          { key: 'archive', label: 'ARCHIVE' },
          { key: 'hub', label: 'DATA_HUB' },
        ], 'replay') +
        '<div class="top-meta">SESSION ' + esc(sessionTitle) + ' | LAPS ' + esc(lap) + '/' + esc(totalLaps) + '</div>' +
        '<div class="top-icons-row">' +
          '<span class="top-icon">S</span>' +
          '<span class="top-icon">?</span>' +
          '<span class="top-avatar"></span>' +
        '</div>' +
      '</header>';

    root.innerHTML =
      '<div class="ki-shell">' +
        headerHtml +
        '<div class="ki-body">' +
          iconRailHtml +
          leftPanelHtml +
          centerHtml +
          rightPanelHtml +
        '</div>' +
        footerHtml +
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
      action: String(cmdKey || '').toUpperCase(),
      authorLabel: 'Engineer',
      severity: cmdKey === 'BOX_THIS_LAP' ? 'high' : (cmdKey === 'HARVEST_MODE' ? 'low' : 'medium'),
    };
    if (Number.isFinite(lap) && lap > 0) {
      payload.lap = Math.floor(lap);
    }

    await apiJson('/api/viewer/actions/' + encodeURIComponent(state.sessionId), {
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
    root.addEventListener('input', function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var action = target.getAttribute('data-action');
      if (action === 'scrub-timeline') {
        var newMs = Number(target.value);
        if (Number.isFinite(newMs)) {
          state.playback.clockMs = clampReplayClock(newMs);
          state.playback.isPlaying = false;
          renderReplayShell(root, state);
        }
      }
    });

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
        speed: 1.0,
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
