/*
  The automatic sweep.

  A single app-level timer, started in main.js and owned by nobody else. It is
  deliberately not page-owned: navigating from the Dashboard to Settings must not
  stop the thing whose interval you went to Settings to change.

  What it cannot do, and the README says so: run while the tab is closed. The
  probe agent serves the page and answers probes; it does not hold a schedule,
  and there is no service worker, so "every five minutes" means every five
  minutes that SysMon is open. A hidden tab still sweeps - a phone locked on
  the dashboard is exactly when an outage matters - but a closed one does not, and
  the first sweep after reopening catches up.
*/
window.SM = window.SM || {};

SM.scheduler = (function () {
  'use strict';

  var timer = null;
  var lastError = null;
  var lastRunAt = null;
  var lastDegraded = false;

  function intervalMs() {
    return SM.store.settingInt('auto_sweep_minutes') * 60 * 1000;
  }

  /* Reads the settings and starts, stops or re-times the timer accordingly. */
  function apply() {
    stop();
    if (!SM.store.settingOn('auto_sweep_enabled')) return false;
    timer = setInterval(tick, intervalMs());
    return true;
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function tick() {
    SM.sweep.run({}).then(function (result) {
      if (result) {
        lastRunAt = result.at;
        lastDegraded = !!(result.sim && result.targets);
      }
      lastError = null;
    }, function (err) {
      /*
        A failed sweep must not take the timer with it, or one bad run means no
        monitoring until someone notices and reloads. Handled here rather than
        left to float, so it never surfaces as an unhandled rejection either.
      */
      lastError = String(err && err.message || err);
      console.error('SysMon: scheduled sweep failed', err);
    });
  }

  function state() {
    return {
      running: !!timer,
      intervalMinutes: SM.store.settingInt('auto_sweep_minutes'),
      lastRunAt: lastRunAt || SM.queries.lastSweepAt(),
      lastError: lastError,
      lastDegraded: lastDegraded,
      sweeping: SM.sweep.isRunning(),
      agent: SM.probe ? SM.probe.status() : null
    };
  }

  /*
    Sweeps now and re-times the interval from this moment. Returns a Promise.

    The re-timing happens before the sweep resolves, deliberately: the interval
    is "every five minutes from when you asked", not "five minutes after the
    measuring happened to finish".
  */
  function runNow() {
    var pending = SM.sweep.run({});
    if (timer) apply();
    return pending.then(function (result) {
      if (result) {
        lastRunAt = result.at;
        lastDegraded = !!(result.sim && result.targets);
      }
      return result;
    });
  }

  return { apply: apply, stop: stop, state: state, runNow: runNow };
})();
