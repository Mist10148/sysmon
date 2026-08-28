/*
  Theme.

  Three states, not two: light, dark, and following the operating system. The
  third is the default, and it has to keep following - a phone that switches to
  dark at sunset should take SysMon with it without a reload.

  The inline script in index.html duplicates the first few lines of this on
  purpose. It runs before the first paint so the page never flashes the wrong
  theme; this file owns the rest.
*/
window.SM = window.SM || {};

SM.theme = (function () {
  'use strict';

  var KEY = 'sysmon-theme';
  var MODES = ['light', 'dark', 'system'];
  var mode = 'system';
  var media = null;
  var listeners = [];

  function read() {
    try {
      var saved = window.localStorage.getItem(KEY);
      return MODES.indexOf(saved) === -1 ? 'system' : saved;
    } catch (err) {
      return 'system';
    }
  }

  function resolved() {
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    return media && media.matches ? 'dark' : 'light';
  }

  function apply() {
    var dark = resolved() === 'dark';
    document.documentElement.classList.toggle('dark', dark);

    /*
      The browser chrome colour is set by two media-scoped meta tags in the
      head, which cover "system" correctly on their own. An explicit choice has
      to override them, so the one matching the resolved theme wins.
    */
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute('content', dark ? '#1b1a18' : '#faf9f5');
    }
    for (var j = 0; j < listeners.length; j++) listeners[j](mode, resolved());
  }

  function set(next) {
    if (MODES.indexOf(next) === -1) return;
    mode = next;
    try { window.localStorage.setItem(KEY, next); } catch (err) { /* private mode */ }
    if (SM.mutate) SM.mutate.updateSettings({ theme: next });
    apply();
  }

  function get() { return mode; }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      var at = listeners.indexOf(fn);
      if (at !== -1) listeners.splice(at, 1);
    };
  }

  function init() {
    mode = read();
    media = window.matchMedia('(prefers-color-scheme: dark)');
    /* addEventListener on a MediaQueryList is recent; addListener is the fallback. */
    if (media.addEventListener) media.addEventListener('change', onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
    apply();
  }

  function onSystemChange() {
    if (mode === 'system') apply();
  }

  return { init: init, set: set, get: get, resolved: resolved, onChange: onChange, MODES: MODES };
})();
