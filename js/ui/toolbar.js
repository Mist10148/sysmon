/*
  The list toolbar, and the search-and-sort logic behind it.

  Two things are worth stating.

  First, sort lives in two places by design. From 768px up you click a column
  header; below it the header row does not exist, because the table has become a
  card list - so the same sort keys appear as a select in the toolbar. Both write
  to the same hash parameters, so the two surfaces cannot disagree.

  Second, reordering is disabled whenever the list is not in manual order. Moving
  row 3 above row 2 has no meaning when the rows on screen have been filtered by
  a search and sorted by name; rather than silently reorder something the
  operator cannot see, the arrows go grey and say why.
*/
window.SM = window.SM || {};
SM.ui = SM.ui || {};

(function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;

  /*
    config: {
      sorts: [{ key, label, compare(a, b) }],
      defaultSort: 'order',
      searchFields: ['name', 'ip', ...]
    }
    params: the route's hash parameters.
  */
  function listControls(params, config) {
    var q = params.q || '';
    var sort = params.sort || config.defaultSort;
    if (!findSort(config, sort)) sort = config.defaultSort;
    var dir = params.dir === 'desc' ? 'desc' : 'asc';

    var isDefaultOrder = !q && sort === config.defaultSort && dir === 'asc';

    function apply(rows) {
      var out = rows;
      if (q) {
        out = rows.filter(function (row) {
          return SM.queries.matches(row, config.searchFields, q);
        });
      } else {
        out = rows.slice();
      }
      var spec = findSort(config, sort);
      if (spec && spec.compare) {
        var sign = dir === 'desc' ? -1 : 1;
        out.sort(function (a, b) {
          var cmp = spec.compare(a, b);
          if (cmp === 0) cmp = (a.sort_order || 0) - (b.sort_order || 0);
          if (cmp === 0) cmp = a.id - b.id;
          return cmp * sign;
        });
      }
      return out;
    }

    return {
      q: q, sort: sort, dir: dir,
      isDefaultOrder: isDefaultOrder,
      apply: apply,
      sorts: config.sorts
    };
  }

  function findSort(config, key) {
    for (var i = 0; i < config.sorts.length; i++) {
      if (config.sorts[i].key === key) return config.sorts[i];
    }
    return null;
  }

  /*
    opts: {
      controls,          from listControls()
      placeholder,       the search field's placeholder
      count,             "6 of 8 sites"
      extra,             raw markup dropped between the search and the count
    }
  */
  function ListToolbar(opts) {
    var o = opts || {};
    var c = o.controls;

    return raw(html`
      <div class="toolbar">
        <div class="search">
          ${raw(SM.dom.icon('search'))}
          <input class="field" type="search" data-act="search"
                 placeholder="${o.placeholder || 'Search'}"
                 value="${c.q}" aria-label="${o.placeholder || 'Search'}">
          ${c.q ? SM.ui.IconButton({
            icon: 'x', size: 'sm', act: 'clear-search', title: 'Clear search',
            cls: 'search-clear'
          }) : ''}
        </div>

        ${o.extra || ''}

        <div class="toolbar-sort">
          ${SM.ui.Select({
            name: 'sort-by', act: 'sort-select', value: c.sort,
            ariaLabel: 'Sort by',
            cls: 'w-auto',
            options: c.sorts.map(function (s) { return [s.key, s.label]; })
          })}
          ${SM.ui.IconButton({
            icon: c.dir === 'asc' ? 'arrow-up' : 'arrow-down',
            size: 'sm', act: 'toggle-dir', variant: 'secondary',
            title: c.dir === 'asc' ? 'Ascending' : 'Descending'
          })}
        </div>

        ${o.count ? raw('<span class="toolbar-count">' + SM.dom.esc(o.count) + '</span>') : ''}
      </div>`);
  }

  /*
    Wires the toolbar and the sortable column heads to the hash. Every page with
    a list calls this once and then only has to render.

    Search is debounced and replaces the history entry rather than pushing one,
    so typing eight characters does not need eight presses of the back button to
    undo.
  */
  function bindListControls(root, options) {
    var o = options || {};
    var offs = [];

    var pushSearch = SM.dom.debounce(function (value) {
      SM.router.patchParams({ q: value, page: null }, true);
    }, 220);

    offs.push(SM.dom.delegate(root, 'input', '[data-act="search"]', function (e, node) {
      pushSearch(node.value);
    }));

    offs.push(SM.dom.delegate(root, 'click', '[data-act="clear-search"]', function () {
      pushSearch.cancel();
      SM.router.patchParams({ q: null, page: null });
    }));

    offs.push(SM.dom.delegate(root, 'change', '[data-act="sort-select"]', function (e, node) {
      SM.router.patchParams({ sort: node.value, page: null });
    }));

    offs.push(SM.dom.delegate(root, 'click', '[data-act="toggle-dir"]', function () {
      var dir = SM.router.currentParams().dir === 'desc' ? 'asc' : 'desc';
      SM.router.patchParams({ dir: dir, page: null });
    }));

    /* A column header: same key flips the direction, a new key resets it. */
    offs.push(SM.dom.delegate(root, 'click', '[data-act="sort"]', function (e, node) {
      var key = node.getAttribute('data-value');
      var params = SM.router.currentParams();
      var current = params.sort || o.defaultSort;
      if (current === key) {
        SM.router.patchParams({ dir: params.dir === 'desc' ? 'asc' : 'desc', page: null });
      } else {
        SM.router.patchParams({ sort: key, dir: o.defaultDir || 'asc', page: null });
      }
    }));

    offs.push(SM.dom.delegate(root, 'click', '[data-act="page"]', function (e, node) {
      var page = parseInt(node.getAttribute('data-value'), 10);
      SM.router.patchParams({ page: page > 1 ? page : null });
      /* A new page starts at the top of the list, not halfway down the old one. */
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));

    return function unbind() {
      pushSearch.cancel();
      for (var i = 0; i < offs.length; i++) offs[i]();
    };
  }

  /*
    Keeps the caret where it was after a re-render. Assigning innerHTML on a
    section containing the focused search field would otherwise drop focus on
    the first keystroke, which makes a search box unusable.
  */
  function preserveFocus(root, render) {
    var active = document.activeElement;
    var selector = null, start = null, end = null;
    if (active && root.contains(active) && active.hasAttribute('data-act')) {
      selector = '[data-act="' + active.getAttribute('data-act') + '"]';
      if (active.selectionStart != null) {
        start = active.selectionStart;
        end = active.selectionEnd;
      }
    }
    render();
    if (!selector) return;
    var next = SM.dom.qs(selector, root);
    if (!next) return;
    next.focus();
    if (start != null && next.setSelectionRange) {
      try { next.setSelectionRange(start, end); } catch (err) { /* not a text field */ }
    }
  }

  SM.ui.listControls = listControls;
  SM.ui.ListToolbar = ListToolbar;
  SM.ui.bindListControls = bindListControls;
  SM.ui.preserveFocus = preserveFocus;
})();
