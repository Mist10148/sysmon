/*
  Formatting and comparison.

  Timestamps are local ISO-8601 at second precision - "2026-08-28T14:02:11" -
  and that is deliberate. The monitoring form records local dates, and the
  History filters compare on the leading "YYYY-MM-DD", which only works if the
  stored string is already local. Nothing here uses UTC or a Z suffix.
*/
window.SM = window.SM || {};

SM.fmt = (function () {
  'use strict';

  var MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June',
                'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* Date -> "2026-08-28T14:02:11" */
  function iso(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* Date -> "2026-08-28", which is what the date inputs and filters use. */
  function isoDate(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /*
    "2026-08-28T14:02:11" -> Date, parsed as local time.
    new Date(string) would read a bare date as UTC, which shifts every timestamp
    by the timezone offset and makes a check recorded at 00:30 fall on the wrong
    day. So the parts are pulled out by hand.
  */
  function parse(value) {
    if (value instanceof Date) return value;
    if (!value) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  function dayOf(value) { return String(value || '').slice(0, 10); }

  /* "Aug. 28, 2026" */
  function dateLabel(value) {
    var d = parse(value);
    if (!d) return '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /* "2:02 PM" */
  function timeLabel(value) {
    var d = parse(value);
    if (!d) return '';
    var h = d.getHours();
    var suffix = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    return h + ':' + pad(d.getMinutes()) + ' ' + suffix;
  }

  /* "Today", "Yesterday", or "Thursday, August 28". Used by the activity feed. */
  function dayHeading(value) {
    var d = parse(value);
    if (!d) return '';
    var today = new Date();
    var a = isoDate(d), b = isoDate(today);
    if (a === b) return 'Today';
    var y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (a === isoDate(y)) return 'Yesterday';
    var full = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
    return DAYS[d.getDay()] + ', ' + full[d.getMonth()] + ' ' + d.getDate();
  }

  /* "just now", "4m ago", "3h ago", "2d ago". */
  function relative(value, now) {
    var d = parse(value);
    if (!d) return 'never';
    var secs = Math.round(((now || new Date()) - d) / 1000);
    if (secs < 0) secs = 0;
    if (secs < 10) return 'just now';
    if (secs < 60) return secs + 's ago';
    var mins = Math.round(secs / 60);
    if (mins < 60) return mins + 'm ago';
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.round(hours / 24);
    if (days < 30) return days + 'd ago';
    return dateLabel(value);
  }

  /* Milliseconds -> "45m", "1h 12m", "3d 4h". */
  function duration(ms) {
    if (ms == null || isNaN(ms)) return '--';
    var mins = Math.round(ms / 60000);
    if (mins < 1) return 'under a minute';
    if (mins < 60) return mins + 'm';
    var hours = Math.floor(mins / 60);
    var rem = mins % 60;
    if (hours < 24) return rem ? hours + 'h ' + rem + 'm' : hours + 'h';
    var days = Math.floor(hours / 24);
    var remH = hours % 24;
    return remH ? days + 'd ' + remH + 'h' : days + 'd';
  }

  function latency(ms) {
    if (ms == null || ms === '' || isNaN(ms)) return '--';
    return Math.round(ms) + ' ms';
  }

  function percent(value, places) {
    if (value == null || isNaN(value)) return '--';
    var p = places == null ? 1 : places;
    return value.toFixed(p) + '%';
  }

  function coords(lat, lng) {
    if (lat == null || lng == null) return '--';
    return Number(lat).toFixed(4) + ', ' + Number(lng).toFixed(4);
  }

  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  /* Describes how a system is checked, in the words the Systems table uses. */
  function describeCheckMethod(system) {
    if (!system) return '--';
    if (system.check_method !== 'http') return 'ICMP ping';
    var port = system.http_port ? ':' + system.http_port : '';
    var path = system.http_path || '/';
    return 'GET ' + (system.http_scheme || 'http') + '://host' + port + path +
      ' → ' + (system.http_expect_status || 200);
  }

  /* ---------- comparison ---------- */

  function text(a, b) {
    return String(a == null ? '' : a).trim().toLowerCase()
      .localeCompare(String(b == null ? '' : b).trim().toLowerCase());
  }

  /*
    Octet-aware, because a plain string sort puts 172.24.143.10 after
    172.24.143.168 and an operator scanning a column of addresses notices.
  */
  function ip(a, b) {
    var pa = String(a || '').split('.');
    var pb = String(b || '').split('.');
    for (var i = 0; i < 4; i++) {
      var x = parseInt(pa[i], 10); if (isNaN(x)) x = -1;
      var y = parseInt(pb[i], 10); if (isNaN(y)) y = -1;
      if (x !== y) return x - y;
    }
    return text(a, b);
  }

  function num(a, b) {
    var x = a == null || a === '' ? -Infinity : Number(a);
    var y = b == null || b === '' ? -Infinity : Number(b);
    if (x === y) return 0;
    return x < y ? -1 : 1;
  }

  return {
    pad: pad, iso: iso, isoDate: isoDate, parse: parse, dayOf: dayOf,
    dateLabel: dateLabel, timeLabel: timeLabel, dayHeading: dayHeading,
    relative: relative, duration: duration, latency: latency, percent: percent,
    coords: coords, bytes: bytes, plural: plural,
    describeCheckMethod: describeCheckMethod,
    compareText: text, compareIp: ip, compareNum: num,
    MONTHS: MONTHS
  };
})();
