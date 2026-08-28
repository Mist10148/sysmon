/*
  Tables.

  All five tables in SysMon go through this one renderer, which is what makes
  the phone card-stack worth having: the transform in table.css is proved once
  and inherited everywhere.

  A column is:
    { key, label, cls, sortable, width, primary, hideMobile, actions, num,
      cell: function (row, index) -> markup string }

  `primary` marks the column that becomes the card's headline on a phone;
  `hideMobile` drops the column entirely there (the row-number column); the rest
  become label/value pairs whose label is the column's own label.
*/
window.SM = window.SM || {};
SM.ui = SM.ui || {};

(function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;
  var attr = SM.dom.attr;
  var cx = SM.dom.cx;

  /*
    opts: { columns, rows, sort, dir, rowId, rowSig, empty, colgroupCls,
            sortAct, cls }
  */
  function Table(opts) {
    var o = opts || {};
    var cols = o.columns;

    var head = cols.map(function (col) {
      return '<th class="' + cx(col.cls, col.num && 'num', col.width) + '"' +
        attr('scope', 'col') + '>' + headInner(col, o) + '</th>';
    }).join('');

    var body;
    if (!o.rows.length) {
      body = '<tr><td colspan="' + cols.length + '" class="py-10 text-center text-muted">' +
        (o.empty || 'Nothing to show.') + '</td></tr>';
    } else {
      body = o.rows.map(function (row, index) {
        return renderRow(cols, row, index, o);
      }).join('');
    }

    return raw(html`
      <div class="table-wrap">
        <table class="${cx('table', 'table-stack', o.cls)}">
          <thead><tr>${raw(head)}</tr></thead>
          <tbody>${raw(body)}</tbody>
        </table>
      </div>`);
  }

  function headInner(col, o) {
    if (!col.sortable) return SM.dom.esc(col.label || '');
    var active = o.sort === col.key;
    var dir = active ? (o.dir === 'asc' ? 'ascending' : 'descending') : null;
    var arrow = active
      ? SM.dom.icon(o.dir === 'asc' ? 'arrow-up' : 'arrow-down')
      : SM.dom.icon('arrow-down');
    return '<button type="button" class="sort-head"' +
      attr('data-act', o.sortAct || 'sort') +
      attr('data-value', col.key) +
      attr('aria-sort', dir) + '>' +
      SM.dom.esc(col.label || '') + arrow + '</button>';
  }

  function renderRow(cols, row, index, o) {
    var id = o.rowId ? o.rowId(row) : row.id;
    var sig = o.rowSig ? o.rowSig(row) : null;
    var cells = cols.map(function (col) {
      var value = col.cell ? col.cell(row, index) : SM.dom.esc(row[col.key] == null ? '' : row[col.key]);
      if (value && typeof value === 'object' && typeof value.__html === 'string') {
        value = value.__html;
      }
      return '<td class="' + cx(col.cls, col.num && 'num') + '"' +
        (col.primary ? ' data-primary' : '') +
        (col.hideMobile ? ' data-hidden-mobile' : '') +
        (col.actions ? ' data-actions' : '') +
        (!col.primary && !col.hideMobile && !col.actions && col.label
          ? attr('data-label', col.label) : '') +
        '>' + value + '</td>';
    }).join('');

    return '<tr' + attr('data-row-id', id) + attr('data-sig', sig) + '>' + cells + '</tr>';
  }

  /*
    Replaces only the rows whose rendered content changed.

    Whole-section innerHTML is the default everywhere else, but History and
    Locations must not use it: a sweep landing while someone is typing in an
    inline editor would take the caret with it. Comparing a cheap signature per
    row and swapping just that row keeps focus where it was.
  */
  function patchRows(tbody, cols, rows, o) {
    if (!tbody) return;
    var existing = {};
    var kids = tbody.children;
    for (var i = 0; i < kids.length; i++) {
      var key = kids[i].getAttribute('data-row-id');
      if (key != null) existing[key] = kids[i];
    }

    var wanted = [];
    for (var r = 0; r < rows.length; r++) {
      var id = String(o.rowId ? o.rowId(rows[r]) : rows[r].id);
      var sig = o.rowSig ? String(o.rowSig(rows[r])) : null;
      var node = existing[id];
      if (node && sig != null && node.getAttribute('data-sig') === sig) {
        wanted.push(node);
        delete existing[id];
      } else {
        var fresh = SM.dom.el(renderRow(cols, rows[r], r, o));
        wanted.push(fresh);
        if (node) delete existing[id];
      }
    }

    /* Anything not wanted any more, and then the new order in one pass. */
    tbody.replaceChildren.apply(tbody, wanted);
  }

  /*
    opts: { page, pageSize, total, act }
    "1-25 of 214", then Previous / Page 2 of 9 / Next.
  */
  function Pagination(opts) {
    var o = opts || {};
    var pages = Math.max(1, Math.ceil(o.total / o.pageSize));
    var page = Math.min(Math.max(1, o.page), pages);
    var first = o.total === 0 ? 0 : (page - 1) * o.pageSize + 1;
    var last = Math.min(o.total, page * o.pageSize);

    return raw(html`
      <div class="pager">
        <span>${first}&ndash;${last} of ${o.total}</span>
        <div class="pager-controls">
          ${SM.ui.Button({
            label: 'Previous', variant: 'secondary', size: 'sm',
            act: o.act || 'page', value: page - 1, disabled: page <= 1
          })}
          <span class="whitespace-nowrap">Page ${page} of ${pages}</span>
          ${SM.ui.Button({
            label: 'Next', variant: 'secondary', size: 'sm',
            act: o.act || 'page', value: page + 1, disabled: page >= pages
          })}
        </div>
      </div>`);
  }

  /* The reorder arrows in the Systems and Locations tables. */
  function ReorderCell(opts) {
    var o = opts || {};
    var title = o.disabled
      ? 'Clear the search and sort by manual order to reorder'
      : null;
    return raw(html`
      <span class="reorder"${raw(attr('title', title))}>
        ${SM.ui.IconButton({
          icon: 'arrow-up', size: 'sm', act: 'move-up', value: o.id,
          title: 'Move up', disabled: o.disabled || o.first
        })}
        ${SM.ui.IconButton({
          icon: 'arrow-down', size: 'sm', act: 'move-down', value: o.id,
          title: 'Move down', disabled: o.disabled || o.last
        })}
      </span>`);
  }

  SM.ui.Table = Table;
  SM.ui.patchRows = patchRows;
  SM.ui.Pagination = Pagination;
  SM.ui.ReorderCell = ReorderCell;
  SM.ui.renderRow = renderRow;
})();
