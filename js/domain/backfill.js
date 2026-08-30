/*
  The backfill.

  A monitoring dashboard whose History page is empty tells an operator nothing
  about whether it works, and an Analytics page with no range to draw is a
  screenful of dashes. So on a fresh install SysMon generates six weeks
  of history before the first paint.

  This is not fake data bolted on beside the real thing: it runs the same probe
  function the live sweep runs, against the same deterministic streams, so the
  outages it produces are the outages "Check All Now" would have produced had it
  been running that whole time. Change seed_salt and you get a different month;
  reload and you get the same one.

  Three sweeps a day rather than one every five minutes. The five-minute cadence
  belongs to a service that is always on; a page you open needs enough rows to
  show shape and few enough to stay inside the storage quota.
*/
window.SM = window.SM || {};

SM.backfill = (function () {
  'use strict';

  /* Morning, midday and end of day - roughly when someone would look. */
  var TIMES = [[8, 5], [12, 35], [17, 10]];

  function run(options) {
    var opts = options || {};
    var days = opts.days == null ? SM.store.settingInt('backfill_days') : opts.days;
    if (days <= 0) return 0;

    var locations = SM.store.get().locations.filter(function (l) { return l.active; });
    if (!locations.length) return 0;

    var systems = {};
    var all = SM.store.get().system_types;
    for (var s = 0; s < all.length; s++) systems[all[s].id] = all[s];

    var checks = [];
    var entries = [];
    /* Previous status per site, carried forward so Restored lands correctly. */
    var previous = {};
    var openedAt = {};

    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    /* days - 1 down to 0: `days` days ending today, not days + 1. */
    for (var d = days - 1; d >= 0; d--) {
      var day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);

      for (var t = 0; t < TIMES.length; t++) {
        var at = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                          TIMES[t][0], TIMES[t][1], 0);
        /* Never write a check in the future. */
        if (at > now) continue;

        var runId = SM.ids.runId(at);
        var functional = 0, down = 0;

        for (var i = 0; i < locations.length; i++) {
          var loc = locations[i];
          var system = systems[loc.system_type_id];
          if (!system || !system.active) continue;

          var check = SM.sweep.probe(loc, system, at, previous[loc.id] || null, { runId: runId });
          checks.push(check);
          previous[loc.id] = check.status;
          if (check.functional) functional++; else down++;

          if (check.status === 'Down' && !openedAt[loc.id]) {
            openedAt[loc.id] = check.checked_at;
            entries.push({
              at: check.checked_at, kind: 'status', action: 'status.down', severity: 'critical',
              subject: loc.name + ' went down',
              detail: system.name + ' - ' + check.issues + ' on ' + loc.ip,
              location_id: loc.id, system_type_id: loc.system_type_id, run_id: runId
            });
          } else if (check.status === 'Restored') {
            var since = openedAt[loc.id];
            openedAt[loc.id] = null;
            entries.push({
              at: check.checked_at, kind: 'status', action: 'status.restored', severity: 'success',
              subject: loc.name + ' is back',
              detail: system.name + ' - down for ' +
                (since ? SM.fmt.duration(SM.fmt.parse(check.checked_at) - SM.fmt.parse(since))
                       : 'a while') +
                ', now ' + SM.fmt.latency(check.avg_latency_ms),
              location_id: loc.id, system_type_id: loc.system_type_id, run_id: runId
            });
          }
        }

        entries.push({
          at: SM.fmt.iso(at), kind: 'sweep', action: 'sweep.run', severity: 'info',
          subject: 'Checked ' + SM.fmt.plural(functional + down, 'site'),
          detail: functional + ' functional, ' + down + ' down',
          run_id: runId
        });
      }
    }

    if (!checks.length) return 0;

    /* Chronological, because the store relies on the checks array being ordered. */
    entries.sort(function (a, b) { return a.at < b.at ? -1 : (a.at > b.at ? 1 : 0); });

    SM.store.tx('backfill', function () {
      SM.mutate.addChecks(checks);
      SM.mutate.addActivity(entries.map(function (e) {
        return {
          at: e.at, kind: e.kind, action: e.action, severity: e.severity,
          subject: e.subject, detail: e.detail,
          location_id: e.location_id == null ? null : e.location_id,
          system_type_id: e.system_type_id == null ? null : e.system_type_id,
          run_id: e.run_id || ''
        };
      }));
    });

    return checks.length;
  }

  return { run: run, TIMES: TIMES };
})();
