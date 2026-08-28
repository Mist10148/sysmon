/*
  The dashboard map.

  Leaflet is the one third-party file in SysMon, loaded from a CDN and pinned
  with subresource integrity. An LHIO office on a bad line is exactly where that
  request will fail, so this module does not assume it succeeded: if window.L is
  missing, the same pins are laid out on a plain grid by a linear projection of
  their coordinates. It is not a map, and it says so, but the dashboard still
  tells you which sites are down - which is the job.

  The pins themselves are CSS in either case. A pin's body is its health colour
  and its collar is its system's identity colour, so one glyph answers both "is
  it up" and "which system is this" without a legend.
*/
window.SM = window.SM || {};

SM.map = (function () {
  'use strict';

  /* Western Visayas, with enough margin that a pin is never on the edge. */
  var BOUNDS = { south: 9.6, north: 12.1, west: 121.5, east: 123.4 };
  var CENTER = [10.85, 122.5];

  function available() { return typeof window.L !== 'undefined'; }

  /*
    container: the .map-canvas element.
    options: { onSelect(id) }
    Returns { setRows, select, invalidate, destroy, isReal }.
  */
  function create(container, options) {
    var o = options || {};
    return available() ? leafletMap(container, o) : fallbackMap(container, o);
  }

  /* ---------- the real map ---------- */

  function leafletMap(container, o) {
    var touch = window.matchMedia('(pointer: coarse)').matches;

    var map = window.L.map(container, {
      center: CENTER,
      zoom: 8,
      zoomControl: true,
      attributionControl: true,
      /*
        On a phone a one-finger drag has to scroll the page. Leaflet would
        otherwise swallow it and trap the reader inside the map, which is the
        single most common complaint about a map embedded in a long screen.
      */
      dragging: !touch,
      tap: false,
      scrollWheelZoom: !touch
    });

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    var gate = null;
    if (touch) {
      gate = SM.dom.el('<div class="map-gate"><span>Tap to move the map</span></div>');
      container.parentNode.appendChild(gate);
      gate.addEventListener('click', function () {
        map.dragging.enable();
        gate.remove();
        gate = null;
      });
    }

    var markers = {};
    var selectedId = null;

    /*
      A ResizeObserver rather than a window resize listener, because the map
      also changes size when the rail switches layout or the drawer opens, and
      Leaflet renders a grey half-tile if it is not told.
    */
    var observer = new ResizeObserver(function () { map.invalidateSize(); });
    observer.observe(container);

    function setRows(rows, busyIds) {
      var seen = {};
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        seen[row.id] = true;
        var busy = busyIds && busyIds.indexOf(row.id) !== -1;
        var icon = window.L.divIcon({
          className: '',
          html: pinHtml(row, row.id === selectedId, busy),
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -16]
        });

        if (markers[row.id]) {
          markers[row.id].setLatLng([row.lat, row.lng]).setIcon(icon);
          markers[row.id].setPopupContent(popupHtml(row));
        } else {
          var marker = window.L.marker([row.lat, row.lng], {
            icon: icon,
            title: row.name,
            keyboard: true,
            alt: row.name + ' - ' + row.status
          }).addTo(map);
          marker.bindPopup(popupHtml(row));
          marker.on('click', function (id) {
            return function () { if (o.onSelect) o.onSelect(id); };
          }(row.id));
          markers[row.id] = marker;
        }
      }

      /* A site that was switched off or filtered out loses its pin. */
      Object.keys(markers).forEach(function (id) {
        if (!seen[id]) { map.removeLayer(markers[id]); delete markers[id]; }
      });

      fit(rows);
    }

    var fitted = false;
    function fit(rows) {
      if (fitted || !rows.length) return;
      fitted = true;
      var points = rows.map(function (r) { return [r.lat, r.lng]; });
      try {
        map.fitBounds(window.L.latLngBounds(points).pad(0.18));
      } catch (err) {
        map.setView(CENTER, 8);
      }
    }

    function select(id) {
      selectedId = id;
      Object.keys(markers).forEach(function (key) {
        var el = markers[key].getElement();
        if (!el) return;
        var pin = el.querySelector('.sysmon-pin');
        if (pin) pin.dataset.selected = String(key) === String(id) ? 'true' : 'false';
      });
      if (id && markers[id]) markers[id].openPopup();
    }

    return {
      isReal: true,
      setRows: setRows,
      select: select,
      invalidate: function () { map.invalidateSize(); },
      destroy: function () {
        observer.disconnect();
        if (gate && gate.parentNode) gate.remove();
        map.remove();
      }
    };
  }

  /* ---------- the fallback ---------- */

  /*
    No tiles, no panning: a plain grid with the pins placed by a linear
    projection of their coordinates. Over an area this small the distortion from
    ignoring the Earth's curvature is not visible, and the relative positions are
    right, which is all that is being asked of it.
  */
  function fallbackMap(container, o) {
    container.classList.add('map-fallback');
    container.innerHTML = '<p class="map-fallback-note">Map tiles unavailable ' +
      '&mdash; showing sites by position</p>';

    var layer = SM.dom.el('<div class="absolute inset-0"></div>');
    container.appendChild(layer);

    var selectedId = null;
    var rows = [];

    function project(row) {
      var x = (row.lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west);
      var y = 1 - (row.lat - BOUNDS.south) / (BOUNDS.north - BOUNDS.south);
      return {
        x: Math.max(0.04, Math.min(0.96, x)) * 100,
        y: Math.max(0.06, Math.min(0.9, y)) * 100
      };
    }

    function paint(busyIds) {
      layer.innerHTML = rows.map(function (row) {
        var at = project(row);
        return '<button type="button" class="absolute" data-act="select-target"' +
          ' data-id="' + row.id + '" title="' + SM.dom.esc(row.name + ' - ' + row.status) + '"' +
          ' style="left:' + at.x.toFixed(2) + '%;top:' + at.y.toFixed(2) +
          '%;transform:translate(-50%,-50%)">' +
          pinHtml(row, row.id === selectedId, busyIds && busyIds.indexOf(row.id) !== -1) +
          '</button>';
      }).join('');
    }

    layer.addEventListener('click', function (event) {
      var node = event.target.closest('[data-act="select-target"]');
      if (node && o.onSelect) o.onSelect(parseInt(node.getAttribute('data-id'), 10));
    });

    return {
      isReal: false,
      setRows: function (next, busyIds) { rows = next; paint(busyIds); },
      select: function (id) { selectedId = id; paint(); },
      invalidate: function () {},
      destroy: function () {
        container.classList.remove('map-fallback');
        container.innerHTML = '';
      }
    };
  }

  /* ---------- the pin ---------- */

  function pinHtml(row, selected, busy) {
    var initial = (row.name || '?').charAt(0).toUpperCase();
    return '<span class="sysmon-pin' + (busy ? ' sysmon-pin-pulse' : '') + '"' +
      ' data-status="' + SM.dom.esc(row.status) + '"' +
      ' data-sys="' + SM.dom.esc(row.system_type_color || 'slate') + '"' +
      ' data-selected="' + (selected ? 'true' : 'false') + '">' + initial + '</span>';
  }

  function popupHtml(row) {
    var numbers = row.latest
      ? (row.check_method === 'http'
          ? SM.fmt.latency(row.avg_latency_ms) + (row.http_status ? ' · HTTP ' + row.http_status : '')
          : SM.fmt.latency(row.avg_latency_ms) + ' · ' + SM.fmt.percent(row.loss_pct, 0) + ' loss')
      : 'Not yet checked';

    return '<strong>' + SM.dom.esc(row.name) + '</strong><br>' +
      SM.dom.esc(row.system_type_name) + '<br>' +
      '<span style="font-family:var(--font-mono)">' + SM.dom.esc(row.ip) + '</span><br>' +
      SM.dom.esc(row.status) + ' · ' + SM.dom.esc(numbers) +
      (row.checked_at ? '<br><span style="opacity:.7">' +
        SM.dom.esc(SM.fmt.relative(row.checked_at)) + '</span>' : '');
  }

  return { create: create, available: available, BOUNDS: BOUNDS, CENTER: CENTER };
})();
