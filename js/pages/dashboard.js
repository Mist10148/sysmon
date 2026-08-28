/*
  Dashboard - what is broken right now.

  Two views of the same list. The map answers "where", the list answers "what",
  and the targets rail exists so the map view can answer both at once on a screen
  wide enough to hold it. The rail is one element in three layouts: floating over
  the map at 1280px, a column beside it at 1024px, a card grid under it below
  that. It never moves in the DOM, because moving it would force Leaflet to
  re-measure mid-transition and leave a grey square behind.

  The page is built once and then updated in pieces, and that is not premature
  optimisation: the map must survive an update. Replacing the whole page on every
  change would throw the Leaflet instance away thirty seconds after it was
  created and reset the zoom the operator had just set.

  "Check All Now" is unfiltered on purpose. The system chips narrow what is being
  looked at, not what is being checked - an operator filtering to one system to
  read it has not asked to stop watching the others.
*/
window.SM = window.SM || {};
SM.pages = SM.pages || {};

SM.pages.dashboard = (function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;

  var SORTS = [
    { key: 'status', label: 'Down first',
      compare: function (a, b) {
        return SM.queries.statusRank(a.status) - SM.queries.statusRank(b.status);
      } },
    { key: 'name', label: 'Site name',
      compare: function (a, b) { return SM.fmt.compareText(a.name, b.name); } },
    { key: 'system', label: 'System',
      compare: function (a, b) {
        return SM.fmt.compareText(a.system_type_name, b.system_type_name);
      } }
  ];

  function mount(ctx) {
    var root;
    var mapHandle = null;
    var builtMode = null;
    var selectedId = null;
    var busyIds = [];
    var sweepTimer = null;

    ctx.view.innerHTML = html`
      <div id="d-header"></div>
      <div class="page-body">
        <div id="d-chips"></div>
        <div id="d-toolbar"></div>
        <div class="summary" id="d-summary"></div>
        <div id="d-body"></div>
      </div>`;
    root = ctx.view;

    var elHeader = SM.dom.qs('#d-header', root);
    var elChips = SM.dom.qs('#d-chips', root);
    var elToolbar = SM.dom.qs('#d-toolbar', root);
    var elSummary = SM.dom.qs('#d-summary', root);
    var elBody = SM.dom.qs('#d-body', root);

    /* ---------- state, all of it from the URL ---------- */

    function readState() {
      var p = SM.router.currentParams();
      return {
        mode: p.view === 'list' ? 'list' : 'map',
        systemId: p.system ? parseInt(p.system, 10) : null,
        controls: SM.ui.listControls(p, {
          sorts: SORTS,
          defaultSort: 'status',
          searchFields: ['name', 'ip', 'region', 'system_type_name']
        })
      };
    }

    function hasCoords(row) {
      return row.lat != null && row.lng != null && (row.lat !== 0 || row.lng !== 0);
    }

    /* ---------- update ---------- */

    function update() {
      var s = readState();
      var all = SM.queries.currentStatus({ systemTypeId: s.systemId });
      var rows = s.controls.apply(all);
      var totals = SM.queries.summary(all);
      var lastSweep = SM.queries.lastSweepAt();

      elHeader.innerHTML = SM.ui.PageHeader({
        title: 'Dashboard',
        desc: lastSweep
          ? 'Last sweep ' + SM.fmt.relative(lastSweep) + ' · every active site, every system'
          : 'Nothing checked yet · press Check All Now to start',
        actions: raw(
          SM.ui.Segmented({
            act: 'set-view', value: s.mode, size: 'sm', ariaLabel: 'Map or list',
            items: [{ value: 'map', label: 'Map', icon: 'map' },
                    { value: 'list', label: 'List', icon: 'list' }]
          }).__html +
          SM.ui.Button({
            label: busyIds.length ? 'Checking…' : 'Check All Now',
            icon: 'refresh-cw', act: 'sweep',
            spinning: busyIds.length > 0, disabled: busyIds.length > 0
          }).__html)
      }).__html;

      elChips.innerHTML = SM.ui.SystemChips(SM.queries.systemTypes(), s.systemId).__html;

      /* The toolbar holds the focused search field, so the caret is preserved. */
      SM.ui.preserveFocus(elToolbar, function () {
        elToolbar.innerHTML = SM.ui.ListToolbar({
          controls: s.controls,
          placeholder: 'Search by site, IP or region',
          count: rows.length === all.length
            ? SM.fmt.plural(all.length, 'site')
            : rows.length + ' of ' + SM.fmt.plural(all.length, 'site')
        }).__html;
      });

      elSummary.innerHTML =
        SM.ui.StatTile({ label: 'Functional', tone: 'ok',
                         value: totals.functional + ' of ' + totals.total }).__html +
        SM.ui.StatTile({ label: 'Down', tone: 'down', value: totals.down }).__html +
        SM.ui.StatTile({ label: 'Not yet checked', tone: 'unknown',
                         value: totals.unchecked }).__html +
        SM.ui.StatTile({ label: 'Last sweep', tone: 'accent',
                         value: lastSweep ? SM.fmt.relative(lastSweep) : 'never' }).__html;

      if (builtMode !== s.mode) buildBody(s.mode);

      if (s.mode === 'map') {
        var placed = rows.filter(hasCoords);
        var count = SM.dom.qs('#d-rail-count', elBody);
        if (count) count.textContent = String(placed.length);
        var list = SM.dom.qs('#d-rail-list', elBody);
        if (list) {
          list.innerHTML = placed.length
            ? placed.map(function (row) {
                return SM.ui.StatusCard(row, { selected: row.id === selectedId }).__html;
              }).join('')
            : '<p class="text-12 text-muted p-3">No sites match.</p>';
        }
        if (mapHandle) mapHandle.setRows(placed, busyIds);
      } else {
        var cards = SM.dom.qs('#d-cards', elBody);
        if (cards) {
          cards.innerHTML = rows.length
            ? rows.map(function (row) {
                return SM.ui.StatusCard(row, { selected: row.id === selectedId }).__html;
              }).join('')
            : SM.ui.Empty({
                icon: 'map-pinned',
                title: 'No sites match',
                desc: 'Clear the search, or pick a different system above.'
              }).__html;
        }
      }
    }

    /* Only ever called when the view mode actually changes. */
    function buildBody(mode) {
      teardownMap();
      builtMode = mode;

      if (mode === 'map') {
        elBody.innerHTML = html`
          <div class="map-frame">
            <div class="map-shell">
              <div class="map-canvas" id="map-canvas" role="application"
                   aria-label="Map of monitored sites"></div>
            </div>
            <aside class="rail glass" aria-label="Targets">
              <div class="rail-head">
                <span>Targets</span>
                <span id="d-rail-count">0</span>
              </div>
              <div class="rail-list" id="d-rail-list"></div>
            </aside>
          </div>`;
        mapHandle = SM.map.create(SM.dom.qs('#map-canvas', elBody), {
          onSelect: function (id) { selectTarget(id, false); }
        });
      } else {
        elBody.innerHTML = '<div class="card glass"><div class="card-body pt-5">' +
          '<div class="card-grid" id="d-cards"></div></div></div>';
      }
    }

    function teardownMap() {
      if (mapHandle) { mapHandle.destroy(); mapHandle = null; }
    }

    function selectTarget(id, toggle) {
      selectedId = (toggle && selectedId === id) ? null : id;
      update();
      if (mapHandle) mapHandle.select(selectedId);
    }

    /* ---------- the sweep ---------- */

    /*
      The probe is instantaneous here, and that is a lie the interface should not
      tell: pressing "Check All Now" and getting a finished answer in the same
      frame reads as a button that did nothing. So the pins pulse first, for
      roughly as long as the configured packet count and timeout say a real sweep
      of this many sites would take.
    */
    function runSweep(locationIds) {
      if (busyIds.length) return;
      var targets = locationIds ||
        SM.queries.currentStatus({}).map(function (r) { return r.id; });
      if (!targets.length) {
        SM.toast.info('Nothing to check', 'Add a site on the Locations page first.');
        return;
      }

      busyIds = targets;
      update();

      var handle = SM.toast.show({
        tone: 'loading',
        title: locationIds ? 'Checking one site…' : 'Checking every system…'
      });

      var packets = SM.store.settingInt('sweep_packets');
      var timeout = SM.store.settingInt('sweep_timeout_ms');
      var wait = Math.min(2200, 400 + packets * timeout * 0.12);

      sweepTimer = setTimeout(function () {
        sweepTimer = null;
        var result;
        try {
          result = SM.sweep.run({ locationIds: locationIds });
        } catch (err) {
          busyIds = [];
          update();
          handle.update({ tone: 'error', title: 'The sweep failed',
                          desc: String(err.message || err) });
          return;
        }
        busyIds = [];
        update();

        if (!result || !result.checks.length) {
          handle.update({ tone: 'warning', title: 'Nothing was checked',
                          desc: 'Every site or system involved is switched off.' });
          return;
        }

        handle.update({
          tone: result.down ? 'warning' : 'success',
          title: 'Checked ' + SM.fmt.plural(result.targets, 'target') +
                 ' in ' + (wait / 1000).toFixed(1) + 's',
          desc: result.functional + ' functional · ' + result.down + ' down'
        });
      }, wait);
    }

    /* ---------- events ---------- */

    ctx.onCleanup(SM.ui.bindListControls(root, { defaultSort: 'status' }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="set-view"]', function (e, node) {
      SM.router.patchParams({ view: node.getAttribute('data-value') });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="filter-system"]', function (e, node) {
      SM.router.patchParams({ system: node.getAttribute('data-value') || null });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="sweep"]', function () {
      runSweep(null);
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="select-target"]', function (e, node) {
      selectTarget(parseInt(node.getAttribute('data-id'), 10), true);
    }));

    /* A scheduled sweep, or an edit made on another page. */
    ctx.onCleanup(SM.store.subscribe(['checks', 'locations', 'system_types'], update,
      { signal: ctx.signal }));

    /*
      "Last sweep 3m ago" has to keep counting, or a dashboard left open all
      afternoon claims the last check was a minute ago.
    */
    var ticker = setInterval(function () {
      if (document.visibilityState !== 'hidden') update();
    }, 30000);
    ctx.onCleanup(function () { clearInterval(ticker); });

    ctx.onCleanup(function () {
      if (sweepTimer) clearTimeout(sweepTimer);
      teardownMap();
    });

    update();

    return { onParams: function () { update(); } };
  }

  return { mount: mount };
})();
