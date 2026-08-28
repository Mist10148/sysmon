/*
  Systems - what a system is, and how its sites are checked.

  A "system" is not a server. It is a service that every LHIO runs a copy of, and
  the thing it owns is the question asked of each copy: ping this address, or
  fetch this path and expect this status. A ping only proves a box is powered on,
  which for a web system is not the question worth asking - so the check method
  belongs here rather than being the same for everything.

  Deleting a system that still has sites is the one genuinely ambiguous action in
  the application, so it asks. Guessing would either orphan the sites or throw
  away their history, and both are unrecoverable.
*/
window.SM = window.SM || {};
SM.pages = SM.pages || {};

SM.pages.systems = (function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;

  var SORTS = [
    { key: 'order', label: 'Manual order', compare: function () { return 0; } },
    { key: 'name', label: 'Name',
      compare: function (a, b) { return SM.fmt.compareText(a.name, b.name); } },
    { key: 'method', label: 'Checked by',
      compare: function (a, b) { return SM.fmt.compareText(a.check_method, b.check_method); } },
    { key: 'sites', label: 'Sites',
      compare: function (a, b) { return a.target_count - b.target_count; } },
    { key: 'active', label: 'Active first',
      compare: function (a, b) { return (b.active ? 1 : 0) - (a.active ? 1 : 0); } }
  ];

  function mount(ctx) {
    var root = ctx.view;

    root.innerHTML = '<div id="s-header"></div><div class="page-body">' +
      '<div id="s-toolbar"></div><div class="card surface-card" id="s-table"></div></div>';

    var elHeader = SM.dom.qs('#s-header', root);
    var elToolbar = SM.dom.qs('#s-toolbar', root);
    var elTable = SM.dom.qs('#s-table', root);

    function readState() {
      var p = SM.router.currentParams();
      return {
        scope: p.scope === 'all' ? 'all' : 'active',
        controls: SM.ui.listControls(p, {
          sorts: SORTS,
          defaultSort: 'order',
          searchFields: ['name', 'description', 'check_method', 'slug']
        })
      };
    }

    /* ---------- columns ---------- */

    function columns(state, ordered) {
      return [
        { key: 'no', label: '#', cls: 'col-no text-faint', hideMobile: true,
          cell: function (row, index) { return String(index + 1); } },

        { key: 'name', label: 'System', primary: true,
          cell: function (row) {
            return html`
              <div class="flex items-center gap-2">
                ${SM.ui.SystemDot(row.color)}
                <span class="font-medium">${row.name}</span>
              </div>
              ${row.description
                ? raw('<div class="cell-sub">' + SM.dom.esc(row.description) + '</div>')
                : ''}`;
          } },

        { key: 'method', label: 'Checked by',
          cell: function (row) {
            return html`
              <span class="flex items-center gap-1.5">
                ${raw(SM.dom.icon(row.check_method === 'http' ? 'globe' : 'radio', 'icon-sm text-muted'))}
                <span class="mono text-12">${SM.fmt.describeCheckMethod(row)}</span>
              </span>`;
          } },

        { key: 'sites', label: 'Sites', num: true,
          cell: function (row) {
            return row.target_count
              ? html`<a class="text-accent" href="${SM.router.build('/locations', { system: row.id })}"
                        >${row.target_count}</a>`
              : '<span class="text-faint">0</span>';
          } },

        { key: 'active', label: 'Active', cls: 'col-active text-center',
          cell: function (row) {
            return SM.ui.Switch({
              act: 'toggle-active', dataId: row.id, checked: !!row.active,
              ariaLabel: 'Check ' + row.name
            }).__html;
          } },

        { key: 'order', label: 'Order', cls: 'col-order',
          cell: function (row, index) {
            return SM.ui.ReorderCell({
              id: row.id,
              disabled: !state.controls.isDefaultOrder,
              first: index === 0,
              last: index === ordered.length - 1
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

    /* ---------- render ---------- */

    function update() {
      var state = readState();
      var all = SM.queries.systemTypes({ includeInactive: state.scope === 'all' });
      var rows = state.controls.apply(all);

      elHeader.innerHTML = SM.ui.PageHeader({
        title: 'Systems',
        desc: 'Each one decides how its sites are checked',
        actions: SM.ui.Button({ label: 'Add system', icon: 'plus', act: 'add' })
      }).__html;

      SM.ui.preserveFocus(elToolbar, function () {
        elToolbar.innerHTML = SM.ui.ListToolbar({
          controls: state.controls,
          placeholder: 'Search systems',
          count: rows.length === all.length
            ? SM.fmt.plural(all.length, 'system')
            : rows.length + ' of ' + SM.fmt.plural(all.length, 'system'),
          extra: SM.ui.Segmented({
            act: 'set-scope', value: state.scope, size: 'sm', ariaLabel: 'Which systems',
            items: [{ value: 'active', label: 'Active' }, { value: 'all', label: 'All' }]
          })
        }).__html;
      });

      elTable.innerHTML = SM.ui.Table({
        columns: columns(state, rows),
        rows: rows,
        sort: state.controls.sort,
        dir: state.controls.dir,
        empty: state.controls.q
          ? 'No system matches that search.'
          : 'No systems yet. Add one to start monitoring.'
      }).__html;
    }

    /* ---------- the editor ---------- */

    function openEditor(system) {
      var editing = !!system;
      var s = system || {
        name: '', description: '', color: 'blue', icon: 'monitor',
        check_method: 'ping', http_scheme: 'https', http_port: '',
        http_path: '/', http_expect_status: 200, active: true
      };

      SM.ui.openDialog({
        title: editing ? 'Edit ' + s.name : 'Add a system',
        desc: 'A system is a service every site runs a copy of. Its check method ' +
              'decides what question is asked of each one.',
        body: raw(html`
          <div class="form-grid">
            ${SM.ui.Field({ name: 'name', label: 'Name', value: s.name, required: true,
                            placeholder: 'Nclaims' })}
            ${SM.ui.Field({ name: 'description', label: 'Description', value: s.description,
                            placeholder: 'What this system does' })}
            <div class="form-grid form-grid-2">
              ${SM.ui.Select({ name: 'color', label: 'Colour', value: s.color,
                               options: SM.schema.COLORS.map(function (c) {
                                 return [c, c.charAt(0).toUpperCase() + c.slice(1)];
                               }) })}
              ${SM.ui.Select({ name: 'icon', label: 'Icon', value: s.icon,
                               options: SM.schema.ICONS.map(function (i) { return [i, i]; }) })}
            </div>

            ${SM.ui.Select({ name: 'check_method', label: 'Checked by', value: s.check_method,
                             act: 'method-change',
                             options: [['ping', 'ICMP ping - is the box reachable'],
                                       ['http', 'HTTP request - does the service answer']] })}

            <div id="http-fields" ${raw(s.check_method === 'http' ? '' : 'hidden')}>
              <div class="form-grid form-grid-2">
                ${SM.ui.Select({ name: 'http_scheme', label: 'Scheme', value: s.http_scheme,
                                 options: [['http', 'http'], ['https', 'https']] })}
                ${SM.ui.Field({ name: 'http_port', label: 'Port', value: s.http_port,
                                type: 'number', min: 1, max: 65535,
                                placeholder: 'default', hint: 'Blank uses 80 or 443' })}
                ${SM.ui.Field({ name: 'http_path', label: 'Path', value: s.http_path,
                                placeholder: '/' })}
                ${SM.ui.Field({ name: 'http_expect_status', label: 'Expect status',
                                value: s.http_expect_status, type: 'number',
                                min: 100, max: 599 })}
              </div>
            </div>
          </div>`),
        footer: raw(
          SM.ui.Button({ label: 'Cancel', variant: 'secondary', act: 'cancel' }).__html +
          SM.ui.Button({ label: editing ? 'Save changes' : 'Add system',
                         type: 'submit' }).__html),

        onMount: function (panel, api) {
          SM.dom.delegate(panel, 'click', '[data-act="cancel"]', function () { api.close(); });
          /* The HTTP fields are meaningless for a ping, so they are not shown. */
          SM.dom.delegate(panel, 'change', '[data-act="method-change"]', function (e, node) {
            SM.dom.qs('#http-fields', panel).hidden = node.value !== 'http';
          });
        },

        onSubmit: function (data, api) {
          if (!String(data.name).trim()) {
            api.setError('name', 'A system needs a name.');
            return;
          }
          if (editing) {
            SM.mutate.updateSystemType(s.id, data);
            SM.toast.success(data.name + ' saved');
          } else {
            SM.mutate.createSystemType(data);
            SM.toast.success(data.name + ' added',
              'Add sites to it on the Locations page.');
          }
          api.close();
        }
      });
    }

    /* ---------- delete, with its three answers ---------- */

    function confirmDelete(system) {
      var others = SM.queries.systemTypes({ includeInactive: true })
        .filter(function (t) { return t.id !== system.id; });
      var count = system.target_count;
      var choice = count > 0 ? 'move' : 'purge';

      if (!count) {
        SM.ui.openAlert({
          title: 'Remove ' + system.name + '?',
          desc: 'It has no sites, so nothing else is affected.',
          confirmLabel: 'Remove', tone: 'destructive',
          onConfirm: function (api) {
            SM.mutate.deleteSystemType(system.id, 'purge');
            SM.toast.success(system.name + ' removed');
            api.close();
          }
        });
        return;
      }

      SM.ui.openAlert({
        title: 'Remove ' + system.name + '?',
        desc: 'It still has ' + SM.fmt.plural(count, 'site') +
              '. Decide what happens to them.',
        confirmLabel: 'Move and remove',
        tone: 'destructive',
        body: raw(html`
          <div class="flex flex-col gap-3">
            ${SM.ui.Segmented({
              act: 'set-disposition', value: choice, cls: 'w-full',
              ariaLabel: 'What happens to its sites',
              items: [{ value: 'move', label: 'Move its sites' },
                      { value: 'purge', label: 'Delete everything' }]
            })}

            <div id="move-block">
              ${others.length
                ? SM.ui.Select({ name: 'move_to', label: 'Move them to',
                                 value: others[0].id,
                                 options: others.map(function (t) { return [t.id, t.name]; }) })
                : raw('<p class="info-block">There is no other system to move them to. ' +
                      'Add one first, or delete everything.</p>')}
            </div>

            <div id="purge-block" hidden>
              <p class="warn-block">
                ${SM.fmt.plural(count, 'site')} and every check ever recorded for
                ${count === 1 ? 'it' : 'them'} will be deleted. This cannot be undone.
              </p>
            </div>

            <p class="info-block">
              If you only want to stop checking it, switch it off instead - that keeps
              everything and is reversible.
            </p>
          </div>`),

        onMount: function (panel, api) {
          var confirm = SM.dom.qs('[data-act="alert-confirm"]', panel);

          function paint() {
            var moving = choice === 'move';
            SM.dom.qs('#move-block', panel).hidden = !moving;
            SM.dom.qs('#purge-block', panel).hidden = moving;
            confirm.querySelector('span').textContent =
              moving ? 'Move and remove' : 'Delete permanently';
            confirm.disabled = moving && !others.length;
            SM.dom.qsa('[data-act="set-disposition"]', panel).forEach(function (node) {
              node.setAttribute('aria-pressed',
                node.getAttribute('data-value') === choice ? 'true' : 'false');
            });
          }

          SM.dom.delegate(panel, 'click', '[data-act="set-disposition"]', function (e, node) {
            choice = node.getAttribute('data-value');
            paint();
          });
          paint();
        },

        onConfirm: function (api) {
          var moveTo = null;
          var select = SM.dom.qs('[name="move_to"]', api.panel);
          if (choice === 'move' && select) moveTo = parseInt(select.value, 10);
          var result = SM.mutate.deleteSystemType(system.id, choice, moveTo);
          SM.toast.success(system.name + ' removed',
            choice === 'move'
              ? SM.fmt.plural(result.moved, 'site') + ' moved'
              : SM.fmt.plural(result.purgedSites, 'site') + ' and ' +
                SM.fmt.plural(result.purgedChecks, 'record') + ' deleted');
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

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="set-scope"]', function (e, node) {
      SM.router.patchParams({ scope: node.getAttribute('data-value') === 'all' ? 'all' : null });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'change', '[data-act="toggle-active"]', function (e, node) {
      var id = parseInt(node.getAttribute('data-id'), 10);
      SM.mutate.updateSystemType(id, { active: node.checked });
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="move-up"]', function (e, node) {
      SM.mutate.reorder('system_types', parseInt(node.getAttribute('data-value'), 10), 'up');
    }));
    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="move-down"]', function (e, node) {
      SM.mutate.reorder('system_types', parseInt(node.getAttribute('data-value'), 10), 'down');
    }));

    ctx.onCleanup(SM.dom.delegate(root, 'click', '[data-act="row-menu"]', function (e, node) {
      var id = parseInt(node.getAttribute('data-value'), 10);
      var system = SM.queries.systemTypes({ includeInactive: true }).filter(function (t) {
        return t.id === id;
      })[0];
      if (!system) return;

      SM.ui.showMenu(node, [
        { label: 'Edit', icon: 'pencil', onSelect: function () { openEditor(system); } },
        { label: system.target_count
            ? 'View its ' + SM.fmt.plural(system.target_count, 'site')
            : 'Add a site to it',
          icon: 'activity-square',
          onSelect: function () { SM.router.go('/locations', { system: system.id }); } },
        { separator: true },
        { label: 'Remove', icon: 'trash-2', tone: 'destructive',
          onSelect: function () { confirmDelete(system); } }
      ], { ariaLabel: 'Actions for ' + system.name });
    }));

    ctx.onCleanup(SM.store.subscribe(['system_types', 'locations'], update, { signal: ctx.signal }));
    ctx.onCleanup(function () { SM.ui.closeMenu(); });

    update();
    return { onParams: update };
  }

  return { mount: mount };
})();
