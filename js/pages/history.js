/*
  History - the monitoring form, filled in for you.

  This page is the paper form the office already keeps: a numbered row per check,
  the site, the date, a tick or a cross, and two columns of prose that a person
  writes while on the phone to the LHIO. Everything else in SysMon exists to make
  this page correct without anyone typing it.

  Three things are deliberate.

  The measurements are not editable. Issues, Remarks and Status are; packet loss
  and latency are what the check recorded. A form whose numbers can be typed over
  is not a record of anything.

  Editing Status marks the row as set by hand and says so underneath, because a
  row that disagrees with its own measurements needs to admit that a person
  changed it.

  Rows are patched rather than re-rendered. A sweep landing while someone is
  halfway through typing a remark must not take the caret with it.
*/
window.SM = window.SM || {};
SM.pages = SM.pages || {};

SM.pages.history = (function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;
  var PAGE_SIZE = 25;

  var SORT_LABELS = {
    checked_at: 'Date checked',
    location: 'LHIO',
    system: 'System',
    status: 'Status'
  };

  function mount(ctx) {
    var root = ctx.view;
    var builtShape = null;

    root.innerHTML = html`
      <div id="h-header"></div>
      <div class="page-body">
        <div class="card surface-card" id="h-filters"></div>
        <div class="card surface-card" id="h-table"></div>
      </div>`;

    var elHeader = SM.dom.qs('#h-header', root);
    var elFilters = SM.dom.qs('#h-filters', root);
    var elTable = SM.dom.qs('#h-table', root);

    /* ---------- state ---------- */

    function readState() {
      var p = SM.router.currentParams();
      return {
        q: p.q || '',
        from: p.from || '',
        to: p.to || '',
        locationId: p.site ? parseInt(p.site, 10) : null,
        systemId: p.system ? parseInt(p.system, 10) : null,
        status: p.status || '',
        sort: SORT_LABELS[p.sort] ? p.sort : 'checked_at',
        dir: p.dir === 'asc' ? 'asc' : 'desc',
        page: Math.max(1, parseInt(p.page, 10) || 1)
      };
    }

    function query(state, paged) {
      return SM.queries.history({
        q: state.q, from: state.from, to: state.to,
        locationId: state.locationId, systemTypeId: state.systemId,
        status: state.status, sort: state.sort, dir: state.dir,
        page: paged ? state.page : null,
        pageSize: paged ? PAGE_SIZE : null
      });
    }

    /* ---------- columns ---------- */

    /*
      When the list is filtered to one system the System column is dropped and the
      Functional header names the system instead - which is exactly how the paper
      form is laid out, one system per sheet.
    */
    function columns(state, offset) {
      var single = !!state.systemId;
      var systemName = single
        ? (SM.queries.systemById(state.systemId) || {}).name
        : null;

      var cols = [
        { key: 'no', label: 'No.', cls: 'col-no text-faint', hideMobile: true,
          cell: function (row, index) { return String(offset + index + 1); } },

        { key: 'location', label: 'LHIO', primary: true, sortable: true,
          cell: function (row) {
            return html`
              <div class="stacked-primary">${row.location_name}</div>
              <div class="stacked-sub">${row.location_ip}</div>`;
          } }
      ];

      if (!single) {
        cols.push({ key: 'system', label: 'System', sortable: true,
          cell: function (row) { return SM.ui.SystemBadge(row).__html; } });
      }

      cols.push(
        { key: 'checked_at', label: 'Date checked', sortable: true,
          cell: function (row) {
            return html`
              <div>${SM.fmt.dateLabel(row.checked_at)}</div>
              <div class="cell-sub">${SM.fmt.timeLabel(row.checked_at)}</div>`;
          } },

        { key: 'functional', label: single ? systemName + ' functional' : 'Functional',
          cls: 'text-center',
          cell: function (row) { return SM.ui.FunctionalMark(row.functional).__html; } },

        { key: 'issues', label: 'Issues encountered',
          cell: function (row) {
            return SM.ui.InlineEdit({
              id: row.id, field: 'issues', value: row.issues,
              label: 'Issues encountered', context: row.location_name,
              placeholder: 'None'
            }).__html;
          } },

        { key: 'status', label: 'Status', sortable: true,
          cell: function (row) {
            return SM.ui.Select({
              name: 'status-' + row.id, act: 'set-status', dataId: row.id,
              value: row.status, tone: row.status, bare: true,
              ariaLabel: 'Status for ' + row.location_name,
              options: SM.schema.STATUSES.map(function (s) { return [s, s]; })
            }).__html +
            (row.status_overridden
              ? '<span class="override-note">set manually</span>' : '');
          } },

        { key: 'remarks', label: 'Remarks',
          cell: function (row) {
            return SM.ui.InlineEdit({
              id: row.id, field: 'remarks', value: row.remarks,
              label: 'Remarks', context: row.location_name,
              placeholder: '--'
            }).__html;
          } },

        { key: 'raw', label: '', actions: true, cls: 'col-actions',
          cell: function (row) {
            return SM.ui.IconButton({
              icon: 'terminal', size: 'sm', act: 'show-raw', value: row.id,
              title: 'Raw output for ' + row.location_name
            }).__html;
          } }
      );

      return cols;
    }

    function rowSig(row) {
      return [row.status, row.status_overridden ? 1 : 0, row.issues, row.remarks,
              row.functional ? 1 : 0, row.checked_at].join('|');
    }

    /* ---------- render ---------- */

    function update() {
      var state = readState();
      var result = query(state, true);
      var offset = (state.page - 1) * PAGE_SIZE;

      /* Filtering past the end of a shortened list should not show nothing. */
      if (result.total && !result.rows.length && state.page > 1) {
        SM.router.patchParams({ page: null }, true);
        return;
      }

      elHeader.innerHTML = SM.ui.PageHeader({
        title: 'History',
        desc: 'The monitoring form, filled in automatically — edit issues and remarks inline',
        actions: SM.ui.Button({ label: 'Export', icon: 'download', iconAfter: 'chevron-down',
                                variant: 'secondary', act: 'export-menu' })
      }).__html;

      SM.ui.preserveFocus(elFilters, function () {
        elFilters.innerHTML = filterCard(state, result.total);
      });

      var shape = (state.systemId ? 'single' : 'multi') + '|' + state.sort + '|' + state.dir;
      var cols = columns(state, offset);

      if (builtShape !== shape) {
        builtShape = shape;
        elTable.innerHTML = SM.ui.Table({
          columns: cols, rows: result.rows,
          sort: state.sort, dir: state.dir,
          empty: emptyMessage(state)
        }).__html + SM.ui.Pagination({
          page: state.page, pageSize: PAGE_SIZE, total: result.total
        }).__html;
      } else {
        var tbody = SM.dom.qs('tbody', elTable);
        if (result.rows.length) {
          SM.ui.patchRows(tbody, cols, result.rows, { rowSig: rowSig });
        } else {
          tbody.innerHTML = '<tr><td colspan="' + cols.length +
            '" class="py-10 text-center text-muted">' + emptyMessage(state) + '</td></tr>';
        }
        var pager = SM.dom.qs('.pager', elTable);
        if (pager) {
          pager.outerHTML = SM.ui.Pagination({
            page: state.page, pageSize: PAGE_SIZE, total: result.total
          }).__html;
        }
      }
    }

    function emptyMessage(state) {
      var narrowed = state.q || state.from || state.to || state.locationId ||
        state.systemId || state.status;
      return narrowed
        ? 'No records match these filters.'
        : 'No checks recorded yet. Run a sweep from the Dashboard.';
    }

    function filterCard(state, total) {
      var sites = SM.queries.locations({ includeInactive: true });
      var systems = SM.queries.systemTypes({ includeInactive: true });

      return html`
        <div class="card-body pt-5">
          <div class="filters filters-6">
            <div class="lg:col-span-2">
              <span class="field-label">Search</span>
              <div class="search">
                ${raw(SM.dom.icon('search'))}
                <input class="field" type="search" data-act="search"
                       placeholder="Site, IP, issues or remarks"
                       value="${state.q}" aria-label="Search records">
                ${state.q ? SM.ui.IconButton({
                  icon: 'x', size: 'sm', act: 'clear-search', title: 'Clear search',
                  cls: 'search-clear'
                }) : ''}
              </div>
            </div>

            ${SM.ui.Field({ name: 'from', label: 'From', type: 'date', value: state.from,
                            max: state.to || null, act: 'filter-from' })}
            ${SM.ui.Field({ name: 'to', label: 'To', type: 'date', value: state.to,
                            min: state.from || null, act: 'filter-to' })}

            ${SM.ui.Select({ name: 'site', label: 'LHIO', value: state.locationId || '',
                             placeholder: 'Any site', act: 'filter-site',
                             options: dedupeSites(sites) })}

            ${SM.ui.Select({ name: 'system', label: 'System', value: state.systemId || '',
                             placeholder: 'Any system', act: 'filter-system',
                             options: systems.map(function (s) { return [s.id, s.name]; }) })}

            ${SM.ui.Select({ name: 'status', label: 'Status', value: state.status,
                             placeholder: 'Any status', act: 'filter-status',
                             options: SM.schema.STATUSES.map(function (s) { return [s, s]; }) })}

            <div class="md:hidden">
              <span class="field-label">Sort by</span>
              <div class="flex gap-2">
                ${SM.ui.Select({
                  name: 'sort', act: 'sort-select', value: state.sort, ariaLabel: 'Sort by',
                  options: Object.keys(SORT_LABELS).map(function (k) {
                    return [k, SORT_LABELS[k]];
                  })
                })}
                ${SM.ui.IconButton({
                  icon: state.dir === 'asc' ? 'arrow-up' : 'arrow-down',
                  act: 'toggle-dir', variant: 'secondary',
                  title: state.dir === 'asc' ? 'Oldest first' : 'Newest first'
                })}
              </div>
            </div>

            <div class="filters-reset">
              ${SM.ui.Button({ label: 'Reset', icon: 'rotate-ccw', variant: 'secondary',
                               act: 'reset-filters' })}
            </div>
          </div>

          <p class="mt-3 text-12 text-muted">${SM.fmt.plural(total, 'record')} match.</p>
        </div>`;
    }

    /* One entry per office, not per office-and-system, or the list repeats. */
    function dedupeSites(sites) {
      var seen = {};
      var out = [];
      for (var i = 0; i < sites.length; i++) {
        if (seen[sites[i].name]) continue;
        seen[sites[i].name] = true;
        out.push([sites[i].id, sites[i].name]);
      }
      return out;
    }

    /* ---------- raw output ---------- */

    function showRaw(id) {
      var check = SM.queries.checkById(id);
      if (!check) return;
      var row = SM.queries.decorateCheck(check);
      SM.ui.openDialog({
        title: 'Raw output',
        desc: row.location_name + ' · ' + SM.fmt.dateLabel(row.checked_at) + ' ' +
              SM.fmt.timeLabel(row.checked_at),
        body: raw('<pre class="raw-output">' +
          SM.dom.esc(row.raw_output || 'Nothing was recorded for this check.') + '</pre>'),
        footer: SM.ui.Button({ label: 'Close', variant: 'secondary', act: 'cancel' }),
        onMount: function (panel, api) {
          SM.dom.delegate(panel, 'click', '[data-act="cancel"]', function () { api.close(); });
        }
      });
    }

    /* ---------- export ---------- */

    function exportMenu(anchor) {
      var state = readState();
      var total = query(state, false).total;

      SM.ui.showMenu(anchor, [
        { label: 'Export ' + SM.fmt.plural(total, 'filtered record'), heading: true },
        { label: 'CSV', desc: 'Opens in Excel', icon: 'table-2',
          onSelect: function () { SM.exports.csv(state, total); } },
        { label: 'Printable form', desc: 'Print, or save as PDF', icon: 'printer',
          onSelect: function () { SM.exports.print(state, total); } },
        { label: 'QM.txt log', desc: 'Raw ping output, legacy format', icon: 'file-text',
          onSelect: function () { SM.exports.qm(state, total); } }
      ], { ariaLabel: 'Export options', align: 'end' });
    }

    /* ---------- events ---------- */

    var pushSearch = SM.dom.debounce(function (value) {
      SM.router.patchParams({ q: value, page: null }, true);
    }, 250);
    ctx.onCleanup(function () { pushSearch.cancel(); });

    ctx.onCleanup(SM.dom.delegate(root, 'input', '[data-act="search"]', function (e, node) {
      pushSearch(node.value);
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="clear-search"]', function () {
      pushSearch.cancel();
      SM.router.patchParams({ q: null, page: null });
    }));

    var FILTERS = {
      'filter-from': 'from', 'filter-to': 'to', 'filter-site': 'site',
      'filter-system': 'system', 'filter-status': 'status'
    };
    Object.keys(FILTERS).forEach(function (act) {
      ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="' + act + '"]',
        function (e, node) {
          var patch = { page: null };
          patch[FILTERS[act]] = node.value || null;
          SM.router.patchParams(patch);
        }));
    });

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="reset-filters"]', function () {
      pushSearch.cancel();
      SM.router.setParams({});
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="sort-select"]', function (e, node) {
      SM.router.patchParams({ sort: node.value, page: null });
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="toggle-dir"]', function () {
      SM.router.patchParams({
        dir: readState().dir === 'desc' ? 'asc' : 'desc', page: null
      });
    }));

    /* Column headers: same key flips direction, a new key starts descending. */
    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="sort"]', function (e, node) {
      var key = node.getAttribute('data-value');
      var state = readState();
      if (state.sort === key) {
        SM.router.patchParams({ dir: state.dir === 'desc' ? 'asc' : 'desc', page: null });
      } else {
        SM.router.patchParams({ sort: key, dir: 'desc', page: null });
      }
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="page"]', function (e, node) {
      var page = parseInt(node.getAttribute('data-value'), 10);
      SM.router.patchParams({ page: page > 1 ? page : null });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="show-raw"]', function (e, node) {
      showRaw(parseInt(node.getAttribute('data-value'), 10));
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="export-menu"]', function (e, node) {
      exportMenu(node);
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="set-status"]', function (e, node) {
      var id = parseInt(node.getAttribute('data-id'), 10);
      SM.mutate.updateCheck(id, { status: node.value });
    }));

    ctx.onCleanup(SM.ui.bindInlineEdit(root, function (id, field, value) {
      var patch = {};
      patch[field] = value;
      SM.mutate.updateCheck(id, patch);
    }));

    ctx.onCleanup(SM.store.subscribe(['checks', 'locations', 'system_types'], update,
      { signal: ctx.signal }));
    ctx.onCleanup(function () { SM.ui.closeMenu(); });

    update();
    return { onParams: update };
  }

  return { mount: mount, PAGE_SIZE: PAGE_SIZE };
})();
