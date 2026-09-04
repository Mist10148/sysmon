/*
  Activity - what happened and when.

  A diary rather than a log. Each entry is a sentence someone would say out loud
  ("BACOLOD went down"), with the machine detail underneath, because the audience
  is the person writing the monthly report rather than someone debugging the
  application.

  Only crossings are recorded, never the steady state. A site that is down for
  three days produces one entry, not one per sweep - otherwise the feed is
  nothing but the same line repeated and the day something actually changed is
  impossible to find.

  The day headings stick to the top of the scroll, offset by --topbar-h so they
  clear the mobile bar rather than sliding under it.
*/
window.SM = window.SM || {};
SM.pages = SM.pages || {};

SM.pages.activity = (function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;
  var PAGE_SIZE = 40;

  function mount(ctx) {
    var root = ctx.view;

    root.innerHTML = html`
      <div id="v-header"></div>
      <div class="page-body">
        <div class="card surface-card" id="v-filters"></div>
        <div class="card surface-card" id="v-feed"></div>
      </div>`;

    var elHeader = SM.dom.qs('#v-header', root);
    var elFilters = SM.dom.qs('#v-filters', root);
    var elFeed = SM.dom.qs('#v-feed', root);

    function readState() {
      var p = SM.router.currentParams();
      return {
        from: p.from || '',
        to: p.to || '',
        kind: SM.activityLog.KIND_LABELS[p.kind] ? p.kind : '',
        severity: SM.activityLog.SEVERITY_LABELS[p.severity] ? p.severity : '',
        systemId: p.system ? parseInt(p.system, 10) : null,
        page: Math.max(1, parseInt(p.page, 10) || 1),
        isDefault: !p.from && !p.to && !p.kind && !p.severity && !p.system
      };
    }

    function update() {
      var state = readState();
      var result = SM.queries.activity({
        from: state.from, to: state.to, kind: state.kind,
        severity: state.severity, systemTypeId: state.systemId,
        page: state.page, pageSize: PAGE_SIZE
      });

      if (result.total && !result.rows.length && state.page > 1) {
        SM.router.patchParams({ page: null }, true);
        return;
      }

      elHeader.innerHTML = SM.ui.PageHeader({
        title: 'Activity',
        desc: 'Every sweep, outage, recovery and change — what happened and when',
        actions: SM.ui.Button({ label: 'Prune', icon: 'trash-2', variant: 'secondary',
                                act: 'prune' })
      }).__html;

      elFilters.innerHTML = filterCard(state, result.total);
      elFeed.innerHTML = feed(result, state);
    }

    function filterCard(state, total) {
      var systems = SM.queries.systemTypes({ includeInactive: true });
      return html`
        <div class="card-body pt-5">
          <div class="filters filters-6">
            ${SM.ui.Field({ name: 'from', label: 'From', type: 'date', value: state.from,
                            max: state.to || null, act: 'filter-from' })}
            ${SM.ui.Field({ name: 'to', label: 'To', type: 'date', value: state.to,
                            min: state.from || null, act: 'filter-to' })}

            ${SM.ui.Select({ name: 'kind', label: 'Kind', value: state.kind,
                             placeholder: 'Everything', act: 'filter-kind',
                             options: Object.keys(SM.activityLog.KIND_LABELS).map(function (k) {
                               return [k, SM.activityLog.KIND_LABELS[k]];
                             }) })}

            ${SM.ui.Select({ name: 'severity', label: 'Severity', value: state.severity,
                             placeholder: 'Any severity', act: 'filter-severity',
                             options: Object.keys(SM.activityLog.SEVERITY_LABELS).map(function (k) {
                               return [k, SM.activityLog.SEVERITY_LABELS[k]];
                             }) })}

            ${SM.ui.Select({ name: 'system', label: 'System', value: state.systemId || '',
                             placeholder: 'All systems', act: 'filter-system',
                             options: systems.map(function (s) { return [s.id, s.name]; }) })}

            <div class="filters-reset">
              ${SM.ui.Button({ label: 'Reset', icon: 'rotate-ccw', variant: 'secondary',
                               act: 'reset-filters', disabled: state.isDefault })}
            </div>
          </div>
          <p class="mt-3 text-12 text-muted">${SM.fmt.plural(total, 'entry', 'entries')}.</p>
        </div>`;
    }

    function feed(result, state) {
      if (!result.rows.length) {
        return SM.ui.Empty({
          icon: 'scroll-text',
          title: state.isDefault ? 'Nothing has happened yet' : 'No entries match these filters',
          desc: state.isDefault
            ? 'Run a sweep from the Dashboard and this fills in.'
            : 'Widen the dates, or reset the filters.'
        }).__html;
      }

      var groups = SM.queries.groupByDay(result.rows);
      var body = groups.map(function (group) {
        return html`
          <h2 class="day-heading">${group.label}</h2>
          ${raw(group.rows.map(row).join(''))}`;
      }).join('');

      return '<div class="card-body pt-3">' + body + '</div>' +
        SM.ui.Pagination({
          page: state.page, pageSize: PAGE_SIZE, total: result.total
        }).__html;
    }

    function row(entry) {
      var system = entry.system_type_id ? SM.queries.systemById(entry.system_type_id) : null;
      return html`
        <div class="act-row">
          ${SM.ui.ActivityBadge(entry)}
          <div class="act-body">
            <div class="act-subject">${entry.subject}</div>
            ${entry.detail ? raw('<div class="act-detail">' + SM.dom.esc(entry.detail) + '</div>') : ''}
          </div>
          ${system ? raw(html`
            <span class="act-sys">
              ${SM.ui.SystemDot(system.color)}
              <span>${system.name}</span>
            </span>`) : ''}
          <time class="act-time" datetime="${entry.at}">${SM.fmt.timeLabel(entry.at)}</time>
        </div>`;
    }

    /* ---------- prune ---------- */

    /*
      A date rather than "delete everything", because the reason to prune is
      almost always that the feed has grown past what is useful, not that its
      contents are wrong. Ninety days back is the default for the same reason.
    */
    function openPrune() {
      var today = new Date();
      var suggested = SM.fmt.isoDate(
        new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90));

      SM.ui.openAlert({
        title: 'Prune the activity feed',
        desc: 'Removes entries before a date. Checks and their measurements are ' +
              'not affected.',
        confirmLabel: 'Prune',
        tone: 'destructive',
        body: raw(html`
          ${SM.ui.Field({ name: 'before', label: 'Remove entries before',
                          type: 'date', value: suggested,
                          max: SM.fmt.isoDate(today) })}
          <p class="mt-3 warn-block">This cannot be undone. Export your data first
            if the feed matters to you.</p>`),
        onConfirm: function (api) {
          var field = SM.dom.qs('[name="before"]', api.panel);
          var before = field && field.value;
          if (!before) { api.close(); return; }
          var removed = SM.mutate.pruneActivity(before);
          api.close();
          if (removed) {
            SM.toast.success(SM.fmt.plural(removed, 'entry', 'entries') + ' pruned');
          } else {
            SM.toast.info('Nothing to prune', 'No entries are older than that date.');
          }
        }
      });
    }

    /* ---------- events ---------- */

    var FILTERS = {
      'filter-from': 'from', 'filter-to': 'to', 'filter-kind': 'kind',
      'filter-severity': 'severity', 'filter-system': 'system'
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
      SM.router.setParams({});
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="page"]', function (e, node) {
      var page = parseInt(node.getAttribute('data-value'), 10);
      SM.router.patchParams({ page: page > 1 ? page : null });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="prune"]', openPrune));

    ctx.onCleanup(SM.store.subscribe(['activity', 'system_types'], update,
      { signal: ctx.signal }));

    update();
    return { onParams: update };
  }

  return { mount: mount, PAGE_SIZE: PAGE_SIZE };
})();
