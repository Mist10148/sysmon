/*
  Locations - one row per site per system.

  The row is the pairing, not the office. BACOLOD running the queueing system and
  BACOLOD running Nclaims are two rows, because they are two different things to
  check and they fail independently. That is why the previous build moved this out
  of code and into a table, and it is why removing a row is worded as "switched
  off" rather than "deleted": the office is still there, and it is probably still
  running something else.

  The editor has a map you click. Typing 10.7402 and 121.9391 into two boxes is
  not a way to find out where a site is - it is a way to find out later that two
  digits were transposed.
*/
window.SM = window.SM || {};
SM.pages = SM.pages || {};

SM.pages.locations = (function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;

  var SORTS = [
    { key: 'order', label: 'Manual order', compare: function () { return 0; } },
    { key: 'name', label: 'LHIO',
      compare: function (a, b) { return SM.fmt.compareText(a.name, b.name); } },
    { key: 'system', label: 'System',
      compare: function (a, b) { return SM.fmt.compareText(a.system_type_name, b.system_type_name); } },
    { key: 'ip', label: 'IP address',
      compare: function (a, b) { return SM.fmt.compareIp(a.ip, b.ip); } },
    { key: 'region', label: 'Region',
      compare: function (a, b) { return SM.fmt.compareText(a.region, b.region); } },
    { key: 'status', label: 'Latest status',
      compare: function (a, b) {
        return SM.queries.statusRank(a.status) - SM.queries.statusRank(b.status);
      } }
  ];

  function mount(ctx) {
    var root = ctx.view;
    var pickerHandle = null;

    root.innerHTML = '<div id="l-header"></div><div class="page-body">' +
      '<div id="l-toolbar"></div><div class="card surface-card" id="l-table"></div></div>';

    var elHeader = SM.dom.qs('#l-header', root);
    var elToolbar = SM.dom.qs('#l-toolbar', root);
    var elTable = SM.dom.qs('#l-table', root);

    function readState() {
      var p = SM.router.currentParams();
      return {
        scope: p.scope === 'all' ? 'all' : 'active',
        systemId: p.system ? parseInt(p.system, 10) : null,
        controls: SM.ui.listControls(p, {
          sorts: SORTS,
          defaultSort: 'order',
          searchFields: ['name', 'ip', 'region', 'system_type_name']
        })
      };
    }

    /* Rows carry their latest status, so the table can show it without a join. */
    function allRows(state) {
      var latest = SM.queries.latestByLocation();
      return SM.queries.locations({
        includeInactive: state.scope === 'all',
        systemTypeId: state.systemId
      }).map(function (row) {
        var check = latest[row.id];
        row.status = check ? check.status : 'Unknown';
        row.latest = check || null;
        return row;
      });
    }

    function columns(state, rows) {
      return [
        { key: 'no', label: '#', cls: 'col-no text-faint', hideMobile: true,
          cell: function (row, index) { return String(index + 1); } },

        { key: 'name', label: 'LHIO', primary: true, sortable: true,
          cell: function (row) {
            return '<span class="font-medium">' + SM.dom.esc(row.name) + '</span>';
          } },

        { key: 'system', label: 'System',
          cell: function (row) { return SM.ui.SystemBadge(row).__html; } },

        { key: 'ip', label: 'IP', cls: 'cell-mono',
          cell: function (row) { return SM.dom.esc(row.ip); } },

        { key: 'region', label: 'Region',
          cell: function (row) {
            return row.region ? SM.dom.esc(row.region) : '<span class="text-faint">--</span>';
          } },

        { key: 'coords', label: 'Coordinates', cls: 'cell-mono',
          cell: function (row) { return SM.fmt.coords(row.lat, row.lng); } },

        { key: 'status', label: 'Latest status',
          cell: function (row) {
            return row.latest
              ? SM.ui.StatusBadge(row.status, 'sm').__html
              : '<span class="text-faint text-12">No data</span>';
          } },

        { key: 'active', label: 'Active', cls: 'col-active text-center',
          cell: function (row) {
            return SM.ui.Switch({
              act: 'toggle-active', dataId: row.id, checked: !!row.active,
              ariaLabel: 'Include ' + row.name + ' in sweeps'
            }).__html;
          } },

        { key: 'order', label: 'Order', cls: 'col-order',
          cell: function (row, index) {
            return SM.ui.ReorderCell({
              id: row.id,
              disabled: !state.controls.isDefaultOrder,
              first: index === 0,
              last: index === rows.length - 1
            }).__html;
          } },

        { key: 'actions', label: '', actions: true, cls: 'col-actions',
          cell: function (row) {
            return SM.ui.IconButton({
              icon: 'more-horizontal', size: 'sm', act: 'row-menu', value: row.id,
              title: 'Actions for ' + row.name
            }).__html;
          } }
      ];
    }

    function update() {
      var state = readState();
      var all = allRows(state);
      var rows = state.controls.apply(all);
      var systems = SM.queries.systemTypes({ includeInactive: true });

      elHeader.innerHTML = SM.ui.PageHeader({
        title: 'Locations',
        desc: 'One row per site per system, managed here rather than in code',
        actions: raw(
          SM.ui.Button({ label: 'Check all', icon: 'refresh-cw', variant: 'secondary',
                         act: 'sweep-all' }).__html +
          SM.ui.Button({ label: 'Add site', icon: 'plus', act: 'add' }).__html)
      }).__html;

      SM.ui.preserveFocus(elToolbar, function () {
        elToolbar.innerHTML = SM.ui.ListToolbar({
          controls: state.controls,
          placeholder: 'Search sites',
          count: rows.length === all.length
            ? SM.fmt.plural(all.length, 'site')
            : rows.length + ' of ' + SM.fmt.plural(all.length, 'site'),
          extra: raw(
            SM.ui.Select({
              name: 'system-filter', act: 'filter-system', value: state.systemId || '',
              placeholder: 'All systems', cls: 'md:w-44', ariaLabel: 'Filter by system',
              options: systems.map(function (s) { return [s.id, s.name]; })
            }).__html +
            SM.ui.Segmented({
              act: 'set-scope', value: state.scope, size: 'sm', ariaLabel: 'Which sites',
              items: [{ value: 'active', label: 'Active' }, { value: 'all', label: 'All' }]
            }).__html)
        }).__html;
      });

      elTable.innerHTML = SM.ui.Table({
        columns: columns(state, rows),
        rows: rows,
        sort: state.controls.sort,
        dir: state.controls.dir,
        empty: state.controls.q
          ? 'No site matches that search.'
          : 'No sites yet. Add one, or check the system filter above.'
      }).__html;
    }

    /* ---------- the editor ---------- */

    function openEditor(location) {
      var editing = !!location;
      var systems = SM.queries.systemTypes({ includeInactive: true });
      if (!systems.length) {
        SM.toast.warning('Add a system first',
          'A site belongs to a system, so there has to be one to put it in.');
        return;
      }

      var l = location || {
        name: '', ip: '', lat: '', lng: '', region: 'Region VI',
        system_type_id: systems[0].id, active: true
      };

      SM.ui.openDialog({
        title: editing ? 'Edit ' + l.name : 'Add a site',
        desc: 'A site is one office running one system. The same office running two ' +
              'systems is two rows.',
        body: raw(html`
          <div class="form-grid">
            <div class="form-grid form-grid-2">
              ${SM.ui.Field({ name: 'name', label: 'LHIO', value: l.name, required: true,
                              placeholder: 'BACOLOD' })}
              ${SM.ui.Select({ name: 'system_type_id', label: 'System',
                               value: l.system_type_id,
                               options: systems.map(function (s) { return [s.id, s.name]; }) })}
              ${SM.ui.Field({ name: 'ip', label: 'IP address or host', value: l.ip,
                              required: true, placeholder: '172.24.143.10' })}
              ${SM.ui.Field({ name: 'region', label: 'Region', value: l.region })}
            </div>

            <div>
              <span class="field-label">Position</span>
              <div class="map-picker" id="picker"></div>
            </div>

            <div class="form-grid form-grid-2">
              ${SM.ui.Field({ name: 'lat', label: 'Latitude', value: l.lat, type: 'number',
                              step: 'any', min: -90, max: 90, act: 'coord-change' })}
              ${SM.ui.Field({ name: 'lng', label: 'Longitude', value: l.lng, type: 'number',
                              step: 'any', min: -180, max: 180, act: 'coord-change' })}
            </div>
          </div>`),
        footer: raw(
          SM.ui.Button({ label: 'Cancel', variant: 'secondary', act: 'cancel' }).__html +
          SM.ui.Button({ label: editing ? 'Save changes' : 'Add site', type: 'submit' }).__html),

        onMount: function (panel, api) {
          SM.dom.delegate(panel, 'click', '[data-act="cancel"]', function () { api.close(); });

          var latField = SM.dom.qs('[name="lat"]', panel);
          var lngField = SM.dom.qs('[name="lng"]', panel);

          pickerHandle = SM.picker.create(SM.dom.qs('#picker', panel), {
            lat: l.lat === '' ? null : Number(l.lat),
            lng: l.lng === '' ? null : Number(l.lng),
            onPick: function (lat, lng) {
              latField.value = lat;
              lngField.value = lng;
            }
          });

          /* Typing coordinates moves the pin, so the two stay one thing. */
          var sync = SM.dom.debounce(function () {
            if (pickerHandle) {
              pickerHandle.setValue(parseFloat(latField.value), parseFloat(lngField.value));
            }
          }, 500);
          SM.dom.delegate(panel, 'input', '[data-act="coord-change"]', sync);

          panel.closest('dialog').addEventListener('close', function () {
            if (pickerHandle) { pickerHandle.destroy(); pickerHandle = null; }
          });
        },

        onSubmit: function (data, api) {
          if (!String(data.name).trim()) { api.setError('name', 'A site needs a name.'); return; }
          if (!String(data.ip).trim()) { api.setError('ip', 'A site needs an address to check.'); return; }
          if (editing) {
            SM.mutate.updateLocation(l.id, data);
            SM.toast.success(data.name + ' saved');
          } else {
            SM.mutate.createLocation(data);
            SM.toast.success(data.name + ' added', 'It will be included in the next sweep.');
          }
          api.close();
        }
      });
    }

    /* ---------- removal ---------- */

    /*
      Soft by default, with Undo in the toast. A site switched off keeps its
      history and keeps being checked for any other system it also runs, which is
      what an operator expects from a list they can switch things back on in.
    */
    function confirmDelete(location) {
      var alsoRuns = SM.queries.locations({ includeInactive: true }).filter(function (row) {
        return row.id !== location.id && row.name === location.name;
      });

      SM.ui.openAlert({
        title: 'Remove ' + location.name + '?',
        desc: 'Switching it off keeps its history and is reversible.',
        confirmLabel: 'Switch it off',
        body: raw(html`
          <p class="info-block">
            ${alsoRuns.length
              ? 'This office also runs ' + SM.fmt.plural(alsoRuns.length, 'other system') +
                ', and those rows keep being checked.'
              : 'Its recorded checks stay in History and in exports.'}
          </p>
          <p class="mt-3 text-12 text-muted">
            To delete it and every check ever recorded for it, use Delete permanently.
          </p>`),
        onMount: function (panel, api) {
          /* A third button, because this dialog has three answers rather than two. */
          var foot = SM.dom.qs('.dialog-foot', panel);
          foot.insertAdjacentHTML('afterbegin', SM.ui.Button({
            label: 'Delete permanently', variant: 'destructive', act: 'hard-delete'
          }).__html);

          /*
            Bound to this panel rather than to the layer host, so it dies with the
            dialog. A listener on #layers would survive and later fire for a
            different site with this one still captured in the closure.
          */
          SM.dom.delegate(panel, 'click', '[data-act="hard-delete"]', function () {
            api.close();
            confirmHardDelete(location);
          });
        },
        onConfirm: function (api) {
          SM.mutate.deleteLocation(location.id, false);
          SM.toast.show({
            tone: 'success',
            title: location.name + ' switched off',
            desc: 'Left out of sweeps; history kept.',
            duration: 9000,
            action: {
              label: 'Undo',
              onClick: function () {
                SM.mutate.updateLocation(location.id, { active: true });
                SM.toast.success(location.name + ' switched back on');
              }
            }
          });
          api.close();
        }
      });
    }

    /* Asked a second time, because unlike switching off it cannot be undone. */
    function confirmHardDelete(location) {
      SM.ui.openAlert({
        title: 'Delete ' + location.name + ' permanently?',
        desc: 'This cannot be undone.',
        confirmLabel: 'Delete permanently',
        tone: 'destructive',
        body: raw('<p class="warn-block">The site and every check ever recorded for it ' +
                  'will be removed from History, Analytics and exports.</p>'),
        onConfirm: function (api) {
          var result = SM.mutate.deleteLocation(location.id, true);
          SM.toast.success(location.name + ' deleted',
            SM.fmt.plural(result.removedChecks, 'record') + ' removed with it');
          api.close();
        }
      });
    }

    /* ---------- events ---------- */

    ctx.onCleanup(SM.ui.bindListControls(root, { defaultSort: 'order' }));
    SM.ui.bindTooltips(root, ctx.signal);

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="add"]', function () {
      openEditor(null);
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="filter-system"]', function (e, node) {
      SM.router.patchParams({ system: node.value || null, page: null });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="set-scope"]', function (e, node) {
      SM.router.patchParams({ scope: node.getAttribute('data-value') === 'all' ? 'all' : null });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="toggle-active"]', function (e, node) {
      SM.mutate.updateLocation(parseInt(node.getAttribute('data-id'), 10),
                               { active: node.checked });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="move-up"]', function (e, node) {
      SM.mutate.reorder('locations', parseInt(node.getAttribute('data-value'), 10), 'up');
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="move-down"]', function (e, node) {
      SM.mutate.reorder('locations', parseInt(node.getAttribute('data-value'), 10), 'down');
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="sweep-all"]', function () {
      if (SM.sweep.isRunning()) {
        SM.toast.info('A sweep is already running', 'Give it a moment.');
        return;
      }
      /*
        A loading toast that is updated in place, rather than a result toast
        afterwards. With the probe agent answering, a sweep takes as long as
        the pings take, and a button that looks inert for four seconds reads as
        a button that did nothing.
      */
      var handle = SM.toast.show({ tone: 'loading', title: 'Checking every site…' });
      SM.sweep.run({}).then(function (result) {
        if (!result || !result.checks.length) {
          handle.update({ tone: 'warning', title: 'Nothing to check',
                          desc: 'Every site or system is switched off.' });
          return;
        }
        handle.update({
          tone: result.down ? 'warning' : 'success',
          title: 'Checked ' + SM.fmt.plural(result.targets, 'site'),
          desc: result.functional + ' functional · ' + result.down + ' down' +
                SM.sweep.sourceNote(result)
        });
      }, function (err) {
        handle.update({ tone: 'error', title: 'The sweep failed',
                        desc: String(err && err.message || err) });
      });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="row-menu"]', function (e, node) {
      var id = parseInt(node.getAttribute('data-value'), 10);
      var location = SM.queries.locationById(id);
      if (!location) return;

      SM.ui.showMenu(node, [
        { label: 'Edit', icon: 'pencil', onSelect: function () { openEditor(location); } },
        { label: 'Check this site', icon: 'refresh-cw', onSelect: function () {
            if (SM.sweep.isRunning()) {
              SM.toast.info('A sweep is already running', 'Give it a moment.');
              return;
            }
            var handle = SM.toast.show({ tone: 'loading',
                                         title: 'Checking ' + location.name + '…' });
            SM.sweep.run({ locationIds: [id] }).then(function (result) {
              var check = result && result.checks[0];
              if (!check) {
                handle.update({ tone: 'warning', title: 'Nothing was checked' });
                return;
              }
              handle.update({
                tone: check.functional ? 'success' : 'error',
                title: location.name + ' is ' + check.status.toLowerCase(),
                desc: (check.functional
                  ? SM.fmt.latency(check.avg_latency_ms) + ' · ' +
                    SM.fmt.percent(check.loss_pct, 0) + ' loss'
                  : check.issues) +
                  (check.source === 'sim' ? ' · simulated' : '')
              });
            }, function (err) {
              handle.update({ tone: 'error', title: 'The check failed',
                              desc: String(err && err.message || err) });
            });
          } },
        /*
          History already filters by site - the param has always been there,
          nothing just ever built the link.
        */
        { label: 'View history', icon: 'table-properties', onSelect: function () {
            SM.router.go('/history', { site: id });
          } },
        { separator: true },
        { label: 'Remove', icon: 'trash-2', tone: 'destructive',
          onSelect: function () { confirmDelete(location); } }
      ], { ariaLabel: 'Actions for ' + location.name });
    }));

    ctx.onCleanup(SM.store.subscribe(['locations', 'system_types', 'checks'], update,
      { signal: ctx.signal }));
    ctx.onCleanup(function () {
      SM.ui.closeMenu();
      if (pickerHandle) { pickerHandle.destroy(); pickerHandle = null; }
    });

    update();
    return { onParams: update };
  }

  return { mount: mount };
})();
