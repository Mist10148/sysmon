/*
  Badges and the status card.

  The rule these enforce: colour is never the only thing carrying meaning. Every
  status badge has a word in it and every system badge has its name in it, both
  because three of the light system colours fall under a 3:1 contrast ratio
  against their own fill, and because a printed monitoring form is grey.
*/
window.SM = window.SM || {};
SM.ui = SM.ui || {};

(function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;
  var attr = SM.dom.attr;
  var cx = SM.dom.cx;

  /* Hex equivalents of the health tokens, for SVG fills and Leaflet markers,
     which cannot read a CSS custom property from a stylesheet. */
  var STATUS_HEX = {
    Functional: '#3b9e63',
    Restored: '#d9a13b',
    Down: '#c8483c',
    Unknown: '#8a8782'
  };

  function StatusBadge(status, size) {
    var s = status || 'Unknown';
    return raw('<span class="' + cx('badge', size === 'sm' && 'badge-sm') +
      '" data-status="' + SM.dom.esc(s) + '">' +
      '<span class="badge-dot"></span>' + SM.dom.esc(s) + '</span>');
  }

  function SystemBadge(system, opts) {
    if (!system) return raw('<span class="badge badge-sm" data-status="Unknown">Unassigned</span>');
    var o = opts || {};
    var color = system.system_type_color || system.color || 'slate';
    var name = system.system_type_name || system.name || '';
    return raw('<span class="badge-sys" data-sys="' + SM.dom.esc(color) + '"' +
      attr('title', o.title) + '>' +
      '<span class="sys-dot" data-sys="' + SM.dom.esc(color) + '"></span>' +
      SM.dom.esc(name) + '</span>');
  }

  function SystemDot(color) {
    return raw('<span class="sys-dot" data-sys="' + SM.dom.esc(color || 'slate') + '"></span>');
  }

  /* The tick or cross in the monitoring form's Functional column. */
  function FunctionalMark(on) {
    return raw('<span class="functional-mark" data-on="' + (on ? 'true' : 'false') +
      '" role="img" aria-label="' + (on ? 'Functional' : 'Not functional') + '">' +
      (on ? '&#10003;' : '&#10007;') + '</span>');
  }

  /*
    One target, as it appears in the dashboard list and in the map rail. A
    button rather than a div, because clicking it selects the matching pin.

    row is a currentStatus() row: a location with its latest check folded in.
  */
  function StatusCard(row, opts) {
    var o = opts || {};
    var numbers;
    if (!row.latest) {
      numbers = 'Not yet checked';
    } else if (row.check_method === 'http') {
      numbers = SM.fmt.latency(row.avg_latency_ms) +
        (row.http_status ? ' · HTTP ' + row.http_status : '');
    } else {
      numbers = SM.fmt.latency(row.avg_latency_ms) + ' · ' +
        SM.fmt.percent(row.loss_pct, 0) + ' loss';
    }

    return raw(html`
      <button type="button" class="status-card" data-act="select-target"
              data-id="${row.id}" data-selected="${o.selected ? 'true' : 'false'}">
        <div class="status-card-top">
          <span class="status-card-name">${row.name}</span>
          ${StatusBadge(row.status, 'sm')}
        </div>
        <div class="status-card-meta">
          ${SystemBadge(row)}
          <span class="text-11 text-faint mono">${row.ip}</span>
        </div>
        <div class="status-card-numbers">${numbers}</div>
        <div class="status-card-time">${row.checked_at ? SM.fmt.relative(row.checked_at) : ''}</div>
      </button>`);
  }

  /* The dashboard's system filter. "All systems" first, then one per system. */
  function SystemChips(systems, activeId) {
    return raw(html`
      <div class="chips" role="group" aria-label="Filter by system">
        <button type="button" class="chip" data-act="filter-system" data-value=""
                aria-pressed="${!activeId ? 'true' : 'false'}">All systems</button>
        ${systems.map(function (s) {
          return raw('<button type="button" class="chip" data-act="filter-system"' +
            ' data-value="' + s.id + '" aria-pressed="' +
            (String(activeId) === String(s.id) ? 'true' : 'false') + '">' +
            '<span class="sys-dot" data-sys="' + SM.dom.esc(s.color) + '"></span>' +
            SM.dom.esc(s.name) + '</button>');
        })}
      </div>`);
  }

  /* The circular icon badge on an activity row. */
  var ACTIVITY_ICONS = {
    'sweep.run': 'refresh-cw',
    'status.down': 'arrow-down-circle',
    'status.restored': 'arrow-up-circle',
    'settings.update': 'settings-2',
    'activity.prune': 'trash-2',
    'check.edit': 'pencil',
    'location.create': 'map-pin',
    'location.update': 'map-pin',
    'location.delete': 'trash-2',
    'system_type.create': 'layout-grid',
    'system_type.update': 'layout-grid',
    'system_type.delete': 'trash-2'
  };

  function ActivityBadge(row) {
    var name = ACTIVITY_ICONS[row.action] || 'info';
    return raw('<span class="act-badge" data-sev="' + SM.dom.esc(row.severity) + '">' +
      SM.dom.icon(name, 'icon-sm') + '</span>');
  }

  SM.ui.StatusBadge = StatusBadge;
  SM.ui.SystemBadge = SystemBadge;
  SM.ui.SystemDot = SystemDot;
  SM.ui.FunctionalMark = FunctionalMark;
  SM.ui.StatusCard = StatusCard;
  SM.ui.SystemChips = SystemChips;
  SM.ui.ActivityBadge = ActivityBadge;
  SM.ui.STATUS_HEX = STATUS_HEX;
})();
