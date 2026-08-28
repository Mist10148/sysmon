/*
  Seeded randomness, and id allocation.

  Sweeps in this build are simulated, and simulated results have to be
  reproducible or the history contradicts itself: reload the page, regenerate
  the same range, and Analytics would report different uptime for a month that
  has already been printed. So every random number comes from a stream seeded by
  (salt, site address, run id) rather than from Math.random.

  mulberry32 is used because it is nine lines, has a full 2^32 period, and
  passes the only test that matters here - it looks like noise to a person
  reading a chart.
*/
window.SM = window.SM || {};

SM.rng = (function () {
  'use strict';

  /* FNV-1a, 32-bit. Turns any string into a seed. */
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h >>> 0;
  }

  /* A stream of numbers in [0, 1). */
  function stream(seed) {
    var a = typeof seed === 'string' ? hash(seed) : (seed >>> 0);
    return function next() {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A single stable number in [0, 1) for a string - no stream, no state. */
  function unit(str) {
    return hash(str) / 4294967296;
  }

  function between(next, lo, hi) { return lo + next() * (hi - lo); }
  function intBetween(next, lo, hi) { return Math.floor(lo + next() * (hi - lo + 1)); }
  function pick(next, list) { return list[Math.floor(next() * list.length)]; }

  return { hash: hash, stream: stream, unit: unit,
           between: between, intBetween: intBetween, pick: pick };
})();

/*
  Ids.

  Integers per table, allocated from whatever the highest existing id is. That
  matters for import: a hand-edited file may have gaps or start at 40, and the
  next row created after loading it must not collide.
*/
SM.ids = (function () {
  'use strict';

  var next = Object.create(null);

  function seedFrom(table, rows) {
    var max = 0;
    for (var i = 0; i < rows.length; i++) {
      var id = Number(rows[i].id) || 0;
      if (id > max) max = id;
    }
    next[table] = max + 1;
  }

  function take(table) {
    if (!next[table]) next[table] = 1;
    return next[table]++;
  }

  /* Run ids group the checks written by one sweep. Readable on purpose. */
  function runId(date) {
    var d = date || new Date();
    var p = SM.fmt.pad;
    return 'r-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  return { seedFrom: seedFrom, take: take, runId: runId };
})();
