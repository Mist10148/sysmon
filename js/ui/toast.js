/*
  Toasts.

  One stack, in a live region, at the bottom of the screen. Three things it has to
  do that a simpler notice cannot:

    - carry an action, because "site switched off" is only a safe thing to do
      quietly if Undo is right there;
    - be updatable, because a sweep shows a spinner and then becomes its own
      result rather than stacking two notices;
    - clear the home indicator on a phone, which the CSS handles.
*/
window.SM = window.SM || {};

SM.toast = (function () {
  'use strict';

  var host = null;
  var seq = 0;

  /*
    Four distinct silhouettes. The toast has no tone stripe any more, so the
    glyph is what tells success from error from warning at a glance - which
    means error and warning cannot both be the triangle.
  */
  var ICONS = {
    success: 'check-circle-2',
    error: 'x-circle',
    warning: 'alert-triangle',
    info: 'info'
  };

  function root() {
    if (!host) host = document.getElementById('toasts');
    return host;
  }

  /*
    opts: { title, desc, tone, duration, action: { label, onClick } }
    Returns a handle with update() and close(), which is what the sweep uses.
  */
  function show(opts) {
    var o = opts || {};
    var id = 'toast-' + (++seq);
    var node = SM.dom.el('<div class="toast glass-strong" id="' + id + '"></div>');
    paint(node, o);
    root().appendChild(node);

    var timer = null;
    function schedule(ms) {
      if (timer) clearTimeout(timer);
      if (ms === 0 || ms == null) return;    /* 0 means "stays until told" */
      timer = setTimeout(close, ms);
    }
    schedule(o.tone === 'loading' ? 0 : (o.duration == null ? 5000 : o.duration));

    node.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-act="toast-action"]');
      if (button && o.action && o.action.onClick) {
        o.action.onClick();
        close();
      }
    });

    function close() {
      if (timer) clearTimeout(timer);
      if (!node.parentNode) return;
      node.dataset.leaving = 'true';
      /* Long enough for the leaving animation, short enough not to pile up. */
      setTimeout(function () { if (node.parentNode) node.remove(); }, 180);
    }

    function update(next) {
      o = Object.assign({}, o, next);
      paint(node, o);
      schedule(o.tone === 'loading' ? 0 : (o.duration == null ? 5000 : o.duration));
    }

    return { close: close, update: update, el: node };
  }

  function paint(node, o) {
    var tone = o.tone || 'info';
    node.dataset.tone = tone;
    node.innerHTML = SM.dom.html`
      ${SM.dom.raw(tone === 'loading'
        ? '<span class="spinner" aria-hidden="true"></span>'
        : SM.dom.icon(ICONS[tone] || 'info'))}
      <div class="min-w-0 flex-1">
        <div class="toast-title">${o.title}</div>
        ${o.desc ? SM.dom.raw('<div class="toast-desc">' + SM.dom.esc(o.desc) + '</div>') : ''}
      </div>
      ${o.action ? SM.ui.Button({
        label: o.action.label, variant: 'secondary', size: 'sm', act: 'toast-action'
      }) : ''}`;
  }

  function success(title, desc) { return show({ tone: 'success', title: title, desc: desc }); }
  function error(title, desc) { return show({ tone: 'error', title: title, desc: desc, duration: 9000 }); }
  function warning(title, desc) { return show({ tone: 'warning', title: title, desc: desc }); }
  function info(title, desc) { return show({ tone: 'info', title: title, desc: desc }); }

  return { show: show, success: success, error: error, warning: warning, info: info };
})();
