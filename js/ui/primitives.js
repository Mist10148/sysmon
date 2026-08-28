/*
  The primitives.

  These are functions that return markup, not objects that own DOM. A page
  builds a string out of them, assigns it to a section, and handles clicks by
  delegation on [data-act]. Nothing here holds state, which is why a section can
  be thrown away and rebuilt without any bookkeeping.

  Everything returns SM.dom.raw(...) so it can be interpolated into another
  template without being escaped a second time.
*/
window.SM = window.SM || {};
SM.ui = SM.ui || {};

(function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;
  var attr = SM.dom.attr;
  var icon = SM.dom.icon;
  var cx = SM.dom.cx;

  /* ---------- button ---------- */

  /*
    opts: { label, variant, size, icon, iconAfter, act, value, disabled, title,
            type, cls, ariaLabel, spinning, pressed, href }
  */
  function Button(opts) {
    var o = opts || {};
    var cls = cx('btn', 'btn-' + (o.variant || 'default'),
                 o.size ? 'btn-' + o.size : '', o.cls);
    var inner =
      (o.icon ? icon(o.icon, o.spinning ? 'spin' : '') : '') +
      (o.label ? '<span>' + SM.dom.esc(o.label) + '</span>' : '') +
      (o.iconAfter ? icon(o.iconAfter) : '');

    if (o.href) {
      return raw('<a class="' + cls + '"' + attr('href', o.href) +
        attr('title', o.title) + attr('aria-label', o.ariaLabel) + '>' + inner + '</a>');
    }
    return raw('<button class="' + cls + '"' +
      attr('type', o.type || 'button') +
      attr('data-act', o.act) +
      attr('data-value', o.value) +
      attr('title', o.title) +
      attr('aria-label', o.ariaLabel) +
      attr('aria-pressed', o.pressed == null ? null : String(o.pressed)) +
      (o.disabled ? ' disabled' : '') +
      '>' + inner + '</button>');
  }

  function IconButton(opts) {
    var o = opts || {};
    o.size = o.size === 'sm' ? 'icon-sm' : 'icon';
    o.variant = o.variant || 'ghost';
    o.ariaLabel = o.ariaLabel || o.title;
    o.label = null;
    return Button(o);
  }

  /* ---------- fields ---------- */

  /*
    opts: { name, label, value, type, placeholder, hint, error, act, min, max,
            step, required, disabled, cls, id, inputmode, autocomplete }
  */
  function Field(opts) {
    var o = opts || {};
    var id = o.id || ('f-' + o.name);
    return raw(html`
      <div class="${cx('min-w-0', o.cls)}">
        ${o.label ? raw('<label class="field-label" for="' + SM.dom.esc(id) + '">' +
                        SM.dom.esc(o.label) + '</label>') : ''}
        ${raw('<input class="field" id="' + SM.dom.esc(id) + '"' +
          attr('name', o.name) +
          attr('type', o.type || 'text') +
          attr('value', o.value == null ? '' : o.value) +
          attr('placeholder', o.placeholder) +
          attr('data-act', o.act) +
          attr('min', o.min) + attr('max', o.max) + attr('step', o.step) +
          attr('inputmode', o.inputmode) +
          attr('autocomplete', o.autocomplete || 'off') +
          attr('aria-invalid', o.error ? 'true' : null) +
          (o.required ? ' required' : '') +
          (o.disabled ? ' disabled' : '') + '>')}
        ${o.error ? raw('<p class="field-error">' + SM.dom.esc(o.error) + '</p>')
                  : (o.hint ? raw('<p class="field-hint">' + SM.dom.esc(o.hint) + '</p>') : '')}
      </div>`);
  }

  function Textarea(opts) {
    var o = opts || {};
    var id = o.id || ('f-' + o.name);
    return raw(html`
      <div class="${cx('min-w-0', o.cls)}">
        ${o.label ? raw('<label class="field-label" for="' + SM.dom.esc(id) + '">' +
                        SM.dom.esc(o.label) + '</label>') : ''}
        ${raw('<textarea class="field" id="' + SM.dom.esc(id) + '"' +
          attr('name', o.name) + attr('placeholder', o.placeholder) +
          attr('data-act', o.act) + attr('rows', o.rows) +
          (o.disabled ? ' disabled' : '') + '>' +
          SM.dom.esc(o.value == null ? '' : o.value) + '</textarea>')}
        ${o.hint ? raw('<p class="field-hint">' + SM.dom.esc(o.hint) + '</p>') : ''}
      </div>`);
  }

  /*
    Native <select>. opts.options is [{ value, label, disabled }] or
    [[value, label]]; opts.placeholder adds a leading empty choice.
  */
  function Select(opts) {
    var o = opts || {};
    var id = o.id || ('f-' + o.name);
    var items = (o.options || []).map(function (item) {
      var value = Array.isArray(item) ? item[0] : item.value;
      var label = Array.isArray(item) ? item[1] : item.label;
      var selected = String(value) === String(o.value == null ? '' : o.value);
      return '<option' + attr('value', value) + (selected ? ' selected' : '') +
        (item.disabled ? ' disabled' : '') + '>' + SM.dom.esc(label) + '</option>';
    }).join('');

    var placeholder = o.placeholder
      ? '<option value=""' + (o.value ? '' : ' selected') + '>' +
        SM.dom.esc(o.placeholder) + '</option>'
      : '';

    return raw(html`
      <div class="${cx('min-w-0', o.cls)}">
        ${o.label ? raw('<label class="field-label" for="' + SM.dom.esc(id) + '">' +
                        SM.dom.esc(o.label) + '</label>') : ''}
        ${raw('<select class="field select' + (o.bare ? ' select-bare' : '') + '" id="' +
          SM.dom.esc(id) + '"' +
          attr('name', o.name) + attr('data-act', o.act) +
          attr('data-tone', o.tone) + attr('data-id', o.dataId) +
          attr('aria-label', o.ariaLabel) +
          (o.disabled ? ' disabled' : '') + '>' + placeholder + items + '</select>')}
        ${o.hint ? raw('<p class="field-hint">' + SM.dom.esc(o.hint) + '</p>') : ''}
      </div>`);
  }

  /*
    A real checkbox with the iOS pill drawn over it in CSS, so the label
    association, the keyboard and the form semantics are the browser's.
  */
  function Switch(opts) {
    var o = opts || {};
    var id = o.id || ('sw-' + (o.name || Math.round(o.value * 1e6)));
    return raw('<input type="checkbox" class="switch" id="' + SM.dom.esc(id) + '"' +
      attr('data-act', o.act) + attr('data-id', o.dataId) + attr('name', o.name) +
      attr('aria-label', o.ariaLabel) +
      (o.checked ? ' checked' : '') + (o.disabled ? ' disabled' : '') + '>');
  }

  function SwitchRow(opts) {
    var o = opts || {};
    var id = o.id || ('sw-' + o.name);
    return raw(html`
      <div class="switch-row">
        <label class="min-w-0" for="${id}">
          <div class="switch-row-label">${o.label}</div>
          ${o.hint ? raw('<div class="switch-row-hint">' + SM.dom.esc(o.hint) + '</div>') : ''}
        </label>
        ${Switch({ id: id, name: o.name, act: o.act, checked: o.checked, disabled: o.disabled })}
      </div>`);
  }

  /*
    opts: { items: [{ value, label, icon }], value, act, size, ariaLabel }
    Rendered as buttons with aria-pressed rather than as radios, because these
    switch a view rather than submit a value.
  */
  function Segmented(opts) {
    var o = opts || {};
    return raw(html`
      <div class="${cx('segmented', o.size === 'sm' && 'segmented-sm', o.cls)}"
           role="group"${raw(attr('aria-label', o.ariaLabel))}>
        ${o.items.map(function (item) {
          var on = String(item.value) === String(o.value);
          return raw('<button type="button" class="segmented-item"' +
            attr('data-act', o.act) + attr('data-value', item.value) +
            ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
            (item.icon ? icon(item.icon) : '') +
            (item.label ? '<span>' + SM.dom.esc(item.label) + '</span>' : '') +
            '</button>');
        })}
      </div>`);
  }

  /* ---------- containers ---------- */

  /* opts: { title, desc, icon, body, foot, glass, cls, id } */
  function Card(opts) {
    var o = opts || {};
    return raw(html`
      <section class="${cx('card', o.glass ? 'glass' : 'surface-card', o.cls)}"${raw(attr('id', o.id))}>
        ${o.title ? raw(html`
          <div class="card-head">
            <div class="card-title-row">
              ${o.icon ? raw(icon(o.icon, 'icon-lg text-muted')) : ''}
              <h2 class="card-title">${o.title}</h2>
            </div>
            ${o.desc ? raw('<p class="card-desc">' + SM.dom.esc(o.desc) + '</p>') : ''}
          </div>`) : ''}
        <div class="card-body">${o.body}</div>
        ${o.foot ? raw('<div class="card-foot">' + o.foot.__html + '</div>') : ''}
      </section>`);
  }

  function PageHeader(opts) {
    var o = opts || {};
    return raw(html`
      <header class="page-header">
        <div class="min-w-0">
          <h1>${o.title}</h1>
          ${o.desc ? raw('<p class="page-header-desc">' + SM.dom.esc(o.desc) + '</p>') : ''}
        </div>
        ${o.actions ? raw('<div class="page-header-actions">' + o.actions.__html + '</div>') : ''}
      </header>`);
  }

  /* opts: { label, value, hint, tone } */
  function StatTile(opts) {
    var o = opts || {};
    var toneClass = o.tone ? 'text-' + o.tone : '';
    return raw(html`
      <div class="stat-tile glass">
        <div class="stat-label">${o.label}</div>
        <div class="${cx('stat-value', toneClass)}">${o.value}</div>
        ${o.hint ? raw('<div class="stat-hint">' + SM.dom.esc(o.hint) + '</div>') : ''}
      </div>`);
  }

  function Skeleton(cls, style) {
    return raw('<div class="' + cx('skeleton', cls) + '"' + attr('style', style) + '></div>');
  }

  /* opts: { icon, title, desc, action } */
  function Empty(opts) {
    var o = opts || {};
    return raw(html`
      <div class="empty">
        ${o.icon ? raw(icon(o.icon, 'icon-xl')) : ''}
        <p class="empty-title">${o.title}</p>
        ${o.desc ? raw('<p class="empty-desc">' + SM.dom.esc(o.desc) + '</p>') : ''}
        ${o.action || ''}
      </div>`);
  }

  SM.ui.Button = Button;
  SM.ui.IconButton = IconButton;
  SM.ui.Field = Field;
  SM.ui.Textarea = Textarea;
  SM.ui.Select = Select;
  SM.ui.Switch = Switch;
  SM.ui.SwitchRow = SwitchRow;
  SM.ui.Segmented = Segmented;
  SM.ui.Card = Card;
  SM.ui.PageHeader = PageHeader;
  SM.ui.StatTile = StatTile;
  SM.ui.Skeleton = Skeleton;
  SM.ui.Empty = Empty;
})();
