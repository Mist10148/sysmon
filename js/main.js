/*
  Boot.

  Order matters here and nowhere else: the theme has to settle before anything
  paints, the store has to load before the shell can describe it, and the
  scheduler must not start until there is data for it to sweep.
*/
window.SM = window.SM || {};

(function () {
  'use strict';

  function boot() {
    SM.theme.init();

    var loaded;
    try {
      loaded = SM.store.init();
    } catch (err) {
      fatal(err);
      return;
    }

    /*
      A fresh install has systems and sites but no history, and a monitoring
      dashboard with an empty History page tells an operator nothing about
      whether it works. The backfill generates a month and a half from the same
      deterministic streams the live sweep uses.
    */
    /*
      The second half of that condition is the belt to the braces. If the stored
      tables are ever inconsistent - one written, another not - "fresh install"
      alone would generate a second month of history on top of the first, and
      Analytics would quietly double-count every day of it.
    */
    if (loaded.freshInstall && SM.backfill && SM.store.get().checks.length === 0) {
      SM.backfill.run();
    }

    SM.shell.init();
    SM.router.start(SM.dom.qs('#view'));
    if (SM.scheduler) SM.scheduler.apply();
    if (SM.notify) SM.notify.init();

    /* Anything the load had to say about itself, said once. */
    if (loaded.warnings && loaded.warnings.length && SM.toast) {
      SM.toast.show({
        tone: 'warning',
        title: 'Some stored data needed attention',
        desc: loaded.warnings.join(' ')
      });
    }

    SM.store.onQuotaError = function () {
      if (!SM.toast) return;
      SM.toast.show({
        tone: 'error',
        title: 'Storage is full',
        desc: 'Export your data, then prune old records on the Settings page.',
        duration: 12000
      });
    };
  }

  function fatal(err) {
    console.error('SysMon: could not start', err);
    var view = document.getElementById('view');
    if (!view) return;
    view.innerHTML =
      '<div class="page-body"><div class="card surface-card"><div class="empty">' +
      '<p class="empty-title">SysMon could not start</p>' +
      '<p class="empty-desc">' + SM.dom.esc(String(err && err.message || err)) + '</p>' +
      '</div></div></div>';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
