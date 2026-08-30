/*
  The schema.

  One place that says what a table's columns are, in what order, and of what
  type. The .txt writer, the .txt parser, the store and the exporters all read
  from here, so a column is added in exactly one file.

  Column order is the file format's order and is not free to change: an existing
  export must keep parsing. New columns go on the end, and the parser fills in a
  default for a file that predates them.
*/
window.SM = window.SM || {};

SM.schema = (function () {
  'use strict';

  /* types: int | num | bool | text */
  var TABLES = {
    system_types: {
      file: 'sysmon-system-types.txt',
      title: 'system types',
      note: 'Reorder by editing sort_order. Ids must stay unique and locations point at them.',
      columns: [
        ['id', 'int', 0],
        ['sort_order', 'int', 0],
        ['slug', 'text', ''],
        ['name', 'text', ''],
        ['description', 'text', ''],
        ['color', 'text', 'slate'],
        ['icon', 'text', 'monitor'],
        ['check_method', 'text', 'ping'],
        ['http_scheme', 'text', 'http'],
        ['http_port', 'int', null],
        ['http_path', 'text', '/'],
        ['http_expect_status', 'int', 200],
        ['active', 'bool', true]
      ]
    },

    locations: {
      file: 'sysmon-locations.txt',
      title: 'locations (site x system)',
      note: 'One row per site per system. system_type_id must match a row in the system types file.',
      columns: [
        ['id', 'int', 0],
        ['sort_order', 'int', 0],
        ['system_type_id', 'int', 0],
        ['name', 'text', ''],
        ['ip', 'text', ''],
        ['lat', 'num', 0],
        ['lng', 'num', 0],
        ['region', 'text', ''],
        ['active', 'bool', true]
      ]
    },

    checks: {
      file: 'sysmon-checks.txt',
      title: 'check records',
      note: 'source is live when a probe agent measured the check and sim ' +
            'when it was simulated. raw_output is last because it is the ' +
            'long one. In it, \\n is a newline and \\\\ a backslash.',
      columns: [
        ['id', 'int', 0],
        ['run_id', 'text', ''],
        ['location_id', 'int', 0],
        ['checked_at', 'text', ''],
        ['check_method', 'text', 'ping'],
        ['functional', 'bool', false],
        ['packets_sent', 'int', 4],
        ['packets_lost', 'int', 0],
        ['loss_pct', 'num', 0],
        ['avg_latency_ms', 'num', null],
        ['http_status', 'int', null],
        ['status', 'text', 'Functional'],
        ['status_overridden', 'bool', false],
        ['issues', 'text', ''],
        ['remarks', 'text', ''],
        ['source', 'text', 'sim'],
        ['raw_output', 'text', '']
      ]
    },

    activity: {
      file: 'sysmon-activity.txt',
      title: 'activity feed',
      note: 'Append-only in practice. Prune removes everything before a date.',
      columns: [
        ['id', 'int', 0],
        ['at', 'text', ''],
        ['kind', 'text', 'info'],
        ['action', 'text', ''],
        ['severity', 'text', 'info'],
        ['subject', 'text', ''],
        ['detail', 'text', ''],
        ['location_id', 'int', null],
        ['system_type_id', 'int', null],
        ['run_id', 'text', '']
      ]
    }
  };

  /* settings is key = value rather than columns; it is the file people edit. */
  var SETTINGS_FILE = 'sysmon-settings.txt';

  var DEFAULT_SETTINGS = {
    auto_sweep_enabled: '0',
    auto_sweep_minutes: '5',
    sweep_packets: '4',
    sweep_timeout_ms: '1000',
    notifications_enabled: '0',
    theme: 'system',
    seed_salt: 'sysmon-wv-2026',
    agent_url: '',
    backfill_days: '42'
  };

  /* Numeric settings, and the range each will accept. */
  var SETTING_RANGES = {
    auto_sweep_minutes: [1, 1440],
    sweep_packets: [1, 20],
    sweep_timeout_ms: [100, 20000],
    backfill_days: [0, 365]
  };

  var STATUSES = ['Functional', 'Restored', 'Down'];
  var CHECK_METHODS = ['ping', 'http'];
  var SEVERITIES = ['info', 'success', 'warning', 'critical'];
  var ACTIVITY_KINDS = ['sweep', 'status', 'location', 'system_type', 'settings', 'check'];
  var COLORS = ['blue', 'orange', 'teal', 'amber', 'rose', 'green', 'violet', 'slate'];
  var ICONS = ['monitor', 'ticket', 'server', 'globe', 'activity', 'radio',
               'heart-pulse', 'shield', 'database', 'map-pin'];

  /* Field limits, matched to the previous build so imports stay compatible. */
  var LIMITS = {
    location_name: 80,
    system_name: 60,
    region: 80,
    description: 300,
    issues: 2000,
    remarks: 2000
  };

  function columnNames(table) {
    return TABLES[table].columns.map(function (c) { return c[0]; });
  }

  function tableNames() { return Object.keys(TABLES); }

  return {
    TABLES: TABLES,
    SETTINGS_FILE: SETTINGS_FILE,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    SETTING_RANGES: SETTING_RANGES,
    STATUSES: STATUSES,
    CHECK_METHODS: CHECK_METHODS,
    SEVERITIES: SEVERITIES,
    ACTIVITY_KINDS: ACTIVITY_KINDS,
    COLORS: COLORS,
    ICONS: ICONS,
    LIMITS: LIMITS,
    columnNames: columnNames,
    tableNames: tableNames,
    VERSION: 1
  };
})();
