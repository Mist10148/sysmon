/*
  The coordinate picker in the Locations editor.

  Typing 10.7402 and 121.9391 into two boxes is not a way to find out where a
  site is - it is a way to find out afterwards that you transposed two digits.
  So the editor has a small map you click, and the two boxes stay, filled in and
  editable, because sometimes you do have the exact figures.

  Without Leaflet the map is skipped entirely and the two number fields are all
  there is. That is a graceful loss rather than a broken dialog.
*/
window.SM = window.SM || {};

SM.picker = (function () {
  'use strict';

  /*
    container: the .map-picker element
    options: { lat, lng, onPick(lat, lng) }
    Returns { setValue, destroy } or null when Leaflet is unavailable.
  */
  function create(container, options) {
    var o = options || {};
    if (!SM.map.available()) {
      container.innerHTML = '<p class="map-picker-hint" style="position:static;padding:1rem">' +
        'The picker needs the map library, which did not load. Type the coordinates instead.' +
        '</p>';
      return null;
    }

    var hasPoint = o.lat != null && o.lng != null && (o.lat !== 0 || o.lng !== 0);
    var start = hasPoint ? [o.lat, o.lng] : SM.map.CENTER;

    var map = window.L.map(container, {
      center: start,
      zoom: hasPoint ? 11 : 8,
      zoomControl: true,
      attributionControl: false
    });

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

    var hint = SM.dom.el('<p class="map-picker-hint">Click to place the site</p>');
    container.appendChild(hint);

    var marker = null;

    function place(lat, lng, announce) {
      if (marker) {
        marker.setLatLng([lat, lng]);
      } else {
        marker = window.L.marker([lat, lng], {
          draggable: true,
          icon: window.L.divIcon({
            className: '',
            html: '<span class="sysmon-pin" data-status="Unknown">+</span>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          })
        }).addTo(map);
        marker.on('dragend', function () {
          var at = marker.getLatLng();
          if (o.onPick) o.onPick(round(at.lat), round(at.lng));
        });
      }
      if (hint) { hint.remove(); hint = null; }
      if (announce && o.onPick) o.onPick(round(lat), round(lng));
    }

    if (hasPoint) place(o.lat, o.lng, false);

    map.on('click', function (event) {
      place(event.latlng.lat, event.latlng.lng, true);
    });

    /*
      The dialog animates in, so the map is measured mid-transition and comes out
      the wrong size unless it is told again once the panel has settled.
    */
    var observer = new ResizeObserver(function () { map.invalidateSize(); });
    observer.observe(container);
    setTimeout(function () { map.invalidateSize(); }, 360);

    function round(n) { return Math.round(n * 1e4) / 1e4; }

    return {
      /* Called when the number fields are typed into, so the pin follows. */
      setValue: function (lat, lng) {
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;
        if (lat === 0 && lng === 0) return;
        place(lat, lng, false);
        map.setView([lat, lng], Math.max(map.getZoom(), 10));
      },
      destroy: function () {
        observer.disconnect();
        map.remove();
      }
    };
  }

  return { create: create };
})();
