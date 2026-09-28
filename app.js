(function () {
  'use strict';

  var LOCATIONS = [
    { id: 'boca',      name: 'Boca Raton', region: 'Florida, USA',         lat: 26.3683, lon: -80.1289, tz: 'America/New_York' },
    { id: 'fargo',     name: 'Fargo',      region: 'North Dakota, USA',    lat: 46.8772, lon: -96.7898, tz: 'America/Chicago' },
    { id: 'guadalupe', name: 'Guadalupe',  region: 'San José, Costa Rica', lat: 9.9476,  lon: -84.0544, tz: 'America/Costa_Rica' }
  ];

  var API = 'https://api.open-meteo.com/v1/forecast';
  var REFRESH_MS = 10 * 60 * 1000;
  var HOURS_SHOWN = 12;
  var DAYS_SHOWN = 6;

  var state = {
    unit: readUnit(),
    data: {},   // location id -> Open-Meteo response
    errors: {}  // location id -> true when the last fetch failed
  };

  /* ---------- Unit preference (per browser, optional) ---------- */

  function readUnit() {
    try {
      var u = localStorage.getItem('unit');
      return u === 'F' || u === 'K' ? u : 'C';
    } catch (e) { return 'C'; }
  }
  function saveUnit(u) {
    try { localStorage.setItem('unit', u); } catch (e) { /* storage unavailable */ }
  }

  /* ---------- Conversions ---------- */

  // The API is queried in °C and km/h; conversion happens locally so the
  // unit toggle is instant and needs no extra request.
  function temp(c) {
    if (c == null || isNaN(c)) return '--';
    if (state.unit === 'K') return Math.round(c + 273.15) + '\u2009K'; // kelvin takes no degree sign
    return Math.round(state.unit === 'F' ? c * 9 / 5 + 32 : c) + '°';
  }
  function wind(kmh) {
    if (kmh == null || isNaN(kmh)) return '--';
    return state.unit === 'F' ? Math.round(kmh * 0.621371) + ' mph' : Math.round(kmh) + ' km/h';
  }

  /* ---------- WMO weather codes ---------- */

  var WMO = {
    0: ['Clear', 'clear'],
    1: ['Mostly Clear', 'clear'],
    2: ['Partly Cloudy', 'partly'],
    3: ['Overcast', 'cloud'],
    45: ['Fog', 'fog'], 48: ['Freezing Fog', 'fog'],
    51: ['Light Drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy Drizzle', 'rain'],
    56: ['Freezing Drizzle', 'sleet'], 57: ['Freezing Drizzle', 'sleet'],
    61: ['Light Rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy Rain', 'rain'],
    66: ['Freezing Rain', 'sleet'], 67: ['Freezing Rain', 'sleet'],
    71: ['Light Snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy Snow', 'snow'], 77: ['Snow Grains', 'snow'],
    80: ['Showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Heavy Showers', 'rain'],
    85: ['Snow Showers', 'snow'], 86: ['Snow Showers', 'snow'],
    95: ['Thunderstorms', 'storm'], 96: ['Thunderstorms', 'storm'], 99: ['Thunderstorms', 'storm']
  };
  function describe(code) { return WMO[code] || ['Unknown', 'cloud']; }

  /* ---------- Glossy SVG icons ---------- */

  var CLOUD = 'M20 50H47A10 10 0 0 0 47 30A14 14 0 0 0 22 25A12.5 12.5 0 0 0 20 50Z';
  var SMALL_CLOUD = 'M24 52H48A8.5 8.5 0 0 0 48 35A12 12 0 0 0 27 31A10.5 10.5 0 0 0 24 52Z';

  function sun(cx, cy, r) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="url(#gSun)" stroke="#e08a00" stroke-width="1"/>' +
      '<ellipse cx="' + (cx - r * .25) + '" cy="' + (cy - r * .45) + '" rx="' + r * .5 + '" ry="' + r * .28 + '" fill="#fff" opacity=".55"/>';
  }
  function moon(cx, cy, r) {
    return '<path d="M' + (cx + r * .3) + ' ' + (cy - r) + 'A' + r + ' ' + r + ' 0 1 0 ' + (cx + r) + ' ' + (cy + r * .35) +
      'A' + r * .8 + ' ' + r * .8 + ' 0 0 1 ' + (cx + r * .3) + ' ' + (cy - r) + 'Z" fill="url(#gMoon)" stroke="#9aa3b3"/>';
  }
  function cloud(path, dark) {
    return '<path d="' + path + '" fill="url(#' + (dark ? 'gCloudDark' : 'gCloud') + ')" stroke="' + (dark ? '#4b545e' : '#8e9fb2') + '" stroke-width="1.2"/>';
  }
  function drops() {
    return '<path d="M24 53l-3 7M34 53l-3 7M44 53l-3 7" stroke="url(#gDrop)" stroke-width="3.5" stroke-linecap="round"/>';
  }
  function flakes() {
    return '<g fill="#fff" stroke="#9fb3c8" stroke-width=".8"><circle cx="23" cy="56" r="3"/><circle cx="33" cy="60" r="3"/><circle cx="43" cy="56" r="3"/></g>';
  }

  function icon(kind, isDay) {
    var body;
    switch (kind) {
      case 'clear':
        body = isDay ? sun(32, 32, 17) : moon(32, 32, 16);
        break;
      case 'partly':
        body = (isDay ? sun(24, 24, 13) : moon(24, 24, 12)) + cloud(SMALL_CLOUD);
        break;
      case 'cloud':
        body = cloud('M16 40H41A9 9 0 0 0 41 22A12 12 0 0 0 19 19A10.5 10.5 0 0 0 16 40Z', true) + cloud(CLOUD);
        break;
      case 'fog':
        body = cloud('M20 40H47A10 10 0 0 0 47 20A14 14 0 0 0 22 15A12.5 12.5 0 0 0 20 40Z') +
          '<path d="M12 47H52M16 54H48M20 61H44" stroke="#e4ebf2" stroke-width="3.5" stroke-linecap="round"/>';
        break;
      case 'rain':
        body = cloud('M20 46H47A10 10 0 0 0 47 26A14 14 0 0 0 22 21A12.5 12.5 0 0 0 20 46Z') + drops();
        break;
      case 'sleet':
        body = cloud('M20 46H47A10 10 0 0 0 47 26A14 14 0 0 0 22 21A12.5 12.5 0 0 0 20 46Z') +
          '<path d="M24 52l-3 7M44 52l-3 7" stroke="url(#gDrop)" stroke-width="3.5" stroke-linecap="round"/>' +
          '<circle cx="33" cy="57" r="3" fill="#fff" stroke="#9fb3c8" stroke-width=".8"/>';
        break;
      case 'snow':
        body = cloud('M20 46H47A10 10 0 0 0 47 26A14 14 0 0 0 22 21A12.5 12.5 0 0 0 20 46Z') + flakes();
        break;
      case 'storm':
        body = cloud('M20 44H47A10 10 0 0 0 47 24A14 14 0 0 0 22 19A12.5 12.5 0 0 0 20 44Z', true) +
          '<path d="M35 40L26 53H33L29 63L42 48H35L39 40Z" fill="url(#gBolt)" stroke="#c07a00" stroke-width="1"/>';
        break;
      default:
        body = cloud(CLOUD);
    }
    return '<svg class="icon" viewBox="0 0 64 64" aria-hidden="true">' + body + '</svg>';
  }

  /* ---------- CRT screens ---------- */

  // Set to false for plain screens without the CRT treatment.
  // For side-by-side comparison, append ?crt=0 or ?crt=1 to the URL.
  var CRT = (function () {
    var q = /[?&]crt=([01])/.exec(location.search);
    return q ? q[1] === '1' : true;
  })();

  // Coordinate space of the main screen (every card shares it, so one CRT filter fits all)
  var TW = { w: 300, h: 160, cx: 50, cy: 46 };

  // Main screen: minimal monochrome clock, digital time and date, then current conditions.
  function heroSVG() {
    var c = TW.cx, y = TW.cy, ticks = '';
    for (var i = 0; i < 12; i++) {
      var major = i % 3 === 0;
      ticks += '<line x1="' + c + '" y1="' + (y - 33) + '" x2="' + c + '" y2="' + (y - (major ? 27 : 30)) +
        '" stroke-width="' + (major ? 1.8 : 1) + '" transform="rotate(' + i * 30 + ' ' + c + ' ' + y + ')"/>';
    }
    return '<svg viewBox="0 0 ' + TW.w + ' ' + TW.h + '" role="img">' +
      '<g' + (CRT ? ' filter="url(#crtWarp)"' : '') + '>' +
        // Transparent backing so the filter region always spans the whole screen
        '<rect width="' + TW.w + '" height="' + TW.h + '" fill="#000" fill-opacity="0"/>' +
        '<circle cx="' + c + '" cy="' + y + '" r="36" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="1"/>' +
        '<g stroke="currentColor" stroke-linecap="round">' + ticks +
          '<line class="hand-h" x1="' + c + '" y1="' + y + '" x2="' + c + '" y2="' + (y - 17) + '" stroke-width="3.2"/>' +
          '<line class="hand-m" x1="' + c + '" y1="' + y + '" x2="' + c + '" y2="' + (y - 26) + '" stroke-width="2"/>' +
          '<line class="hand-s" x1="' + c + '" y1="' + (y + 6) + '" x2="' + c + '" y2="' + (y - 31) + '" stroke-width=".8" stroke-opacity=".75"/>' +
        '</g>' +
        '<circle cx="' + c + '" cy="' + y + '" r="2.4" fill="currentColor"/>' +
        '<text class="tw-time" x="104" y="52" fill="currentColor"><tspan class="hm"></tspan><tspan class="ap" dx="4"></tspan></text>' +
        '<text class="tw-date" x="105" y="72" fill="currentColor"></text>' +
        '<line x1="14" y1="92" x2="286" y2="92" stroke="currentColor" stroke-opacity=".22"/>' +
        '<g class="tw-icon"></g>' +
        '<text class="tw-temp" x="80" y="143" fill="currentColor">--</text>' +
        '<text class="tw-cond" x="286" y="122" text-anchor="end" fill="currentColor"></text>' +
        '<text class="tw-hilo" x="286" y="141" text-anchor="end" fill="currentColor"></text>' +
      '</g>' +
    '</svg>';
  }

  // Builds the barrel-distortion map for the CRT filter: each pixel encodes how far
  // to pull the image toward the edges, so content bulges like curved glass.
  function buildCrtMap() {
    if (!CRT) return;
    var feImage = document.getElementById('crtMap');
    if (!feImage) return;
    var W = TW.w, H = TW.h, maxX = 7, maxY = 6, scale = 20;
    var filter = document.getElementById('crtWarp');
    [filter, feImage].forEach(function (el) {
      el.setAttribute('width', W);
      el.setAttribute('height', H);
    });
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(W, H);
    for (var py = 0; py < H; py++) {
      for (var px = 0; px < W; px++) {
        var nx = (px + .5) / W * 2 - 1, ny = (py + .5) / H * 2 - 1;
        var r2 = (nx * nx + ny * ny) / 2;
        var k = (py * W + px) * 4;
        img.data[k]     = Math.round(255 * (.5 + maxX * nx * r2 / scale));
        img.data[k + 1] = Math.round(255 * (.5 + maxY * ny * r2 / scale));
        img.data[k + 2] = 128;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    var url = cv.toDataURL('image/png');
    feImage.setAttribute('href', url);
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
  }

  var formatters = {};
  function fmt(tz, key, opts) {
    var k = tz + key;
    if (!formatters[k]) {
      var o = { timeZone: tz };
      for (var p in opts) o[p] = opts[p];
      formatters[k] = new Intl.DateTimeFormat('en-US', o);
    }
    return formatters[k];
  }

  function timeParts(tz, now) {
    var parts = fmt(tz, 'parts', { hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(now);
    var out = {};
    parts.forEach(function (p) { if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10); });
    return out;
  }

  function tick() {
    var now = new Date();
    LOCATIONS.forEach(function (loc) {
      var card = document.getElementById('card-' + loc.id);
      if (!card) return;
      var t = timeParts(loc.tz, now);
      var h = t.hour % 24, m = t.minute, s = t.second;
      var svg = card.querySelector('.hero svg');
      var pivot = ' ' + TW.cx + ' ' + TW.cy + ')';
      svg.querySelector('.hand-h').setAttribute('transform', 'rotate(' + ((h % 12) * 30 + m * 0.5) + pivot);
      svg.querySelector('.hand-m').setAttribute('transform', 'rotate(' + (m * 6 + s * 0.1) + pivot);
      svg.querySelector('.hand-s').setAttribute('transform', 'rotate(' + s * 6 + pivot);

      var timeText = fmt(loc.tz, 'time', { hour: 'numeric', minute: '2-digit' }).format(now);
      var split = timeText.split(/\s+/);
      svg.querySelector('.hm').textContent = split[0];
      svg.querySelector('.ap').textContent = split[1] || '';
      svg.querySelector('.tw-date').textContent =
        fmt(loc.tz, 'date', { weekday: 'long', month: 'short', day: 'numeric' }).format(now);
      svg.setAttribute('aria-label', 'Local time in ' + loc.name + ': ' + timeText);
    });
  }

  /* ---------- Rendering ---------- */

  var cardsEl = document.getElementById('cards');

  function buildShells() {
    cardsEl.innerHTML = LOCATIONS.map(function (loc) {
      return '<article class="card" id="card-' + loc.id + '" aria-label="' + loc.name + '">' +
        '<div class="gloss"></div>' +
        '<div class="card-top">' +
          '<div class="place"><h2>' + loc.name + '</h2><p class="region">' + loc.region + '</p></div>' +
        '</div>' +
        '<div class="screen hero' + (CRT ? ' crt' : '') + '">' + heroSVG() + '</div>' +
        '<div class="weather"><p class="message"><span class="skeleton"></span></p></div>' +
      '</article>';
    }).join('');

  }

  function dayName(isoDate, i) {
    if (i === 0) return 'Today';
    var d = new Date(isoDate + 'T12:00:00Z');
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
  }

  function hourLabel(isoLocal, isNow) {
    if (isNow) return 'Now';
    var h = parseInt(isoLocal.slice(11, 13), 10);
    return (h % 12 || 12) + (h < 12 ? 'AM' : 'PM');
  }

  function renderWeather(loc) {
    var card = document.getElementById('card-' + loc.id);
    var box = card.querySelector('.weather');
    var d = state.data[loc.id];

    if (!d) {
      if (state.errors[loc.id]) {
        box.innerHTML = '<div class="message">Weather unavailable.<br><button type="button">Try Again</button></div>';
        box.querySelector('button').addEventListener('click', function () { loadOne(loc); });
      }
      return;
    }

    var c = d.current;
    var info = describe(c.weather_code);
    var isDay = c.is_day === 1;
    card.classList.toggle('night', !isDay);

    // Current conditions on the main screen
    var hero = card.querySelector('.hero svg');
    hero.querySelector('.tw-icon').innerHTML =
      icon(info[1], isDay).replace('<svg class="icon"', '<svg x="14" y="98" width="56" height="56"');
    var tempEl = hero.querySelector('.tw-temp');
    tempEl.textContent = temp(c.temperature_2m);
    tempEl.classList.toggle('long', state.unit === 'K'); // "302 K" needs a smaller size to clear the label
    hero.querySelector('.tw-cond').textContent = info[0];
    hero.querySelector('.tw-hilo').textContent =
      'H ' + temp(d.daily.temperature_2m_max[0]) + '\u2003L ' + temp(d.daily.temperature_2m_min[0]);

    // Hourly: start at the current local hour
    var hourKey = c.time.slice(0, 13) + ':00';
    var start = Math.max(0, d.hourly.time.indexOf(hourKey));
    var hours = '';
    for (var i = start; i < Math.min(start + HOURS_SHOWN, d.hourly.time.length); i++) {
      var hk = describe(d.hourly.weather_code[i])[1];
      hours += '<div class="hour' + (i === start ? ' current' : '') + '">' +
        '<div class="h">' + hourLabel(d.hourly.time[i], i === start) + '</div>' +
        icon(hk, d.hourly.is_day[i] === 1) +
        '<div class="t">' + temp(d.hourly.temperature_2m[i]) + '</div></div>';
    }

    var days = '';
    for (var j = 0; j < Math.min(DAYS_SHOWN, d.daily.time.length); j++) {
      days += '<li><span class="d">' + dayName(d.daily.time[j], j) + '</span>' +
        icon(describe(d.daily.weather_code[j])[1], true) +
        '<span class="hi">' + temp(d.daily.temperature_2m_max[j]) + '</span>' +
        '<span class="lo">' + temp(d.daily.temperature_2m_min[j]) + '</span></li>';
    }

    box.innerHTML =
      '<div class="screen forecast' + (CRT ? ' crt' : '') + '"><div class="screen-body">' +
      '<div class="details">' +
        '<div>Feels Like<b>' + temp(c.apparent_temperature) + '</b></div>' +
        '<div>Humidity<b>' + Math.round(c.relative_humidity_2m) + '%</b></div>' +
        '<div>Wind<b>' + wind(c.wind_speed_10m) + '</b></div>' +
      '</div>' +
      '<div class="hourly">' + hours + '</div>' +
      '<ul class="daily">' + days + '</ul></div></div>';
  }

  function renderAll() { LOCATIONS.forEach(renderWeather); }

  /* ---------- Data ---------- */

  function url(loc) {
    return API +
      '?latitude=' + loc.lat + '&longitude=' + loc.lon +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
      '&hourly=temperature_2m,weather_code,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&timezone=' + encodeURIComponent(loc.tz) +
      '&forecast_days=7';
  }

  function loadOne(loc) {
    return fetch(url(loc))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        state.data[loc.id] = json;
        state.errors[loc.id] = false;
      })
      .catch(function (err) {
        console.error('Weather request failed for ' + loc.name, err);
        state.errors[loc.id] = true;
      })
      .then(function () { renderWeather(loc); });
  }

  var refreshBtn = document.getElementById('refresh');
  var updatedEl = document.getElementById('updated');

  function loadAll() {
    refreshBtn.classList.add('spinning');
    refreshBtn.disabled = true;
    return Promise.all(LOCATIONS.map(loadOne)).then(function () {
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = false;
      var ok = LOCATIONS.some(function (l) { return !state.errors[l.id]; });
      updatedEl.textContent = ok
        ? 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'Unable to reach Open-Meteo';
    });
  }

  /* ---------- Controls ---------- */

  function setUnit(u) {
    state.unit = u;
    saveUnit(u);
    document.querySelectorAll('.segmented button').forEach(function (b) {
      var on = b.getAttribute('data-unit') === u;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderAll();
  }

  document.querySelectorAll('.segmented button').forEach(function (b) {
    b.addEventListener('click', function () { setUnit(b.getAttribute('data-unit')); });
  });
  refreshBtn.addEventListener('click', loadAll);

  // Refresh when returning to a tab that has been in the background
  var lastLoad = 0;
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - lastLoad > REFRESH_MS) { lastLoad = Date.now(); loadAll(); }
  });

  /* ---------- Start ---------- */

  buildCrtMap();
  buildShells();
  setUnit(state.unit);
  tick();
  setInterval(tick, 1000);
  lastLoad = Date.now();
  loadAll();
  setInterval(function () { lastLoad = Date.now(); loadAll(); }, REFRESH_MS);
})();
