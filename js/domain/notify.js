/*
  Desktop notifications.

  This is what is left of the previous build's email alerts. A static page cannot
  send mail - there is no SMTP client in a browser and no server to ask - so the
  honest replacement is a notification on the machine that is running SysMon, and
  the README says as much rather than implying an outage will find someone who
  has gone home.

  Two rules worth keeping:

  Permission is only ever requested from a real click on the Settings switch.
  Asking on page load is the behaviour that gets a site permanently blocked.

  Repeats collapse. The tag is the site's id, so a site that keeps flapping
  replaces its own notification instead of stacking eleven of them.
*/
window.SM = window.SM || {};

SM.notify = (function () {
  'use strict';

  function supported() { return typeof window.Notification === 'function'; }

  function permission() {
    return supported() ? window.Notification.permission : 'unsupported';
  }

  function enabled() {
    return SM.store.settingOn('notifications_enabled') &&
      supported() && permission() === 'granted';
  }

  function init() {
    /*
      A permission revoked in browser settings while the switch is still on
      would otherwise leave Settings claiming notifications are working.
    */
    if (SM.store.settingOn('notifications_enabled') && permission() === 'denied') {
      SM.mutate.updateSettings({ notifications_enabled: '0' });
    }
  }

  /* Must be called from a user gesture. Resolves with the resulting permission. */
  function request() {
    if (!supported()) return Promise.resolve('unsupported');
    try {
      var result = window.Notification.requestPermission();
      /* Older Safari passes the answer to a callback and returns undefined. */
      if (result && typeof result.then === 'function') return result;
      return new Promise(function (resolve) {
        window.Notification.requestPermission(resolve);
      });
    } catch (err) {
      return Promise.resolve(permission());
    }
  }

  function send(title, body, tag) {
    if (!enabled()) return null;
    try {
      return new window.Notification(title, {
        body: body,
        tag: tag,
        icon: 'assets/favicon.svg',
        badge: 'assets/favicon.svg'
      });
    } catch (err) {
      /* Some browsers refuse to construct one outside a service worker. */
      return null;
    }
  }

  /* Called by the sweep with its transition entries. */
  function announce(transitions) {
    if (!enabled() || !transitions || !transitions.length) return 0;
    var sent = 0;
    for (var i = 0; i < transitions.length; i++) {
      var entry = transitions[i];
      if (entry.severity !== 'critical' && entry.action !== 'status.restored') continue;
      send(entry.subject, entry.detail, 'sysmon-' + entry.location_id);
      sent++;
    }
    return sent;
  }

  function sample() {
    return send('SysMon notifications are on',
      'This is what an outage will look like.', 'sysmon-sample');
  }

  return {
    supported: supported, permission: permission, enabled: enabled,
    init: init, request: request, send: send, announce: announce, sample: sample
  };
})();
