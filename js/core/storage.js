/*
  Persistence.

  One localStorage key per table, holding the same .txt text that Export writes.
  Using one format for both means there is only one serialiser to get right, and
  it means a curious operator can read what is stored.

  Writes are debounced and only touch tables that actually changed. A sweep
  rewrites `checks` and `activity`; there is no reason for it to rewrite the
  eight rows of `locations` as well.
*/
window.SM = window.SM || {};

SM.storage = (function () {
  'use strict';

  var PREFIX = 'sysmon.v1.';
  var DEBOUNCE_MS = 400;

  var serialize = null;      /* set by the store: table -> text */
  var dirty = Object.create(null);
  var timer = null;
  var quotaHandler = null;
  var usable = null;

  function available() {
    if (usable !== null) return usable;
    try {
      window.localStorage.setItem(PREFIX + 'probe', '1');
      window.localStorage.removeItem(PREFIX + 'probe');
      usable = true;
    } catch (err) {
      /* Private windows and locked-down browsers both land here. */
      usable = false;
    }
    return usable;
  }

  function init(options) {
    serialize = options.serialize;
    quotaHandler = options.onQuotaError || null;

    /*
      A tab being hidden or closed is the last chance to write. Both events are
      needed: pagehide covers navigation away, visibilitychange covers a phone
      being locked, which never fires pagehide on iOS.
    */
    window.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }

  function getRaw(table) {
    if (!available()) return null;
    try {
      return window.localStorage.getItem(PREFIX + table);
    } catch (err) {
      return null;
    }
  }

  function setRaw(table, text) {
    if (!available()) return false;
    try {
      window.localStorage.setItem(PREFIX + table, text);
      return true;
    } catch (err) {
      if (quotaHandler) quotaHandler(table, err);
      else console.error('SysMon: could not save ' + table, err);
      return false;
    }
  }

  function removeRaw(table) {
    if (!available()) return;
    try { window.localStorage.removeItem(PREFIX + table); } catch (err) { /* nothing to undo */ }
  }

  function markDirty(tables) {
    var list = typeof tables === 'string' ? [tables] : tables;
    for (var i = 0; i < list.length; i++) dirty[list[i]] = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!serialize) return;
    var tables = Object.keys(dirty);
    if (!tables.length) return;
    dirty = Object.create(null);
    for (var i = 0; i < tables.length; i++) {
      setRaw(tables[i], serialize(tables[i]));
    }
  }

  /* Wipes SysMon's own keys and nothing else in the origin. */
  function clearAll() {
    if (!available()) return;
    var doomed = [];
    for (var i = 0; i < window.localStorage.length; i++) {
      var key = window.localStorage.key(i);
      if (key && key.indexOf(PREFIX) === 0) doomed.push(key);
    }
    for (var j = 0; j < doomed.length; j++) window.localStorage.removeItem(doomed[j]);
    dirty = Object.create(null);
  }

  /* Roughly how much room the stored data is taking, for the Settings page. */
  function usedBytes() {
    if (!available()) return 0;
    var total = 0;
    for (var i = 0; i < window.localStorage.length; i++) {
      var key = window.localStorage.key(i);
      if (key && key.indexOf(PREFIX) === 0) {
        var value = window.localStorage.getItem(key) || '';
        total += key.length + value.length;
      }
    }
    /* Browsers store UTF-16, so a character is two bytes of the quota. */
    return total * 2;
  }

  return {
    PREFIX: PREFIX,
    available: available, init: init,
    getRaw: getRaw, setRaw: setRaw, removeRaw: removeRaw,
    markDirty: markDirty, flush: flush, clearAll: clearAll, usedBytes: usedBytes
  };
})();
