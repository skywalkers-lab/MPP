(function () {
  'use strict';

  var BASE = '/assets/branding';
  var TYRE_ICONS = {
    soft: BASE + '/tyres/soft.png',
    medium: BASE + '/tyres/medium.png',
    hard: BASE + '/tyres/hard.png',
    inter: BASE + '/tyres/inter.png',
    wet: BASE + '/tyres/wet.png',
  };

  var WEATHER_ICONS = {
    clear: BASE + '/weather/clear.png',
    'light-cloud': BASE + '/weather/light-cloud.png',
    overcast: BASE + '/weather/overcast.png',
    'light-rain': BASE + '/weather/light-rain.png',
    'heavy-rain': BASE + '/weather/heavy-rain.png',
  };

  var TEAM_SPRITES = {
    ferrari: { x: 10, y: 12, w: 172, h: 228 },
    'red-bull': { x: 314, y: 82, w: 194, h: 96 },
    mercedes: { x: 536, y: 14, w: 210, h: 202 },
    alpine: { x: 798, y: 66, w: 214, h: 118 },
    mclaren: { x: 14, y: 320, w: 248, h: 132 },
    sauber: { x: 334, y: 308, w: 138, h: 154 },
    'aston-martin': { x: 540, y: 356, w: 214, h: 86 },
    haas: { x: 782, y: 306, w: 232, h: 178 },
    'racing-bulls': { x: 18, y: 548, w: 236, h: 184 },
    williams: { x: 268, y: 554, w: 314, h: 176 },
  };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function joinClasses() {
    return Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
  }

  function normalizeSlug(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  function normalizeTyreKey(value) {
    var raw = normalizeSlug(value);
    if (!raw) return '';
    if (raw === 's' || raw.indexOf('soft') === 0) return 'soft';
    if (raw === 'm' || raw.indexOf('med') === 0) return 'medium';
    if (raw === 'h' || raw.indexOf('hard') === 0) return 'hard';
    if (raw === 'i' || raw.indexOf('inter') === 0) return 'inter';
    if (raw === 'w' || raw.indexOf('wet') === 0 || raw.indexOf('full-wet') === 0) return 'wet';
    return raw;
  }

  function normalizeWeatherKey(value) {
    var raw = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
    if (!raw) return '';

    var codeMap = {
      '0': 'clear',
      '1': 'light-cloud',
      '2': 'overcast',
      '3': 'light-rain',
      '4': 'heavy-rain',
      '5': 'heavy-rain',
    };

    if (codeMap[raw]) return codeMap[raw];

    raw = raw.replace(/_/g, ' ').replace(/-/g, ' ');
    if (raw.indexOf('clear') >= 0 || raw.indexOf('sun') >= 0 || raw === 'fine') return 'clear';
    if ((raw.indexOf('cloud') >= 0 || raw.indexOf('partly') >= 0) && raw.indexOf('overcast') < 0) return 'light-cloud';
    if (raw.indexOf('overcast') >= 0 || raw.indexOf('rain soon') >= 0) return 'overcast';
    if (raw.indexOf('light rain') >= 0 || raw.indexOf('drizzle') >= 0 || raw === 'rain') return 'light-rain';
    if (raw.indexOf('heavy rain') >= 0 || raw.indexOf('storm') >= 0 || raw.indexOf('wet') >= 0) return 'heavy-rain';
    return normalizeSlug(raw);
  }

  function normalizeTeamKey(value) {
    var raw = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
    if (!raw || raw === 'team') return '';
    raw = raw.replace(/[_.]/g, ' ').replace(/\s+/g, ' ');

    if (raw.indexOf('red bull') >= 0 || raw === 'rb') return 'red-bull';
    if (raw.indexOf('ferrari') >= 0 || raw === 'fer') return 'ferrari';
    if (raw.indexOf('mclaren') >= 0 || raw === 'mcl') return 'mclaren';
    if (raw.indexOf('mercedes') >= 0 || raw === 'mer') return 'mercedes';
    if (raw.indexOf('aston') >= 0) return 'aston-martin';
    if (raw.indexOf('alpine') >= 0) return 'alpine';
    if (raw.indexOf('williams') >= 0 || raw === 'wil') return 'williams';
    if (raw.indexOf('haas') >= 0) return 'haas';
    if (raw.indexOf('sauber') >= 0 || raw.indexOf('kick') >= 0) return 'sauber';
    if (raw.indexOf('racing bulls') >= 0 || raw.indexOf('vcarb') >= 0 || raw.indexOf('visa cash app') >= 0 || raw.indexOf('alphatauri') >= 0) return 'racing-bulls';

    return normalizeSlug(raw);
  }

  function tyreLabel(key, fallback) {
    var labels = {
      soft: 'SOFT',
      medium: 'MEDIUM',
      hard: 'HARD',
      inter: 'INTER',
      wet: 'WET',
    };
    return labels[key] || String(fallback || key || '-').toUpperCase();
  }

  function weatherLabel(key, fallback) {
    var labels = {
      clear: 'CLEAR',
      'light-cloud': 'LIGHT CLOUD',
      overcast: 'OVERCAST',
      'light-rain': 'LIGHT RAIN',
      'heavy-rain': 'HEAVY RAIN',
    };
    return labels[key] || String(fallback || key || '-').toUpperCase();
  }

  function imageHtml(src, alt, className) {
    if (!src) return '';
    return '<img class="' + esc(joinClasses('mpp-brand-icon', className)) + '" src="' + esc(src) + '" alt="' + esc(alt || '') + '" loading="lazy" decoding="async" />';
  }

  function tyreIconHtml(value, options) {
    var opts = options || {};
    var key = normalizeTyreKey(value);
    return imageHtml(TYRE_ICONS[key], tyreLabel(key, value), joinClasses('mpp-tyre-icon', opts.className));
  }

  function weatherIconHtml(value, options) {
    var opts = options || {};
    var key = normalizeWeatherKey(value);
    return imageHtml(WEATHER_ICONS[key], weatherLabel(key, value), joinClasses('mpp-weather-icon', opts.className));
  }

  function buildFallback(text) {
    var raw = String(text || '?').trim().toUpperCase();
    return '<span class="mpp-brand-fallback">' + esc(raw.slice(0, 2) || '?') + '</span>';
  }

  function teamSpriteHtml(value, options) {
    var opts = options || {};
    var key = normalizeTeamKey(value);
    var sprite = TEAM_SPRITES[key];
    if (!sprite) return '';

    var scale = Number.isFinite(opts.scale)
      ? opts.scale
      : (opts.compact ? 0.085 : 0.11);
    var width = Math.max(16, Math.round(sprite.w * scale));
    var height = Math.max(12, Math.round(sprite.h * scale));
    var style = [
      'width:' + width + 'px',
      'height:' + height + 'px',
      'background-image:url(' + BASE + '/teams/team-logos.png)',
      'background-repeat:no-repeat',
      'background-size:' + Math.round(1024 * scale) + 'px ' + Math.round(1024 * scale) + 'px',
      'background-position:' + Math.round(-sprite.x * scale) + 'px ' + Math.round(-sprite.y * scale) + 'px'
    ].join(';');

    return '<span class="' + esc(joinClasses('mpp-team-logo-sprite', opts.className)) + '" style="' + esc(style) + '" role="img" aria-label="' + esc(String(value || key).toUpperCase()) + ' logo"></span>';
  }

  function badgeHtml(kind, value, options) {
    var opts = options || {};
    var compact = !!opts.compact;
    var iconOnly = !!opts.iconOnly;
    var key = kind === 'weather' ? normalizeWeatherKey(value) : normalizeTyreKey(value);
    var label = kind === 'weather' ? weatherLabel(key, value) : tyreLabel(key, value);
    var icon = kind === 'weather'
      ? weatherIconHtml(key, { className: compact ? 'is-compact' : '' })
      : tyreIconHtml(key, { className: compact ? 'is-compact' : '' });
    var cls = joinClasses('mpp-brand-badge', kind + '-badge', compact && 'is-compact', key && (kind + '-badge-' + key));

    return '<span class="' + esc(cls) + '">' +
      (icon || buildFallback(label)) +
      (iconOnly ? '' : '<span class="mpp-brand-label">' + esc(label) + '</span>') +
    '</span>';
  }

  function tyreBadgeHtml(value, options) {
    return badgeHtml('tyre', value, options);
  }

  function weatherBadgeHtml(value, options) {
    return badgeHtml('weather', value, options);
  }

  function teamBadgeHtml(value, options) {
    var opts = options || {};
    var label = String(value || 'TEAM').toUpperCase();
    var compact = !!opts.compact;
    var iconOnly = !!opts.iconOnly;
    var icon = teamSpriteHtml(value, opts);
    var cls = joinClasses('mpp-brand-badge', 'team-badge', compact && 'is-compact');

    return '<span class="' + esc(cls) + '">' +
      (icon || buildFallback(label)) +
      (iconOnly ? '' : '<span class="mpp-brand-label">' + esc(label) + '</span>') +
    '</span>';
  }

  window.MPPBranding = {
    tyreIcons: TYRE_ICONS,
    weatherIcons: WEATHER_ICONS,
    normalizeTyreKey: normalizeTyreKey,
    normalizeWeatherKey: normalizeWeatherKey,
    normalizeTeamKey: normalizeTeamKey,
    tyreIconHtml: tyreIconHtml,
    weatherIconHtml: weatherIconHtml,
    teamSpriteHtml: teamSpriteHtml,
    tyreBadgeHtml: tyreBadgeHtml,
    weatherBadgeHtml: weatherBadgeHtml,
    teamBadgeHtml: teamBadgeHtml,
  };
})();
