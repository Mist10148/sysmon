/*
  The activity log.

  Every mutation writes here, which is why it is worth having one function
  rather than letting each caller build a row: the shape stays consistent, and
  the log reads as a diary rather than as a dump of event names.

  Entries record what happened in a sentence a person would say. "BACOLOD went
  down" as the subject, the detail underneath. The `action` field is the machine
  half - it chooses the icon and is what the Kind filter groups by.
*/
window.SM = window.SM || {};

SM.activityLog = (function () {
  'use strict';

  function write(entry) {
    var row = {
      at: entry.at || SM.fmt.iso(),
      kind: entry.kind || 'settings',
      action: entry.action || 'info',
      severity: entry.severity || 'info',
      subject: entry.subject || '',
      detail: entry.detail || '',
      location_id: entry.location_id == null ? null : entry.location_id,
      system_type_id: entry.system_type_id == null ? null : entry.system_type_id,
      run_id: entry.run_id || ''
    };
    SM.mutate.addActivity([row]);
    return row;
  }

  /* Bulk, for a sweep: one transaction, one notification, one save. */
  function writeMany(entries) {
    if (!entries || !entries.length) return 0;
    var rows = entries.map(function (entry) {
      return {
        at: entry.at || SM.fmt.iso(),
        kind: entry.kind || 'settings',
        action: entry.action || 'info',
        severity: entry.severity || 'info',
        subject: entry.subject || '',
        detail: entry.detail || '',
        location_id: entry.location_id == null ? null : entry.location_id,
        system_type_id: entry.system_type_id == null ? null : entry.system_type_id,
        run_id: entry.run_id || ''
      };
    });
    return SM.mutate.addActivity(rows);
  }

  /* The labels the Activity page's Kind filter offers. */
  var KIND_LABELS = {
    sweep: 'Sweeps',
    status: 'Status changes',
    location: 'Sites',
    system_type: 'Systems',
    settings: 'Settings',
    check: 'Record edits'
  };

  var SEVERITY_LABELS = {
    critical: 'Critical',
    warning: 'Warning',
    success: 'Success',
    info: 'Info'
  };

  return {
    write: write, writeMany: writeMany,
    KIND_LABELS: KIND_LABELS, SEVERITY_LABELS: SEVERITY_LABELS
  };
})();
