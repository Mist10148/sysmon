/*
  The automatic sweep.

  A single app-level timer, started in main.js and owned by nobody else. It is
  deliberately not page-owned: navigating from the Dashboard to Settings must not
  stop the thing whose interval you went to Settings to change.

  What it cannot do, and the README says so: run while the tab is closed. There
  is no service worker and no server here, so "every five minutes" means every
  five minutes that SysMon is open. A hidden tab still sweeps - a phone locked on
  the dashboard is exactly when an outage matters - but a closed one does not, and
  the first sweep after reopening catches up.
*/
window.SM = window.SM || {};

SM.scheduler = (function () {
  'use strict';

  var timer = null;
  var lastError = null;
  var lastRunAt = null;

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
    try {
      var result = SM.sweep.run({});
      lastRunAt = result ? result.at : lastRunAt;
      lastError = null;
    } catch (err) {
      /*
        A failed sweep must not take the timer with it, or one bad run means no
        monitoring until someone notices and reloads.
      */
      lastError = String(err && err.message || err);
      console.error('SysMon: scheduled sweep failed', err);
    }
  }

  function state() {
    return {
      running: !!timer,
      intervalMinutes: SM.store.settingInt('auto_sweep_minutes'),
      lastRunAt: lastRunAt || SM.queries.lastSweepAt(),
      lastError: lastError
    };
  }

  /* Sweeps now and re-times the interval from this moment. */
  function runNow() {
    var result = SM.sweep.run({});
    if (result) lastRunAt = result.at;
    if (timer) apply();
    return result;
  }

  return { apply: apply, stop: stop, state: state, runNow: runNow };
})();
