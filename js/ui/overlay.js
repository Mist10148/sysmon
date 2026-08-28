/*
  Dialogs, alert dialogs, dropdown menus and tooltips.

  Dialogs use the native <dialog> element and showModal(). That single decision
  provides the focus trap, the initial focus, Escape to close, an inert
  background and correct stacking above Leaflet's z-index layers - every one of
  which is a known-hard thing to reimplement, and all of which the browser
  already gets right.

  Menus are not <select>. Every select in SysMon picks a value and stays native;
  these run a command, so they are role="menu" with roving focus, built on one
  anchored-layer primitive shared with tooltips.
*/
window.SM = window.SM || {};
SM.ui = SM.ui || {};

(function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;

  /* ---------- dialog ---------- */

  /*
    opts: {
      title, desc, body (markup), footer (markup), size ('lg'|'md'),
      onMount(panel, api), onSubmit(formData, api), closeOnBackdrop
    }
    Returns { el, close, panel }.
  */
  function openDialog(opts) {
    var o = opts || {};
    var dialog = SM.dom.el(html`
      <dialog class="dialog" data-size="${o.size || 'lg'}"
              aria-labelledby="dlg-title">
        <form class="dialog-panel glass-strong" method="dialog">
          <div class="dialog-grabber" aria-hidden="true"></div>
          <h2 class="dialog-title" id="dlg-title">${o.title}</h2>
          ${o.desc ? raw('<p class="dialog-desc">' + SM.dom.esc(o.desc) + '</p>') : ''}
          <div class="dialog-content">${o.body || ''}</div>
          <div class="dialog-foot">${o.footer || ''}</div>
        </form>
      </dialog>`);

    document.getElementById('layers').appendChild(dialog);
    var form = dialog.firstElementChild;

    var api = {
      el: dialog,
      panel: form,
      close: function () { close(); },
      /* Lets a caller show a validation message without rebuilding the dialog. */
      setError: function (name, message) {
        var field = SM.dom.qs('[name="' + name + '"]', form);
        if (!field) return;
        field.setAttribute('aria-invalid', message ? 'true' : 'false');
        var holder = field.parentElement;
        var existing = SM.dom.qs('.field-error', holder);
        if (existing) existing.remove();
        if (message) {
          holder.appendChild(SM.dom.el('<p class="field-error">' + SM.dom.esc(message) + '</p>'));
        }
      }
    };

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      if (dialog.open) {
        try { dialog.close(); } catch (err) { /* already closing */ }
      }
      /*
        Removed here rather than left to the dialog's own close event.

        The close event is the tidier hook and it is what the spec says fires,
        but it cannot be the only one: some engines - including the one this was
        first tested in - clear .open without ever dispatching it, and the
        element then stays in the document as an invisible modal that swallows
        clicks and traps focus. Removing it ourselves is not belt-and-braces, it
        is the belt; the listener below is the braces, for the closes the browser
        starts on its own.
      */
      cleanup();
    }

    function cleanup() {
      if (dialog.parentNode) dialog.remove();
    }

    /* Escape and the close button go through the browser, not through close(). */
    dialog.addEventListener('close', function () { closed = true; cleanup(); });
    dialog.addEventListener('cancel', function () {
      /* Let the browser finish its own close first, then make sure it is gone. */
      setTimeout(function () { closed = true; cleanup(); }, 0);
    });

    /*
      A click on the backdrop lands on the <dialog> itself rather than on the
      panel, which is the only reliable way to detect it.
    */
    if (o.closeOnBackdrop !== false) {
      dialog.addEventListener('mousedown', function (event) {
        if (event.target === dialog) close();
      });
    }

    /*
      Every submit is intercepted, whether or not the caller wants the data.

      The panel is a <form method="dialog">, so pressing Enter in any field would
      otherwise let the browser close the dialog on its own - which skips close()
      and, on an engine that does not fire the close event, leaves the element in
      the document. Routing all of it through close() means there is exactly one
      teardown path.
    */
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!o.onSubmit) { close(); return; }
      var data = {};
      var fields = SM.dom.qsa('[name]', form);
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i];
        data[field.name] = field.type === 'checkbox' ? field.checked : field.value;
      }
      o.onSubmit(data, api);
    });

    dialog.showModal();
    if (o.onMount) o.onMount(form, api);

    /* Focus the first real control, not the grabber or the close button. */
    var first = SM.dom.qs('input:not([type="hidden"]), select, textarea', form);
    if (first) {
      try { first.focus(); } catch (err) { /* nothing focusable is fine */ }
    }

    return api;
  }

  /*
    opts: { title, desc, body, confirmLabel, cancelLabel, tone, onConfirm }
    No backdrop dismissal: these ask a question whose answer matters.
  */
  function openAlert(opts) {
    var o = opts || {};
    var api = openDialog({
      title: o.title,
      desc: o.desc,
      size: 'md',
      closeOnBackdrop: false,
      body: o.body || '',
      footer: raw(
        SM.ui.Button({ label: o.cancelLabel || 'Cancel', variant: 'secondary',
                       act: 'alert-cancel' }).__html +
        SM.ui.Button({ label: o.confirmLabel || 'Confirm',
                       variant: o.tone === 'destructive' ? 'destructive' : 'default',
                       act: 'alert-confirm' }).__html),
      onMount: function (panel, handle) {
        panel.setAttribute('role', 'alertdialog');
        SM.dom.delegate(panel, 'click', '[data-act="alert-cancel"]', function () {
          handle.close();
        });
        SM.dom.delegate(panel, 'click', '[data-act="alert-confirm"]', function () {
          if (o.onConfirm) o.onConfirm(handle);
          else handle.close();
        });
        if (o.onMount) o.onMount(panel, handle);
      }
    });
    return api;
  }

  /* ---------- anchored layers ---------- */

  /*
    Positions a floating element against a trigger, flipping above when there is
    no room below and shifting sideways to stay on screen. Ten lines, and enough
    for a row menu and a tooltip.
  */
  function place(layer, anchor, options) {
    var o = options || {};
    var gap = o.gap == null ? 6 : o.gap;
    var box = anchor.getBoundingClientRect();
    var w = layer.offsetWidth;
    var h = layer.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var top = box.bottom + gap;
    if (top + h > vh - 8 && box.top - gap - h > 8) top = box.top - gap - h;
    if (top + h > vh - 8) top = Math.max(8, vh - h - 8);

    var left = o.align === 'start' ? box.left : box.right - w;
    if (left + w > vw - 8) left = vw - w - 8;
    if (left < 8) left = 8;

    layer.style.top = Math.round(top) + 'px';
    layer.style.left = Math.round(left) + 'px';
  }

  /* ---------- dropdown menu ---------- */

  var openMenu = null;

  /*
    items: [{ label, desc, icon, tone, onSelect } | { separator: true } |
            { label: '...', heading: true }]
  */
  function showMenu(anchor, items, options) {
    closeMenu();
    var o = options || {};

    var layer = SM.dom.el(html`
      <div class="menu glass-strong" role="menu" tabindex="-1"
           aria-label="${o.ariaLabel || 'Actions'}"></div>`);

    layer.innerHTML = items.map(function (item, index) {
      if (item.separator) return '<div class="menu-sep" role="separator"></div>';
      if (item.heading) return '<div class="menu-label">' + SM.dom.esc(item.label) + '</div>';
      return '<button type="button" class="menu-item" role="menuitem" tabindex="-1"' +
        ' data-index="' + index + '"' + SM.dom.attr('data-tone', item.tone) + '>' +
        (item.icon ? SM.dom.icon(item.icon) : '') +
        '<span class="min-w-0 flex-1">' + SM.dom.esc(item.label) +
        (item.desc ? '<span class="menu-item-desc block">' + SM.dom.esc(item.desc) + '</span>' : '') +
        '</span></button>';
    }).join('');

    document.getElementById('layers').appendChild(layer);
    place(layer, anchor, { align: o.align });

    var entries = SM.dom.qsa('.menu-item', layer);
    var at = -1;

    function focusAt(next) {
      if (!entries.length) return;
      at = (next + entries.length) % entries.length;
      entries[at].focus();
    }

    function run(index) {
      var item = items[index];
      closeMenu();
      if (item && item.onSelect) item.onSelect();
    }

    layer.addEventListener('click', function (event) {
      var node = event.target.closest('.menu-item');
      if (node) run(parseInt(node.getAttribute('data-index'), 10));
    });

    layer.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(at + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(at - 1); }
      else if (event.key === 'Home') { event.preventDefault(); focusAt(0); }
      else if (event.key === 'End') { event.preventDefault(); focusAt(entries.length - 1); }
      else if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
      else if (event.key === 'Tab') { closeMenu(true); }
    });

    /* Light dismiss. Capture, so a click on another trigger still closes this. */
    function onDocDown(event) {
      if (!layer.contains(event.target) && event.target !== anchor) closeMenu();
    }
    function onScroll() { closeMenu(); }

    setTimeout(function () {
      document.addEventListener('mousedown', onDocDown, true);
      window.addEventListener('resize', onScroll);
      window.addEventListener('scroll', onScroll, true);
    }, 0);

    openMenu = {
      layer: layer, anchor: anchor,
      teardown: function () {
        document.removeEventListener('mousedown', onDocDown, true);
        window.removeEventListener('resize', onScroll);
        window.removeEventListener('scroll', onScroll, true);
        if (layer.parentNode) layer.remove();
      }
    };

    focusAt(0);
    return openMenu;
  }

  function closeMenu(returnFocus) {
    if (!openMenu) return;
    var anchor = openMenu.anchor;
    openMenu.teardown();
    openMenu = null;
    if (returnFocus && anchor) {
      try { anchor.focus(); } catch (err) { /* the row may have gone */ }
    }
  }

  /* ---------- tooltip ---------- */

  /*
    Hover-only, suppressed on touch: on a phone the first tap would open a
    tooltip instead of pressing the button. aria-describedby carries the same
    text for anyone not using a pointer.
  */
  function bindTooltips(root, signal) {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    var layer = null;
    var timer = null;

    function hide() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (layer && layer.parentNode) layer.remove();
      layer = null;
    }

    function onOver(event) {
      var node = event.target.closest && event.target.closest('[data-tip]');
      if (!node) return;
      hide();
      timer = setTimeout(function () {
        layer = SM.dom.el('<div class="tooltip glass-strong" role="tooltip">' +
          SM.dom.esc(node.getAttribute('data-tip')) + '</div>');
        document.getElementById('layers').appendChild(layer);
        place(layer, node, { align: 'start', gap: 4 });
      }, 600);
    }

    root.addEventListener('mouseover', onOver, { signal: signal });
    root.addEventListener('mouseout', hide, { signal: signal });
    root.addEventListener('focusout', hide, { signal: signal });
    if (signal) signal.addEventListener('abort', hide, { once: true });
  }

  SM.ui.openDialog = openDialog;
  SM.ui.openAlert = openAlert;
  SM.ui.showMenu = showMenu;
  SM.ui.closeMenu = closeMenu;
  SM.ui.bindTooltips = bindTooltips;
  SM.ui.place = place;
})();
