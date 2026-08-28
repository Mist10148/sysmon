/*
  Topic pub/sub.

  Subscribers say which tables they care about; a write says which tables it
  touched. That granularity is why this exists rather than CustomEvents on
  document: History does not need to re-render because a system type was
  renamed, and a sweep that writes 40 checks should notify once, not 40 times.

  Emission is coalesced onto a microtask. Callers can emit freely inside a loop.
*/
window.SM = window.SM || {};

SM.emitter = (function () {
  'use strict';

  function create() {
    var subs = [];          /* { topics: Set|null, fn } */
    var pending = null;     /* Set of topic names waiting to be flushed */
    var flushing = false;

    function subscribe(topics, fn, options) {
      var set = null;
      if (topics && topics !== '*' && !(topics.length === 1 && topics[0] === '*')) {
        set = Object.create(null);
        var list = typeof topics === 'string' ? [topics] : topics;
        for (var i = 0; i < list.length; i++) set[list[i]] = true;
      }
      var entry = { topics: set, fn: fn };
      subs.push(entry);

      function off() {
        var at = subs.indexOf(entry);
        if (at !== -1) subs.splice(at, 1);
      }
      if (options && options.signal) {
        if (options.signal.aborted) { off(); return off; }
        options.signal.addEventListener('abort', off, { once: true });
      }
      return off;
    }

    function emit(topics) {
      var list = typeof topics === 'string' ? [topics] : topics;
      if (!list || !list.length) return;
      if (!pending) pending = Object.create(null);
      for (var i = 0; i < list.length; i++) pending[list[i]] = true;
      if (!flushing) {
        flushing = true;
        Promise.resolve().then(flush);
      }
    }

    function flush() {
      flushing = false;
      var topics = pending;
      pending = null;
      if (!topics) return;

      /* A copy, because a callback is allowed to unsubscribe itself. */
      var snapshot = subs.slice();
      for (var i = 0; i < snapshot.length; i++) {
        var entry = snapshot[i];
        if (subs.indexOf(entry) === -1) continue;
        if (entry.topics && !matches(entry.topics, topics)) continue;
        try {
          entry.fn(topics);
        } catch (err) {
          /*
            One broken subscriber must not stop the others, or a rendering bug
            on one page would silently freeze every other page in the shell.
          */
          console.error('SysMon: subscriber threw', err);
        }
      }
    }

    function matches(wanted, changed) {
      for (var t in changed) if (wanted[t]) return true;
      return false;
    }

    return { subscribe: subscribe, emit: emit };
  }

  return { create: create };
})();
