/*
  Status.

  Three values, and the middle one is the whole point:

    Down        the check failed
    Restored    the check passed and the one before it failed
    Functional  the check passed and so did the one before it

  "Restored" exists so that a recovery is visible in a list of a thousand rows.
  Without it, a site that fell over at 09:00 and came back at 09:30 leaves two
  Functional rows either side of a Down one, and the moment it came back - the
  thing an operator writes in the monthly report - has to be inferred.

  This is carried over unchanged from the previous build, because the recorded
  history of both must mean the same thing.
*/
window.SM = window.SM || {};

SM.status = (function () {
  'use strict';

  function derive(functional, previousStatus) {
    if (!functional) return 'Down';
    if (previousStatus === 'Down') return 'Restored';
    return 'Functional';
  }

  /* Whether a status change is worth an activity entry. */
  function isTransition(previousStatus, nextStatus) {
    if (nextStatus === 'Down') return previousStatus !== 'Down';
    if (nextStatus === 'Restored') return true;
    return false;
  }

  function tone(status) {
    if (status === 'Down') return 'down';
    if (status === 'Restored') return 'warn';
    if (status === 'Unknown') return 'unknown';
    return 'ok';
  }

  function isUp(status) { return status === 'Functional' || status === 'Restored'; }

  return { derive: derive, isTransition: isTransition, tone: tone, isUp: isUp };
})();
