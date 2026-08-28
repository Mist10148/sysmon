/*
  DOM helpers.

  The rendering model in SysMon is: build a string with the html`` tag, assign
  it to a section's innerHTML, and handle events by delegation from the page
  root. There is no virtual DOM and no component instances for markup.

  html`` escapes every interpolated value by default. Site names, issues,
  remarks and raw ping output are all operator-entered text that ends up inside
  markup, so escaping is the default and opting out is explicit and rare.
*/
window.SM = window.SM || {};

SM.dom = (function () {
  'use strict';

  var UNSAFE = /[&<>"']/g;
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value).replace(UNSAFE, function (c) { return ENT[c]; });
  }

  /*
    Marks a string as already-safe markup. Every ui/ renderer returns its markup
    wrapped in this, which is how nested templates compose without being escaped
    a second time.
  */
  function raw(markup) {
    return { __html: markup == null ? '' : String(markup) };
  }

  function fmt(value) {
    if (value == null || value === false || value === true) return '';
    if (typeof value === 'object' && typeof value.__html === 'string') return value.__html;
    if (Array.isArray(value)) {
      var out = '';
      for (var i = 0; i < value.length; i++) out += fmt(value[i]);
      return out;
    }
    return esc(value);
  }

  /*
    html`<p>${name}</p>` -> a plain string, with name escaped.
    To nest markup, interpolate raw(...) or the result of a renderer.
  */
  function html(strings) {
    var out = strings[0];
    for (var i = 1; i < strings.length; i++) {
      out += fmt(arguments[i]) + strings[i];
    }
    return out;
  }

  /* An attribute, or nothing at all when the value is empty. */
  function attr(name, value) {
    if (value == null || value === false || value === '') return '';
    if (value === true) return ' ' + name;
    return ' ' + name + '="' + esc(value) + '"';
  }

  /* Joins class names, dropping anything falsy. Reads well inside a template. */
  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (!a) continue;
      if (typeof a === 'object') {
        for (var k in a) if (a[k]) out.push(k);
      } else {
        out.push(a);
      }
    }
    return out.join(' ');
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /*
    One listener per page root per event type, matched against a selector when
    the event fires. Sections can then be replaced wholesale with innerHTML
    without ever losing a handler.
  */
  function delegate(root, type, selector, handler, options) {
    function onEvent(event) {
      var node = event.target;
      if (node && node.nodeType !== 1) node = node.parentElement;
      var match = node && node.closest(selector);
      if (match && root.contains(match)) handler.call(match, event, match);
    }
    root.addEventListener(type, onEvent, options);
    return function off() { root.removeEventListener(type, onEvent, options); };
  }

  /* Builds a detached element from markup, for the components that need a node. */
  function el(markup) {
    var t = document.createElement('template');
    t.innerHTML = String(markup).trim();
    return t.content.firstElementChild;
  }

  function icon(name, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' +
      '<use href="#i-' + name + '"/></svg>';
  }

  function debounce(fn, wait) {
    var timer = null;
    function run() {
      var args = arguments, self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(self, args); }, wait);
    }
    run.cancel = function () { if (timer) { clearTimeout(timer); timer = null; } };
    return run;
  }

  /* Collapses many calls in one frame into one. */
  function rafBatch(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; fn(); });
    };
  }

  /* Hands the browser a file to save, without a server involved. */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* Revoking straight away cancels the save in some browsers. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  return {
    esc: esc, raw: raw, html: html, attr: attr, cx: cx,
    qs: qs, qsa: qsa, delegate: delegate, el: el, icon: icon,
    debounce: debounce, rafBatch: rafBatch, download: download
  };
})();
