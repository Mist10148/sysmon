/*
  Analytics.

  Everything here is derived from the stored check rows and nothing is cached
  between calls - a date range is a few thousand rows and one pass over them, so
  a memo would be an optimisation of something that already takes no time.

  Uptime is counted per check, not per minute. Ten checks of which one failed is
  90%, regardless of how far apart they were. That is the same thing the paper
  form counts, and it is the number the monthly report is written from, so a more
  clever time-weighted figure would be a different figure from the one the office
  expects.
*/
window.SM = window.SM || {};

SM.analytics = (function () {
  'use strict';

  /* options: { from, to, systemTypeId } - from/to are YYYY-MM-DD, inclusive. */
  function compute(options) {
    var opts = options || {};
    var rows = collect(opts);

    var totals = { checks: rows.length, up: 0, latencySum: 0, latencyCount: 0 };
    var byDay = {};
    var bySystem = {};
    var bySite = {};

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var up = SM.status.isUp(row.status);
      if (up) totals.up++;
      if (row.avg_latency_ms != null) {
        totals.latencySum += row.avg_latency_ms;
        totals.latencyCount++;
      }

      bump(byDay, SM.fmt.dayOf(row.checked_at), up, null);
      bump(bySystem, row.system_type_name || 'Unassigned', up, row.system_type_color);
      bump(bySite, row.location_name, up, row.system_type_color);
    }

    var outages = findOutages(rows);
    var recovered = outages.filter(function (o) { return !o.ongoing; });
    var mttr = recovered.length
      ? recovered.reduce(function (sum, o) { return sum + o.durationMs; }, 0) / recovered.length
      : null;

    return {
      totals: {
        checks: totals.checks,
        uptimePct: totals.checks ? (totals.up / totals.checks) * 100 : null,
        avgLatencyMs: totals.latencyCount ? totals.latencySum / totals.latencyCount : null
      },
      outages: outages,
      ongoing: outages.length - recovered.length,
      mttrMs: mttr,
      daily: toSeries(byDay),
      bySystem: toRanked(bySystem),
      bySite: toRanked(bySite)
    };
  }

  function collect(opts) {
    var out = [];
    var list = SM.store.get().checks;
    for (var i = 0; i < list.length; i++) {
      var day = SM.fmt.dayOf(list[i].checked_at);
      if (opts.from && day < opts.from) continue;
      if (opts.to && day > opts.to) continue;
      var row = SM.queries.decorateCheck(list[i]);
      if (opts.systemTypeId && row.system_type_id !== opts.systemTypeId) continue;
      out.push(row);
    }
    return out;
  }

  function bump(bag, key, up, color) {
    if (!key) return;
    var entry = bag[key];
    if (!entry) { entry = bag[key] = { key: key, total: 0, up: 0, color: color }; }
    entry.total++;
    if (up) entry.up++;
  }

  /* Ascending by day, so the chart can walk it straight through. */
  function toSeries(bag) {
    return Object.keys(bag).sort().map(function (day) {
      var entry = bag[day];
      return {
        day: day,
        checks: entry.total,
        uptimePct: entry.total ? (entry.up / entry.total) * 100 : null
      };
    });
  }

  /* Worst first, because that is the row anyone opening this page is after. */
  function toRanked(bag) {
    return Object.keys(bag).map(function (key) {
      var entry = bag[key];
      return {
        name: key,
        color: entry.color || 'slate',
        checks: entry.total,
        uptimePct: entry.total ? (entry.up / entry.total) * 100 : 0
      };
    }).sort(function (a, b) {
      if (a.uptimePct !== b.uptimePct) return a.uptimePct - b.uptimePct;
      return SM.fmt.compareText(a.name, b.name);
    });
  }

  /*
    An outage is a run of consecutive Down checks for one site. It ends at the
    first check that passed - which is the Restored row - and its duration is
    measured to that check rather than to the last failure, because that is when
    the site was demonstrably working again.

    An outage still open at the end of the range is marked ongoing rather than
    given a made-up end, and is excluded from mean time to recovery: averaging in
    an outage that has not finished would drag the figure toward zero.
  */
  function findOutages(rows) {
    var bySite = {};
    for (var i = 0; i < rows.length; i++) {
      var id = rows[i].location_id;
      if (!bySite[id]) bySite[id] = [];
      bySite[id].push(rows[i]);
    }

    var outages = [];
    Object.keys(bySite).forEach(function (id) {
      var list = bySite[id].slice().sort(function (a, b) {
        return a.checked_at < b.checked_at ? -1 : (a.checked_at > b.checked_at ? 1 : 0);
      });
      var open = null;
      for (var j = 0; j < list.length; j++) {
        var row = list[j];
        if (row.status === 'Down') {
          if (!open) {
            open = {
              location_id: row.location_id,
              location_name: row.location_name,
              system_type_name: row.system_type_name,
              system_type_color: row.system_type_color,
              started: row.checked_at,
              recovered: null,
              failedChecks: 0,
              ongoing: true,
              durationMs: 0
            };
          }
          open.failedChecks++;
        } else if (open) {
          open.recovered = row.checked_at;
          open.ongoing = false;
          open.durationMs = SM.fmt.parse(row.checked_at) - SM.fmt.parse(open.started);
          outages.push(open);
          open = null;
        }
      }
      if (open) {
        open.durationMs = new Date() - SM.fmt.parse(open.started);
        outages.push(open);
      }
    });

    /* Longest first; an ongoing outage always outranks a finished one. */
    return outages.sort(function (a, b) {
      if (a.ongoing !== b.ongoing) return a.ongoing ? -1 : 1;
      return b.durationMs - a.durationMs;
    });
  }

  /* The tone a percentage should be shown in. */
  function uptimeTone(pct) {
    if (pct == null) return null;
    if (pct >= 99) return 'ok';
    if (pct >= 90) return 'warn';
    return 'down';
  }

  return { compute: compute, uptimeTone: uptimeTone, findOutages: findOutages };
})();
